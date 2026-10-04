import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { formatWorkspaceSymbols } from "../symbols/format.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const params = {
	type: "object",
	properties: { path: { type: "string" }, query: { type: "string" } },
	required: ["path", "query"],
	additionalProperties: false,
} as never;
const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type SymbolResult = { serverId: string; symbols: unknown[] };

/** Register an on-demand, read-only workspace symbol search. */
export function registerLspWorkspaceSymbolsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_workspace_symbols",
		label: "LSP workspace symbol search",
		description: "Search symbol names across the workspace via the language servers that match an anchor file; returns bounded results with locations, freshness, and coverage.",
		parameters: params,
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			try {
				const { path } = params as { path: string; query: string };
				const cwd = resolve(ctx.cwd);
				const absolutePath = resolve(cwd, path);
				const session = await getSession(cwd);
				const result = await activate(session, absolutePath, "read");
				if (result.kind === "untrusted") return text(result.guidance);
				if (result.kind === "no-match") return text("No language servers match this file.");
				if (result.kind === "inactive") return text(result.reason);

				const query = (params as { query: string }).query.trim();
				if (query.length === 0) return text("Search query must not be empty.");

				const failures: string[] = [];
				const unsupported: string[] = [];
				const symbolsByServer: SymbolResult[] = [];
				const config = session.configResult.ok ? session.configResult.config : undefined;
				for (const serverId of result.matchedServers) {
					const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
					const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
					const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
					const outcome = await session.workspaceSymbols(serverId, query, timeoutMs, client);
					if (outcome.outcome === "failed") failures.push(`failed to search symbols on ${serverId}`);
					else if (outcome.outcome === "unsupported") unsupported.push(`${serverId} does not support workspace symbol search`);
					else symbolsByServer.push({ serverId, symbols: outcome.symbols });
				}

				const footer = symbolsByServer.length > 0
					? `coverage: ${result.matchedServers.length} server(s) queried through this file's matched servers; results reflect each server's current index and may lag recent edits; entries beyond limits are omitted; workspace completeness is never checked`
					: "";
				const fixedLines = [...failures, ...unsupported];
				if (symbolsByServer.length === 0) {
					if (unsupported.length === result.matchedServers.length) {
						fixedLines.push("No matched language server supports workspace symbol search for this file.");
					}
					return text(fixedLines.join("\n"));
				}

				const everySectionEmpty = symbolsByServer.every(({ symbols }) => formatWorkspaceSymbols(symbols, MAX_OUTPUT_CHARS) === "");
				if (everySectionEmpty && failures.length === 0) {
					return text([...fixedLines, `No symbols matched "${query}" in the server's current index.`, footer].filter(Boolean).join("\n"));
				}

				const multipleServers = symbolsByServer.length > 1;
				const headers = multipleServers ? symbolsByServer.map(({ serverId }) => `${serverId}:`) : [];
				const fixedOutput = [...fixedLines, ...headers, footer].filter(Boolean).join("\n");
				const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - fixedOutput.length - (symbolsByServer.length + 1)) / symbolsByServer.length));
				const sections = symbolsByServer.map(({ serverId, symbols }) => {
					const formatted = formatWorkspaceSymbols(symbols, sectionBudget);
					return multipleServers ? `${serverId}:\n${formatted}` : formatted;
				});
				return text([...fixedLines, ...sections, footer].filter(Boolean).join("\n"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return text(`Unable to search workspace symbols: ${message}`);
			}
		},
	});
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
