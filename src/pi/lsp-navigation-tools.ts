import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatLocations } from "../navigation/format.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const definitionParams = {
	type: "object",
	properties: {
		path: { type: "string" },
		line: { type: "integer", minimum: 1 },
		character: { type: "integer", minimum: 1 },
	},
	required: ["path", "line", "character"],
	additionalProperties: false,
} as never;
const referencesParams = {
	type: "object",
	properties: {
		path: { type: "string" },
		line: { type: "integer", minimum: 1 },
		character: { type: "integer", minimum: 1 },
		includeDeclaration: { type: "boolean" },
	},
	required: ["path", "line", "character"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type NavigationKind = "definition" | "references" | "implementation" | "typeDefinition";
type NavigationResult = { serverId: string; locations: unknown[] };
type HierarchyResult = { serverId: string; values: unknown[] };
type HierarchyFlavor = "call" | "type";
type NavigationRequest = {
	serverId: string;
	uri: string;
	line: number;
	character: number;
	includeDeclaration: boolean;
	timeoutMs: number;
	client?: RuntimeSession["pool"] extends Map<string, infer Client> ? Client : never;
};

/** Register an on-demand, read-only definition lookup. */
export function registerLspDefinitionTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_definition",
		label: "LSP definition",
		description: "Jump to the definition of the symbol at a position in one file; returns bounded locations with freshness and coverage. Positions are 1-based UTF-16 code units.",
		parameters: definitionParams,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runNavigation("definition", params as { path: string; line: number; character: number }, ctx, getSession);
		},
	});
}

/** Register an on-demand, read-only implementation lookup. */
export function registerLspImplementationTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_implementation",
		label: "LSP implementation",
		description: "Find implementations of the symbol at a position; returns bounded locations with freshness and coverage. Positions are 1-based UTF-16 code units.",
		parameters: definitionParams,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runNavigation("implementation", params as { path: string; line: number; character: number }, ctx, getSession);
		},
	});
}

/** Register an on-demand, read-only type-definition lookup. */
export function registerLspTypeDefinitionTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_type_definition",
		label: "LSP type definition",
		description: "Jump to the type definition of the symbol at a position; returns bounded locations with freshness and coverage. Positions are 1-based UTF-16 code units.",
		parameters: definitionParams,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runNavigation("typeDefinition", params as { path: string; line: number; character: number }, ctx, getSession);
		},
	});
}

/** Register an on-demand, read-only call hierarchy tool. */
export function registerLspCallHierarchyTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_call_hierarchy",
		label: "LSP call hierarchy",
		description: "Prepare call hierarchy items or list incoming/outgoing calls; read-only, bounded, positions are 1-based UTF-16 code units.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 },
				mode: { type: "string", enum: ["prepare", "incoming", "outgoing"] }, item: { type: "object" },
			},
			required: ["path", "line", "character"], additionalProperties: false,
		} as never,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runCallHierarchy(params as { path: string; line: number; character: number; mode?: string; item?: unknown }, ctx, getSession);
		},
	});
}

/** Register an on-demand, read-only type hierarchy tool. */
export function registerLspTypeHierarchyTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_type_hierarchy",
		label: "LSP type hierarchy",
		description: "Prepare type hierarchy items or list supertypes/subtypes; read-only, bounded, positions are 1-based UTF-16 code units.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 },
				mode: { type: "string", enum: ["prepare", "supertypes", "subtypes"] }, item: { type: "object" },
			},
			required: ["path", "line", "character"], additionalProperties: false,
		} as never,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runCallHierarchy(params as { path: string; line: number; character: number; mode?: string; item?: unknown }, ctx, getSession, "type");
		},
	});
}

/** Register an on-demand, read-only references lookup. */
export function registerLspReferencesTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_references",
		label: "LSP references",
		description: "Find references to the symbol at a position in one file; returns bounded locations with freshness and coverage. Positions are 1-based UTF-16 code units.",
		parameters: referencesParams,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runNavigation("references", params as { path: string; line: number; character: number; includeDeclaration?: boolean }, ctx, getSession);
		},
	});
}

