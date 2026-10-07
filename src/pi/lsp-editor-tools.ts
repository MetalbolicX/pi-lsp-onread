import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type EditorMode = "selection" | "highlight" | "lens";
type EditorResult = { serverId: string; values: unknown[] };
const positionParams = {
	type: "object", properties: { path: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 } },
	required: ["path", "line", "character"], additionalProperties: false,
} as never;
const lensParams = {
	type: "object", properties: { path: { type: "string" }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } },
	required: ["path"], additionalProperties: false,
} as never;

export function registerLspSelectionRangeTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({ name: "lsp_selection_range", label: "LSP selection range", description: "Show server-provided nested selection ranges at a position; positions are 1-based UTF-16 code units.", parameters: positionParams, annotations,
		async execute(_id, params, _signal, _update, ctx: ExtensionToolContext) { return runEditor("selection", params as PositionParams, ctx, getSession); },
	});
}
export function registerLspDocumentHighlightTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({ name: "lsp_document_highlight", label: "LSP document highlight", description: "Show document highlights at a position; positions are 1-based UTF-16 code units.", parameters: positionParams, annotations,
		async execute(_id, params, _signal, _update, ctx: ExtensionToolContext) { return runEditor("highlight", params as PositionParams, ctx, getSession); },
	});
}
export function registerLspCodeLensTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({ name: "lsp_code_lens", label: "LSP code lens", description: "Preview code-lens titles in a bounded line window; commands are never executed.", parameters: lensParams, annotations,
		async execute(_id, params, _signal, _update, ctx: ExtensionToolContext) { return runEditor("lens", params as LensParams, ctx, getSession); },
	});
}

type PositionParams = { path: string; line: number; character: number };
type LensParams = { path: string; startLine?: number; endLine?: number };
async function runEditor(mode: EditorMode, params: PositionParams | LensParams, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, params.path);
		const session = await getSession(cwd);
		const activation = await activate(session, absolutePath, "read");
		if (activation.kind === "untrusted") return text(activation.guidance);
		if (activation.kind === "no-match") return text("No language servers match this file.");
		if (activation.kind === "inactive") return text(activation.reason);
		let startLine = 1;
		let endLine = 200;
		if (mode === "lens") {
			const lensParams = params as LensParams;
			startLine = lensParams.startLine ?? 1;
			endLine = lensParams.endLine ?? startLine + 199;
			if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(endLine) || endLine < 1) return text("startLine and endLine must be positive integers (1-based).");
			if (lensParams.startLine !== undefined && lensParams.endLine !== undefined && startLine > endLine) return text("startLine must be <= endLine.");
			if (endLine - startLine >= 2000) endLine = startLine + 1999;
		} else {
			const { line, character } = params as PositionParams;
			if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) return text("line and character must be positive integers (1-based).");
		}
		const uri = pathToFileURL(absolutePath).href;
		const failures: string[] = [];
		const unsupported: string[] = [];
		const results: EditorResult[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of activation.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeout = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const p = params as PositionParams;
			const result = mode === "selection"
				? await session.selectionRange(serverId, uri, p.line - 1, p.character - 1, timeout, client)
				: mode === "highlight"
					? await session.documentHighlight(serverId, uri, p.line - 1, p.character - 1, timeout, client)
					: await session.codeLens(serverId, uri, startLine - 1, endLine, timeout, client);
			if (result.outcome === "failed") failures.push(`failed to retrieve ${modeLabel(mode)} from ${serverId}`);
			else if (result.outcome === "unsupported") unsupported.push(`${serverId} does not support ${modeLabel(mode)}`);
			else {
				const values = "ranges" in result ? result.ranges : "highlights" in result ? result.highlights : result.lenses;
				results.push({ serverId, values });
			}
		}
		const lines = [...failures, ...unsupported];
		if (results.length === 0 && unsupported.length === activation.matchedServers.length) lines.push(`No matched language server supports ${modeLabel(mode)} for this file.`);
		const multiple = results.length > 1;
		for (const { serverId, values } of results) {
			if (multiple) lines.push(`${serverId}:`);
			const formatted = values.slice(0, 100).flatMap((value, index) => formatValue(mode, value, index + 1));
			if (formatted.length === 0) lines.push(mode === "selection" ? "No selection ranges reported." : mode === "highlight" ? "No document highlights reported." : "No code lenses in the requested range.");
			lines.push(...formatted);
			if (values.length > 100) lines.push(`… ${values.length - 100} more ${mode === "highlight" ? "highlights" : mode === "lens" ? "code lenses" : "ranges"} omitted (cap 100)`);
		}
		const coverage = `coverage: ${activation.matchedServers.length} server(s) queried for this ${mode === "lens" ? "range" : "position"}; results reflect each server's current view; positions are 1-based UTF-16 code units`;
		lines.push(coverage);
		if (mode === "selection") lines.push("selection chain is server-provided nesting, not an edit judgment");
		if (mode === "lens") lines.push("commands are displayed only — never executed; titles may be unresolved (codeLens/resolve is not called)");
		return bounded(lines, mode);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to retrieve ${modeLabel(mode)}: ${message}`);
	}
}

function formatValue(mode: EditorMode, value: unknown, index: number): string[] {
	if (!isRecord(value)) return [];
	if (mode === "selection") {
		const range = value;
		const start = isRecord(range.start) ? range.start : undefined;
		const end = isRecord(range.end) ? range.end : undefined;
		if (!start || !end || !validCoord(start.line) || !validCoord(start.character) || !validCoord(end.line) || !validCoord(end.character)) return [];
		return [`${index}. L${start.line + 1}:${start.character + 1} – L${end.line + 1}:${end.character + 1}`];
	}
	const range = isRecord(value.range) ? value.range : undefined;
	const start = range && isRecord(range.start) ? range.start : undefined;
	const end = range && isRecord(range.end) ? range.end : undefined;
	if (!start || !end || !validCoord(start.line) || !validCoord(start.character) || !validCoord(end.line) || !validCoord(end.character)) return [];
	if (mode === "highlight") {
		const kind = value.kind === 1 ? "text" : value.kind === 2 ? "read" : value.kind === 3 ? "write" : value.kind === undefined ? "unknown" : "unknown";
		return [`L${start.line + 1}:C${start.character + 1}–L${end.line + 1}:C${end.character + 1} (${kind})`];
	}
	const command = isRecord(value.command) ? value.command : undefined;
	const title = command && typeof command.title === "string" ? command.title : "(no title)";
	return [`L${start.line + 1}:C${start.character + 1} "${title.replace(/[\r\n"]+/g, " ")}"`];
}
function validCoord(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function modeLabel(mode: EditorMode): string { return mode === "selection" ? "selection range" : mode === "highlight" ? "document highlight" : "code lens"; }
function bounded(lines: string[], _mode: EditorMode) {
	const output = lines.join("\n");
	if (output.length <= MAX_OUTPUT_CHARS) return text(output);
	const footerLines = lines.filter((line) => line.startsWith("coverage:") || line.includes("server-provided nesting") || line.includes("commands are displayed only"));
	const truncation = `… output truncated to ${MAX_OUTPUT_CHARS} characters\n${footerLines.join("\n")}`;
	return text(`${output.slice(0, Math.max(0, MAX_OUTPUT_CHARS - truncation.length - 1))}\n${truncation}`);
}
function text(value: string) { return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined }; }
