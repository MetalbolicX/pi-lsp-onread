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
type NavigationKind = "definition" | "references";
type NavigationResult = { serverId: string; locations: unknown[] };
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
				: await session.references(request.serverId, request.uri, request.line, request.character, request.includeDeclaration, request.timeoutMs, request.client);
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
			: "No references reported at this position.";
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

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