async function runNavigation(
	kind: NavigationKind,
	params: { path: string; line: number; character: number; includeDeclaration?: boolean },
	ctx: ExtensionToolContext,
	getSession: SessionForRoot,
) {
	try {
		const { path, line, character } = params;
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);
		if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) {
			return text("line and character must be positive integers (1-based).");
		}

		const uri = pathToFileURL(absolutePath).href;
		const failures: string[] = [];
		const unsupported: string[] = [];
		const locationsByServer: NavigationResult[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const request: NavigationRequest = {
				serverId,
				uri,
				line: line - 1,
				character: character - 1,
				includeDeclaration: params.includeDeclaration ?? false,
				timeoutMs,
				...(client ? { client } : {}),
			};
			const outcome = kind === "definition"
				? await session.definition(request.serverId, request.uri, request.line, request.character, request.timeoutMs, request.client)
				: kind === "references"
					? await session.references(request.serverId, request.uri, request.line, request.character, request.includeDeclaration, request.timeoutMs, request.client)
					: kind === "implementation"
						? await session.implementation(request.serverId, request.uri, request.line, request.character, request.timeoutMs, request.client)
						: await session.typeDefinition(request.serverId, request.uri, request.line, request.character, request.timeoutMs, request.client);
			if (outcome.outcome === "failed") failures.push(`failed to retrieve ${kind} from ${serverId}`);
			else if (outcome.outcome === "unsupported") unsupported.push(`${serverId} does not support ${kind}`);
			else locationsByServer.push({ serverId, locations: outcome.locations });
		}

		const fixedLines = [...failures, ...unsupported];
		if (locationsByServer.length === 0) {
			if (unsupported.length === result.matchedServers.length) {
				fixedLines.push(`No matched language server supports ${kind} lookup for this file.`);
			}
			return text(fixedLines.join("\n"));
		}

		const emptyMessage = kind === "definition"
			? "No definition found at this position."
			: kind === "references"
				? "No references reported at this position."
				: `No ${kind} found at this position.`;
		const everySectionEmpty = locationsByServer.every(({ locations }) => formatLocations(locations, MAX_OUTPUT_CHARS) === "");
		const footer = `coverage: ${result.matchedServers.length} server(s) queried for this position; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; other positions and files not checked`;
		if (everySectionEmpty && failures.length === 0) {
			return text([...fixedLines, emptyMessage, footer].filter(Boolean).join("\n"));
		}

		const multipleServers = locationsByServer.length > 1;
		const headers = multipleServers ? locationsByServer.map(({ serverId }) => `${serverId}:`) : [];
		const fixedOutput = [...fixedLines, ...headers, footer].filter(Boolean).join("\n");
		const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - fixedOutput.length - (locationsByServer.length + 1)) / locationsByServer.length));
		const sections = locationsByServer.map(({ serverId, locations }) => {
			const formatted = formatLocations(locations, sectionBudget);
			return multipleServers ? `${serverId}:\n${formatted}` : formatted;
		});
		return text([...fixedLines, ...sections, footer].filter(Boolean).join("\n"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to retrieve ${kind}: ${message}`);
	}
}

async function runCallHierarchy(
	params: { path: string; line: number; character: number; mode?: string; item?: unknown },
	ctx: ExtensionToolContext,
	getSession: SessionForRoot,
	flavor: HierarchyFlavor = "call",
) {
	try {
		const allowedModes = flavor === "call" ? ["prepare", "incoming", "outgoing"] : ["prepare", "supertypes", "subtypes"];
		const noun = flavor === "call" ? "call hierarchy" : "type hierarchy";
		if (params.mode !== undefined && !allowedModes.includes(params.mode)) return text(`mode must be ${allowedModes.join(", ")}.`);
		const mode = (params.mode ?? "prepare") as "prepare" | "incoming" | "outgoing" | "supertypes" | "subtypes";
		if (mode !== "prepare" && (!params.item || typeof params.item !== "object" || Array.isArray(params.item))) {
			return text(`An object item is required; prepare first at a position, then pass an item with mode ${mode}.`);
		}
		const { path, line, character } = params;
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, path);
		const session = await getSession(cwd);
		const activation = await activate(session, absolutePath, "read");
		if (activation.kind === "untrusted") return text(activation.guidance);
		if (activation.kind === "no-match") return text("No language servers match this file.");
		if (activation.kind === "inactive") return text(activation.reason);
		if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) return text("line and character must be positive integers (1-based).");
		const uri = pathToFileURL(absolutePath).href;
		const failures: string[] = [];
		const unsupported: string[] = [];
		const results: HierarchyResult[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of activation.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			if (mode === "prepare") {
				const result = flavor === "call"
					? await session.prepareCallHierarchy(serverId, uri, line - 1, character - 1, timeoutMs, client)
					: await session.prepareTypeHierarchy(serverId, uri, line - 1, character - 1, timeoutMs, client);
				if (result.outcome === "failed") failures.push(`failed to retrieve ${noun} ${mode} from ${serverId}`);
				else if (result.outcome === "unsupported") unsupported.push(`${serverId} does not support ${noun}`);
				else results.push({ serverId, values: result.items });
			} else if (flavor === "call") {
				const result = await session.callHierarchyCalls(serverId, mode as "incoming" | "outgoing", params.item, timeoutMs, client);
				if (result.outcome === "failed") failures.push(`failed to retrieve ${noun} ${mode} from ${serverId}`);
				else if (result.outcome === "unsupported") unsupported.push(`${serverId} does not support ${noun}`);
				else results.push({ serverId, values: result.calls });
			} else {
				const result = await session.typeHierarchyDirections(serverId, mode as "supertypes" | "subtypes", params.item, timeoutMs, client);
				if (result.outcome === "failed") failures.push(`failed to retrieve ${noun} ${mode} from ${serverId}`);
				else if (result.outcome === "unsupported") unsupported.push(`${serverId} does not support ${noun}`);
				else results.push({ serverId, values: result.items });
			}
		}
		const lines = [...failures, ...unsupported];
		if (results.length === 0 && unsupported.length === activation.matchedServers.length) lines.push(`No matched language server supports ${noun} for this file.`);
		const multiple = results.length > 1;
		for (const { serverId, values } of results) {
			if (multiple) lines.push(`${serverId}:`);
			if (values.length === 0) lines.push(mode === "prepare" ? `No ${noun} items at this position.` : `No ${mode} ${flavor === "call" ? "calls" : "types"} reported.`);
			for (const [index, raw] of values.slice(0, 100).entries()) {
				if (!isRecord(raw)) { lines.push("… unreadable hierarchy entry omitted"); continue; }
				if (mode === "prepare" || flavor === "type") {
					lines.push(`${index + 1}. ${stringValue(raw.name, "(unnamed)")} (${symbolKindName(raw.kind)})${typeof raw.detail === "string" ? ` — ${raw.detail.slice(0, 120)}` : ""} — ${itemPosition(raw)}`);
				} else {
					const call = raw as Record<string, unknown>;
					const fromIsRecord = isRecord(call.from);
					const toIsRecord = isRecord(call.to);
					const from = (fromIsRecord ? call.from : {}) as Record<string, unknown>;
					const to = (toIsRecord ? call.to : {}) as Record<string, unknown>;
					const ranges = Array.isArray(call.fromRanges) ? call.fromRanges : [];
					lines.push(`${fromIsRecord ? stringValue(from.name, "(unnamed)") : "(malformed source)"} → ${toIsRecord ? stringValue(to.name, "(unnamed)") : "(malformed target)"} — ${fromIsRecord ? itemPosition(from, ranges[0]) : "?"} → ${toIsRecord ? itemPosition(to) : "?"}`);
				}
			}
			if (values.length > 100) lines.push(`… ${values.length - 100} more entries omitted (cap 100)`);
		}
		if (mode === "prepare") lines.push(`pass an item back verbatim as item with mode ${flavor === "call" ? "incoming or outgoing" : "supertypes or subtypes"}`);
		const coverage = `coverage: ${activation.matchedServers.length} server(s) queried for this position; results reflect each server's current view; positions are 1-based UTF-16 code units`;
		lines.push(coverage);
		const output = lines.join("\n");
		if (output.length <= MAX_OUTPUT_CHARS) return text(output);
		const prepareFooter = `pass an item back verbatim as item with mode ${flavor === "call" ? "incoming or outgoing" : "supertypes or subtypes"}`;
		const requiredFooter = mode === "prepare" ? `${prepareFooter}\n${coverage}` : coverage;
		const truncation = `… output truncated to ${MAX_OUTPUT_CHARS} characters\n${requiredFooter}`;
		return text(`${output.slice(0, Math.max(0, MAX_OUTPUT_CHARS - truncation.length - 1))}\n${truncation}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to retrieve ${flavor === "call" ? "call hierarchy" : "type hierarchy"}: ${message}`);
	}
}

function symbolKindName(kind: unknown): string {
	const names = ["", "File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface", "Function", "Variable", "Constant", "String", "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember", "Struct", "Event", "Operator", "TypeParameter"];
	return typeof kind === "number" ? names[kind] || "Unknown" : "Unknown";
}

function itemPosition(item: Record<string, unknown>, range?: unknown): string {
	const selection = isRecord(item.selectionRange) ? item.selectionRange : isRecord(range) ? range : undefined;
	const start = selection && isRecord(selection.start) ? selection.start : undefined;
	const line = start && typeof start.line === "number" ? start.line + 1 : 1;
	const character = start && typeof start.character === "number" ? start.character + 1 : 1;
	const uri = typeof item.uri === "string" ? item.uri : "";
	let file = uri;
	if (uri.startsWith("file://")) { try { file = decodeURIComponent(uri.slice("file://".length)); } catch { /* Keep original URI. */ } }
	return `${file}:${line}:${character}`;
}

function stringValue(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
