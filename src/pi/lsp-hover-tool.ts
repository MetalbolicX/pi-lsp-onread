import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatHover } from "../hover/format.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const params = {
	type: "object",
	properties: { path: { type: "string" }, line: { type: "integer", minimum: 1 }, character: { type: "integer", minimum: 1 } },
	required: ["path", "line", "character"],
	additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type HoverResult = { serverId: string; hover: unknown };

/** Register an on-demand, read-only hover lookup. */
export function registerLspHoverTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_hover",
		label: "LSP hover",
		description: "Preview hover information for one file position; results are read-only and positions are 1-based UTF-16 code units.",
		parameters: params,
		annotations,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			return runHover(params as { path: string; line: number; character: number }, ctx, getSession);
		},
	});
}

async function runHover(params: { path: string; line: number; character: number }, ctx: ExtensionToolContext, getSession: SessionForRoot) {
	try {
		const { path, line, character } = params;
		const cwd = resolve(ctx.cwd);
		const absolutePath = resolve(cwd, path);
		const session = await getSession(cwd);
		const result = await activate(session, absolutePath, "read");
		if (result.kind === "untrusted") return text(result.guidance);
		if (result.kind === "no-match") return text("No language servers match this file.");
		if (result.kind === "inactive") return text(result.reason);
		if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) return text("line and character must be positive integers (1-based).");

		const uri = pathToFileURL(absolutePath).href;
		const failures: string[] = [];
		const unsupported: string[] = [];
		const results: HoverResult[] = [];
		const config = session.configResult.ok ? session.configResult.config : undefined;
		for (const serverId of result.matchedServers) {
			const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
			const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
			const outcome = await session.hover(serverId, uri, line - 1, character - 1, timeoutMs, client);
			if (outcome.outcome === "failed") failures.push(`failed to retrieve hover from ${serverId}`);
			else if (outcome.outcome === "unsupported") unsupported.push(`${serverId} does not support hover`);
			else results.push({ serverId, hover: outcome.hover });
		}

		const fixedLines = [...failures, ...unsupported];
		if (results.length === 0) return text(fixedLines.join("\n"));
		const footer = `coverage: ${result.matchedServers.length} server(s) queried for this position; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; other positions and files not checked`;
		const everySectionEmpty = results.every(({ hover }) => formatHover(hover, MAX_OUTPUT_CHARS) === "");
		if (everySectionEmpty && failures.length === 0) return text([...fixedLines, "No hover found at this position.", footer].filter(Boolean).join("\n"));

		const multipleServers = results.length > 1;
		const headers = multipleServers ? results.map(({ serverId }) => `${serverId}:`) : [];
		const fixedOutput = [...fixedLines, ...headers, footer].filter(Boolean).join("\n");
		const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - fixedOutput.length - (results.length + 1)) / results.length));
		const sections = results.map(({ serverId, hover }) => {
			const formatted = formatHover(hover, sectionBudget);
			return multipleServers ? `${serverId}:\n${formatted}` : formatted;
		});
		return text([...fixedLines, ...sections, footer].filter(Boolean).join("\n"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`Unable to retrieve hover: ${message}`);
	}
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
