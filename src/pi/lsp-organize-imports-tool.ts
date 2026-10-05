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
	properties: { path: { type: "string" } },
	required: ["path"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type Action = { kind?: unknown; edit?: unknown; data?: unknown };
type Candidate = { serverId: string; action: Action; client?: RuntimeSession["pool"] extends Map<string, infer Client> ? Client : never; timeoutMs: number };

/** Register an on-demand, read-only organize-imports preview. */
export function registerLspOrganizeImportsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_organize_imports",
		label: "LSP organize imports",
		description: "Preview the organize-imports edit for one file, validated and bounded; nothing is ever applied and server commands are never executed.",
		parameters,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runOrganizeImports(params as { path: string }, ctx, getSession);
		},
	});
}

async function runOrganizeImports(params: { path: string }, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, params.path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);

		const uri = pathToFileURL(absolutePath).href;
		const point = { line: 0, character: 0 };
		const range = { start: point, end: point };
		const failures: string[] = [];
		const unsupported: string[] = [];
		const noActions: string[] = [];
		const candidates: Candidate[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const response = await session.codeActions(serverId, uri, range, timeoutMs, client);
			if (response.outcome === "failed") failures.push(`failed to retrieve code actions from ${serverId}`);
			else if (response.outcome === "unsupported") unsupported.push(`${serverId} does not support code actions`);
			else {
				const action = (response.actions as Action[]).find((item) => typeof item.kind === "string" && item.kind.startsWith("source.organizeImports"));
				if (!action) noActions.push(`${serverId} reported no organize-imports action.`);
				else candidates.push({ serverId, action, ...(client ? { client } : {}), timeoutMs });
			}
		}

		const readFile = async (path: string): Promise<string | undefined> => {
			try {
				const content = await session.fsReadFile(path, "utf8");
				return content.length <= MAX_READ_CHARS ? content : undefined;
			} catch { return undefined; }
		};
		const diagnostics = [...failures, ...unsupported, ...noActions];
		const previews: Array<{ serverId: string; validation: ValidationOk }> = [];
		for (const candidate of candidates) {
			const { serverId, client, timeoutMs, action: initialAction } = candidate;
			let action = initialAction;
			if (action.edit === undefined || action.edit === null) {
				if (!isRecord(action.data)) {
					diagnostics.push(`${serverId} reported no editable change.`);
					continue;
				}
				const resolved = await session.resolveCodeAction(serverId, action, timeoutMs, client);
				if (resolved.outcome === "failed") {
					diagnostics.push(`failed to resolve organize-imports on ${serverId}`);
					continue;
				}
				if (resolved.outcome !== "ok") {
					diagnostics.push(`${serverId} reported no editable change.`);
					continue;
				}
				action = resolved.action as Action;
			}
			if (action.edit === undefined || action.edit === null) {
				diagnostics.push(`${serverId} reported no editable change.`);
				continue;
			}
			const openVersions = new Map<string, number>();
			const version = client?.documents.version(uri);
			if (typeof version === "number") openVersions.set(uri, version);
			const validation = await validateWorkspaceEdit(action.edit, { canonicalRoot: result.canonicalRoot, readFile, openVersions });
			if (validation.verdict === "rejected") {
				diagnostics.push(`preview rejected for ${serverId}:`, ...validation.reasons);
				continue;
			}
			previews.push({ serverId, validation });
		}

		const footer = `preview only: nothing was applied; coverage: ${result.matchedServers.length} server(s) checked for this file; results reflect each server's current view and may lag recent edits`;
		const multi = previews.length > 1;
		const fixed = diagnostics;
		const fixedText = boundedLines(fixed, Math.max(0, MAX_OUTPUT_CHARS - footer.length - 1));
		const reserved = fixedText.length + (fixedText ? 1 : 0) + footer.length;
		const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - reserved - (previews.length ? previews.length : 0)) / Math.max(1, previews.length)));
		const sections: string[] = [];
		for (const preview of previews) {
			const heading = multi ? `${preview.serverId}:\n` : "";
			const rendered = await renderWorkspaceEdit(preview.validation, { readFile, maxChars: Math.max(1, sectionBudget - heading.length) });
			sections.push(`${heading}${rendered || "No preview shown."}`.slice(0, sectionBudget));
		}
		return text(compose(fixedText, sections, footer));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to preview organize imports: ${message}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedLines(lines: string[], budget: number): string {
	let output = "";
	for (const line of lines) {
		const available = budget - output.length - (output ? 1 : 0);
		if (available <= 0) break;
		const part = line.slice(0, available);
		output += `${output ? "\n" : ""}${part}`;
		if (part.length < line.length) break;
	}
	return output;
}
function compose(fixed: string, sections: string[], footer: string): string {
	const content = [fixed, ...sections].filter(Boolean).join("\n");
	const room = Math.max(0, MAX_OUTPUT_CHARS - footer.length - (content ? 1 : 0));
	return `${content.slice(0, room)}${content ? "\n" : ""}${footer}`.slice(0, MAX_OUTPUT_CHARS);
}
function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
