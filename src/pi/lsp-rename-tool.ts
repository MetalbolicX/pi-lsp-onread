import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderWorkspaceEdit, validateWorkspaceEdit, type ValidationOk } from "../preview/workspace-edit.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const MAX_READ_CHARS = 1_000_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const parameters = {
	type: "object",
	properties: {
		path: { type: "string" },
		line: { type: "integer", minimum: 1 },
		character: { type: "integer", minimum: 1 },
		newName: { type: "string" },
		mode: { type: "string", enum: ["prepare", "preview"] },
	},
	required: ["path", "line", "character"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type Client = RuntimeSession["pool"] extends Map<string, infer Value> ? Value : never;
type PrepareResult = { serverId: string; client?: Client; prepare: unknown };
type PreviewResult = { serverId: string; client?: Client; edit: unknown };

/** Register a trust-gated rename preparation and validated, non-applying preview tool. */
export function registerLspRenameTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_rename",
		label: "LSP rename",
		description: "Prepare or preview a server-provided rename at a document position. Edits are validated and rendered only; nothing is applied. Positions are 1-based UTF-16 code units.",
		parameters,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runRename(params as { path: string; line: number; character: number; newName?: string; mode?: string }, ctx, getSession);
		},
	});
}

async function runRename(params: { path: string; line: number; character: number; newName?: string; mode?: string }, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, params.path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);
		const mode = params.mode ?? "preview";
		const { line, character } = params;
		if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) {
			return text("line and character must be positive integers (1-based).");
		}
		if (mode === "preview" && (typeof params.newName !== "string" || params.newName.length === 0)) {
			return text("newName must be a non-empty string.");
		}

		const uri = pathToFileURL(absolutePath).href;
		const config = session.configResult.ok ? session.configResult.config : undefined;
		if (mode === "prepare") {
			const lines: string[] = [];
			const prepared: PrepareResult[] = [];
			for (const serverId of result.matchedServers) {
				const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
				const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
				const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
				const outcome = await session.prepareRename(serverId, uri, line - 1, character - 1, timeoutMs, client);
				if (outcome.outcome === "unsupported") lines.push(`${serverId} does not support prepareRename (plain rename may still be available).`);
				else if (outcome.outcome === "failed") lines.push(`failed to prepare rename on ${serverId}`);
				else if (outcome.prepare === null) lines.push(`${serverId}: position is not renamable (server returned no prepare result).`);
				else prepared.push({ serverId, ...(client ? { client } : {}), prepare: outcome.prepare });
			}
			for (const { serverId, prepare } of prepared) {
				const value = isRecord(prepare) ? prepare : {};
				const placeholder = typeof value.placeholder === "string" ? value.placeholder : "";
				const bareRange = isRecord(prepare) && isRecord(prepare.start) && isRecord(prepare.end)
					&& isCoordinate(prepare.start.line) && isCoordinate(prepare.start.character)
					&& isCoordinate(prepare.end.line) && isCoordinate(prepare.end.character);
				const rangeValue = bareRange ? prepare : value.range;
				const range = isRecord(rangeValue) && isRecord(rangeValue.start) && isRecord(rangeValue.end)
					&& isCoordinate(rangeValue.start.line) && isCoordinate(rangeValue.start.character)
					&& isCoordinate(rangeValue.end.line) && isCoordinate(rangeValue.end.character)
					? rangeValue as { start: { line: number; character: number }; end: { line: number; character: number } }
					: undefined;
				const at = range ? ` at L${range.start.line + 1}:C${range.start.character + 1}-L${range.end.line + 1}:C${range.end.character + 1}` : "";
				lines.push(`${serverId}: ready to rename${placeholder ? ` "${placeholder}"` : ""}${at}.`);
			}
			if (prepared.length === 0) lines.push("No matched language server offers prepareRename for this position.");
			const footer = `coverage: ${result.matchedServers.length} server(s) checked for this position; readiness reflects each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; nothing was applied`;
			return text(budgeted(lines, footer));
		}

		const lines: string[] = [];
		const previews: PreviewResult[] = [];
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const outcome = await session.rename(serverId, uri, line - 1, character - 1, params.newName!, timeoutMs, client);
			if (outcome.outcome === "unsupported") lines.push(`${serverId} does not support rename.`);
			else if (outcome.outcome === "failed") lines.push(`failed to retrieve rename edit from ${serverId}`);
			else if (outcome.edit === null) lines.push(`${serverId} returned no rename edit.`);
			else previews.push({ serverId, ...(client ? { client } : {}), edit: outcome.edit });
		}
		const readFile = async (path: string): Promise<string | undefined> => {
			try {
				const content = await session.fsReadFile(path, "utf8");
				return content.length <= MAX_READ_CHARS ? content : undefined;
			} catch { return undefined; }
		};
		const sections: Array<{ serverId: string; validation: ValidationOk }> = [];
		const rejected: string[] = [];
		for (const { serverId, client, edit } of previews) {
			const openVersions = new Map<string, number>();
			const version = client?.documents.version(uri);
			if (typeof version === "number") openVersions.set(uri, version);
			const validation = await validateWorkspaceEdit(edit, { canonicalRoot: result.canonicalRoot, readFile, openVersions });
			if (validation.verdict === "rejected") {
				rejected.push(`${serverId}: preview rejected:`, ...validation.reasons);
				continue;
			}
			sections.push({ serverId, validation });
		}
		const footer = `preview only: nothing was applied; coverage: ${result.matchedServers.length} server(s) checked for this position; multi-file edits are rendered per file; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units`;
		const multipleSections = sections.length > 1;
		const headerLines = multipleSections ? sections.map(({ serverId }) => `${serverId}:`) : [];
		const fixed = [...lines, ...rejected, ...headerLines];
		const fixedLength = fixed.join("\n").length + footer.length + fixed.length + 1;
		const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - fixedLength) / Math.max(1, sections.length)));
		const renderedSections: string[] = [];
		for (const { serverId, validation } of sections) {
			const rendered = await renderWorkspaceEdit(validation, { readFile, maxChars: sectionBudget });
			if (rendered) renderedSections.push(multipleSections ? `${serverId}:\n${rendered}` : rendered);
		}
		const body = [...lines, ...rejected, ...renderedSections];
		if (renderedSections.length === 0) body.push("No rename preview available.");
		return text(budgeted(body, footer));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to rename: ${message}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCoordinate(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function budgeted(lines: string[], footer: string): string {
	const footerText = footer.slice(0, MAX_OUTPUT_CHARS);
	const bodyBudget = Math.max(0, MAX_OUTPUT_CHARS - footerText.length - (lines.length > 0 ? 1 : 0));
	let body = "";
	for (const line of lines) {
		const separator = body.length > 0 ? 1 : 0;
		const available = bodyBudget - body.length - separator;
		if (available <= 0) break;
		const addition = line.length > available ? line.slice(0, available) : line;
		body += `${body.length > 0 ? "\n" : ""}${addition}`;
		if (addition.length < line.length) break;
	}
	return [body, footerText].filter(Boolean).join("\n").slice(0, MAX_OUTPUT_CHARS);
}
function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
