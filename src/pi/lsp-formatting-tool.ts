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
		tabSize: { type: "integer", minimum: 1 },
		insertSpaces: { type: "boolean" },
		trimTrailingWhitespace: { type: "boolean" },
		insertFinalNewline: { type: "boolean" },
		trimFinalNewlines: { type: "boolean" },
	},
	required: ["path"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type Client = RuntimeSession["pool"] extends Map<string, infer Value> ? Value : never;
type FormattingOptions = { tabSize: number; insertSpaces: boolean; trimTrailingWhitespace?: boolean; insertFinalNewline?: boolean; trimFinalNewlines?: boolean };
type PreviewResult = { serverId: string; client?: Client; edits: unknown[] };

/** Register a trust-gated formatting tool that validates and renders previews without applying edits. */
export function registerLspFormattingTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_formatting",
		label: "LSP formatting",
		description: "Preview formatting edits from matched language servers. Edits are validated and rendered only; nothing is applied.",
		parameters,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runFormatting(params as { path: string; tabSize?: number; insertSpaces?: boolean; trimTrailingWhitespace?: boolean; insertFinalNewline?: boolean; trimFinalNewlines?: boolean }, ctx, getSession);
		},
	});
}

async function runFormatting(params: { path: string; tabSize?: number; insertSpaces?: boolean; trimTrailingWhitespace?: boolean; insertFinalNewline?: boolean; trimFinalNewlines?: boolean }, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, params.path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);

		const options: FormattingOptions = {
			tabSize: typeof params.tabSize === "number" && Number.isInteger(params.tabSize) && params.tabSize >= 1 ? params.tabSize : 2,
			insertSpaces: params.insertSpaces ?? true,
			...(params.trimTrailingWhitespace === undefined ? {} : { trimTrailingWhitespace: params.trimTrailingWhitespace }),
			...(params.insertFinalNewline === undefined ? {} : { insertFinalNewline: params.insertFinalNewline }),
			...(params.trimFinalNewlines === undefined ? {} : { trimFinalNewlines: params.trimFinalNewlines }),
		};
		const uri = pathToFileURL(absolutePath).href;
		const config = session.configResult.ok ? session.configResult.config : undefined;
		const lines: string[] = [];
		const previews: PreviewResult[] = [];
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const outcome = await session.formatting(serverId, uri, options, timeoutMs, client);
			if (outcome.outcome === "unsupported") lines.push(`${serverId} does not support formatting.`);
			else if (outcome.outcome === "failed") lines.push(`failed to retrieve formatting edits from ${serverId}`);
			else if (outcome.edits.length === 0) lines.push(`${serverId}: no formatting changes.`);
			else previews.push({ serverId, ...(client ? { client } : {}), edits: outcome.edits });
		}
		const readFile = async (path: string): Promise<string | undefined> => {
			try {
				const content = await session.fsReadFile(path, "utf8");
				return content.length <= MAX_READ_CHARS ? content : undefined;
			} catch { return undefined; }
		};
		const sections: Array<{ serverId: string; validation: ValidationOk }> = [];
		const rejected: string[] = [];
		for (const { serverId, client, edits } of previews) {
			const openVersions = new Map<string, number>();
			const version = client?.documents.version(uri);
			if (typeof version === "number") openVersions.set(uri, version);
			const validation = await validateWorkspaceEdit({ changes: { [uri]: edits } }, {
				canonicalRoot: result.canonicalRoot,
				readFile,
				openVersions,
			});
			if (validation.verdict === "rejected") {
				rejected.push(`${serverId}: preview rejected:`, ...validation.reasons);
				continue;
			}
			sections.push({ serverId, validation });
		}
		const enabledOptions = [
			...(options.trimTrailingWhitespace === undefined ? [] : ["trimTrailingWhitespace"]),
			...(options.insertFinalNewline === undefined ? [] : ["insertFinalNewline"]),
			...(options.trimFinalNewlines === undefined ? [] : ["trimFinalNewlines"]),
		];
		const optionText = `tabSize ${options.tabSize}, insertSpaces ${options.insertSpaces}${enabledOptions.map((option) => `, ${option}`).join("")}`;
		const footer = `preview only: nothing was applied; options: ${optionText}; coverage: ${result.matchedServers.length} server(s) checked for this file; results reflect each server's current view and may lag recent edits; other files are not formatted`;
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
		if (renderedSections.length === 0) body.push("No formatting preview available.");
		return text(budgeted(body, footer));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to format: ${message}`);
	}
}

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
