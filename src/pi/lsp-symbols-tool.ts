import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDocumentSymbols } from "../symbols/format.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const params = {
	type: "object",
	properties: { path: { type: "string" } },
	required: ["path"],
	additionalProperties: false,
} as never;
const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type SymbolResult = { serverId: string; symbols: unknown[] };

/** Register an on-demand, read-only document outline query. */
export function registerLspSymbolsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_symbols",
		label: "LSP document symbols",
		description: "Return a bounded document outline for one file, including symbol kinds, ranges, freshness, and coverage.",
		parameters: params,
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			try {
				const { path } = params as { path: string };
				const cwd = resolve(ctx.cwd);
				const absolutePath = resolve(cwd, path);
				const session = await getSession(cwd);
				const result = await activate(session, absolutePath, "read");
				if (result.kind === "untrusted") return text(result.guidance);
				if (result.kind === "no-match") return text("No language servers match this file.");
				if (result.kind === "inactive") return text(result.reason);

				const uri = pathToFileURL(absolutePath).href;
				const failures: string[] = [];
				const unsupported: string[] = [];
				const symbolsByServer: SymbolResult[] = [];
				const config = session.configResult.ok ? session.configResult.config : undefined;
				for (const serverId of result.matchedServers) {
					const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
					const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
					const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
					const outcome = await session.documentSymbols(serverId, uri, timeoutMs, client);
					if (outcome.outcome === "failed") failures.push(`failed to retrieve document symbols from ${serverId}`);
					else if (outcome.outcome === "unsupported") unsupported.push(`${serverId} does not support document symbols`);
					else symbolsByServer.push({ serverId, symbols: outcome.symbols });
				}

				const footer = symbolsByServer.length > 0
					? `coverage: ${result.matchedServers.length} server(s) checked for this file; outline reflects each server's current view and may lag recent edits; other files and workspace not checked`
					: "";
				const fixedLines = [...failures, ...unsupported];
				if (symbolsByServer.length === 0) {
					if (unsupported.length === result.matchedServers.length) {
						fixedLines.push("No matched language server supports document symbols for this file.");
					}
					return text(fixedLines.join("\n"));
				}

				const hasReadableSymbols = symbolsByServer.some(({ symbols }) => formatDocumentSymbols(symbols, MAX_OUTPUT_CHARS) !== "");
				if (!hasReadableSymbols && failures.length === 0) {
					const fixed = [...fixedLines, "No symbols reported for this file.", footer].filter(Boolean).join("\n");
					return text(fixed);
				}

				const multipleServers = symbolsByServer.length > 1;
				const headers = multipleServers ? symbolsByServer.map(({ serverId }) => `${serverId}:`) : [];
				const fixedOutput = [...fixedLines, ...headers, footer].filter(Boolean).join("\n");
				const sectionBudget = Math.max(1, Math.floor((MAX_OUTPUT_CHARS - fixedOutput.length - (symbolsByServer.length + 1)) / symbolsByServer.length));
				const sections = symbolsByServer.map(({ serverId, symbols }) => {
					const formatted = formatDocumentSymbols(symbols, sectionBudget);
					return multipleServers ? `${serverId}:\n${formatted}` : formatted;
				});
				return text([...fixedLines, ...sections, footer].filter(Boolean).join("\n"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return text(`Unable to retrieve document symbols: ${message}`);
			}
		},
	});
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
