import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

// The API consumes standard JSON Schema at runtime; avoid a direct dependency on its optional TypeBox helper.
const params = {
	type: "object",
	properties: { path: { type: "string" } },
	required: ["path"],
	additionalProperties: false,
} as never;
const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;

/** Register an on-demand, read-only diagnostic query backed by the same lazy session as hooks. */
export function registerLspDiagnosticsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
	pi.registerTool({
		name: "lsp_diagnostics",
		label: "LSP diagnostics",
		description: "Return current language-server diagnostics for one file, including freshness and coverage.",
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
				const config = session.configResult.ok ? session.configResult.config : undefined;
				for (const serverId of result.matchedServers) {
					const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
					const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
					if (!client || client.capabilities()?.diagnosticProvider === undefined) continue;
					// Keep model-triggered pulls bounded even when config opts into longer request timeouts.
					const timeoutMs = Math.min(server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS, DEFAULT_PULL_TIMEOUT_MS);
					const outcome = await session.pullFresh(serverId, uri, timeoutMs, client);
					if (outcome === "failed") failures.push(`failed to pull diagnostics from ${serverId}`);
				}
				const refreshed = await activate(session, absolutePath, "read");
				const formatted = refreshed.kind === "ok" ? refreshed.formatted : result.formatted;
				const coverage = `coverage: ${result.matchedServers.length} server(s) checked for this file; other files and workspace not checked`;
				const failureText = failures.map((failure) => failure.slice(0, 300)).join("\n");
				const diagnosticsText = failures.length > 0
					? `Diagnostics withheld because a pull failed; cached results may be stale.`
					: formatted;
				const formattedBudget = Math.max(0, MAX_OUTPUT_CHARS - failureText.length - coverage.length - 2);
				return text([failureText, diagnosticsText.slice(0, formattedBudget), coverage].filter(Boolean).join("\n"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return text(`Unable to retrieve language-server diagnostics: ${message}`.slice(0, MAX_OUTPUT_CHARS));
			}
		},
	});
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }], details: undefined };
}
