import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderWorkspaceEdit, validateWorkspaceEdit } from "../preview/workspace-edit.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const MAX_READ_CHARS = 1_000_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const LIST_FOOTER = (count: number) => `coverage: ${count} server(s) checked for this position; actions are listed as reported by servers; call this tool with an action number to preview its edit — previews are never applied, and commands are never executed`;
const PREVIEW_FOOTER = (count: number) => `preview only: nothing was applied; commands are never executed; coverage: ${count} server(s) checked for this position; results reflect each server's current view and may lag recent edits`;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const parameters = {
	type: "object",
	properties: {
		path: { type: "string" },
		line: { type: "integer", minimum: 1 },
		character: { type: "integer", minimum: 1 },
		action: { type: "integer", minimum: 1 },
	},
	required: ["path", "line", "character"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type Action = { title?: unknown; kind?: unknown; edit?: unknown; data?: unknown; command?: unknown };
type ContributingServer = { serverId: string; client?: RuntimeSession["pool"] extends Map<string, infer Client> ? Client : never; actions: Action[] };

/** Register an on-demand, read-only code-action listing and validated preview. */
export function registerLspCodeActionsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_code_actions",
		label: "LSP code actions",
		description: "List code actions at a position in one file, or preview one action's workspace edit (validated, never applied). Positions are 1-based UTF-16 code units; server commands are never executed.",
		parameters,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runCodeActions(params as { path: string; line: number; character: number; action?: number }, ctx, getSession);
		},
	});
}

async function runCodeActions(params: { path: string; line: number; character: number; action?: number }, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, params.path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);
		const { line, character, action: requestedAction } = params;
		if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) {
			return text("line and character must be positive integers (1-based).");
		}

		const uri = pathToFileURL(absolutePath).href;
		const point = { line: line - 1, character: character - 1 };
		const range = { start: point, end: point };
		const failures: string[] = [];
		const unsupported: string[] = [];
		const contributions: ContributingServer[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const outcome = await session.codeActions(serverId, uri, range, timeoutMs, client);
			if (outcome.outcome === "failed") failures.push(`failed to retrieve code actions from ${serverId}`);
			else if (outcome.outcome === "unsupported") unsupported.push(`${serverId} does not support code actions`);
			else contributions.push({ serverId, ...(client ? { client } : {}), actions: outcome.actions as Action[] });
		}

		if (requestedAction === undefined) {
			const actionCount = contributions.reduce((count, item) => count + item.actions.length, 0);
			const footer = LIST_FOOTER(result.matchedServers.length);
			const lines = [...failures, ...unsupported];
			if (actionCount === 0) lines.push("No code actions reported at this position.");
			const multiple = contributions.filter(({ actions }) => actions.length > 0).length > 1;
			let index = 0;
			for (const contribution of contributions) {
				if (contribution.actions.length === 0) continue;
				if (multiple) lines.push(`${contribution.serverId}:`);
				for (const action of contribution.actions) {
					index += 1;
					const title = typeof action.title === "string" ? action.title : "(untitled)";
					const kindText = typeof action.kind === "string" && action.kind.length > 0 ? ` (${action.kind})` : "";
					lines.push(`${index}. [${actionMarker(action)}] ${title}${kindText}`);
				}
			}
			return text(budgeted(lines, footer));
		}

		const k = requestedAction;
		if (!Number.isInteger(k) || k < 1) return text("action must be a positive integer.");
		const flattened = contributions.flatMap((contribution) => contribution.actions.map((action) => ({ ...contribution, action })));
		const selected = flattened[k - 1];
		const footer = PREVIEW_FOOTER(result.matchedServers.length);
		if (!selected) return text(budgeted([...failures, ...unsupported, `No action at index ${k}. Call without action to list available actions.`], footer));
		const { serverId, client } = selected;
		let { action } = selected;
		if (!hasEdit(action) && action.command !== undefined) {
			return text(budgeted([...failures, ...unsupported, `Action ${k} is command-only; pi-lsp-onread never executes server commands.`], footer));
		}
		if (!hasEdit(action) && isRecord(action.data)) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const resolved = await session.resolveCodeAction(serverId, action, timeoutMs, client);
			if (resolved.outcome === "failed") return text(budgeted([...failures, ...unsupported, `failed to resolve action ${k} on ${serverId}`], footer));
			if (resolved.outcome === "ok") action = resolved.action as Action;
		}
		if (!hasEdit(action)) return text(budgeted([...failures, ...unsupported, `Action ${k} has no edit to preview.`], footer));

		const readFile = async (path: string): Promise<string | undefined> => {
			try {
				const content = await session.fsReadFile(path, "utf8");
				return content.length <= MAX_READ_CHARS ? content : undefined;
			} catch { return undefined; }
		};
		const openVersions = new Map<string, number>();
		for (const contribution of contributions) {
			const version = contribution.client?.documents.version(uri);
			if (typeof version === "number") openVersions.set(uri, version);
		}
		const validation = await validateWorkspaceEdit(action.edit, { canonicalRoot: result.canonicalRoot, readFile, openVersions });
		if (validation.verdict === "rejected") {
			return text(budgeted([...failures, ...unsupported, `preview rejected for action ${k}:`, ...validation.reasons], footer));
		}
		const title = typeof action.title === "string" ? action.title : "(untitled)";
		const prefix = `action ${k}: ${title}`;
		const fixed = [...failures, ...unsupported, prefix];
		const fixedLength = fixed.join("\n").length + footer.length + fixed.length + 1;
		const renderBudget = Math.max(1, MAX_OUTPUT_CHARS - fixedLength);
		const rendered = await renderWorkspaceEdit(validation, { readFile, maxChars: renderBudget });
		return text(budgeted([...fixed, ...(rendered ? [rendered] : ["No preview shown."])], footer));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to retrieve code actions: ${message}`);
	}
}

function actionMarker(action: Action): string {
	if (hasEdit(action)) return "previewable";
	if (isRecord(action.data)) return "needs resolve";
	if (action.command !== undefined) return "command only — not previewable";
	return "no preview available";
}

function hasEdit(action: Action): boolean { return action.edit !== undefined && action.edit !== null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
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
