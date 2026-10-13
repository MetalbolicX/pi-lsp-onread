import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatInlayHints } from "../inlay/format.js";
import { activate } from "../runtime/activation.js";
import type { RuntimeSession } from "../runtime/session.js";

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_PULL_TIMEOUT_MS = 5_000;
const MAX_RESOLVE_ATTEMPTS = 20;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const params = {
  type: "object",
  properties: {
    path: { type: "string" },
    startLine: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
  },
  required: ["path"],
  additionalProperties: false,
} as never;

type SessionForRoot = (projectRoot: string) => Promise<RuntimeSession>;
type InlayResult = { serverId: string; hints: unknown[] };

/** Register an on-demand, read-only inlay-hint lookup. */
export function registerLspInlayHintsTool(pi: ExtensionAPI, getSession: SessionForRoot): void {
  pi.registerTool({
    name: "lsp_inlay_hints",
    label: "LSP inlay hints",
    description:
      "Preview inlay hints in a bounded line range, including resolved tooltips when supported; lines are 1-based.",
    parameters: params,
    annotations,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
      return runInlayHints(
        params as { path: string; startLine?: number; endLine?: number },
        ctx,
        getSession,
      );
    },
  });
}

async function runInlayHints(
  params: { path: string; startLine?: number; endLine?: number },
  ctx: ExtensionToolContext,
  getSession: SessionForRoot,
) {
  try {
    const cwd = resolve(ctx.cwd);
    const absolutePath = resolve(cwd, params.path);
    const session = await getSession(cwd);
    const result = await activate(session, absolutePath, "read");
    if (result.kind === "untrusted") return text(result.guidance);
    if (result.kind === "no-match") return text("No language servers match this file.");
    if (result.kind === "inactive") return text(result.reason);

    const startLine = params.startLine ?? 1;
    let endLine = params.endLine ?? startLine + 199;
    if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(endLine) || endLine < 1)
      return text("startLine and endLine must be positive integers (1-based).");
    if (params.startLine !== undefined && params.endLine !== undefined && startLine > endLine)
      return text("startLine must be <= endLine.");
    if (endLine - startLine >= 2000) endLine = startLine + 1999;

    // LSP ranges are 0-based with an exclusive end, so the 1-based inclusive
    // [startLine, endLine] window covers [startLine - 1, endLine). Clamp both 0-based lines to
    // the document's line count (the exclusive end-of-file line) so spec-strict servers such
    // as gopls accept the default 200-line window on short files instead of rejecting it.
    let startLine0 = startLine - 1;
    let endLine0 = endLine;
    try {
      const lineCount = (await session.fsReadFile(absolutePath, "utf8")).split("\n").length;
      startLine0 = Math.min(startLine0, lineCount);
      endLine0 = Math.min(endLine0, lineCount);
    } catch {
      /* Unreadable document: send the requested window unchanged. */
    }

    const uri = pathToFileURL(absolutePath).href;
    const failures: string[] = [];
    const unsupported: string[] = [];
    const results: InlayResult[] = [];
    const config = session.configResult.ok ? session.configResult.config : undefined;
    let resolveAttempts = 0;
    let resolutionSupported = false;
    for (const serverId of result.matchedServers) {
      const server = config && config.lsp !== false ? config.lsp[serverId] : undefined;
      const client = [...session.pool.entries()].find(([key]) =>
        key.startsWith(`${serverId}::`),
      )?.[1];
      const timeoutMs = Math.min(
        server?.requestTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS,
        DEFAULT_PULL_TIMEOUT_MS,
      );
      const provider = client?.capabilities()?.inlayHintProvider;
      const canResolve =
        !!provider &&
        typeof provider === "object" &&
        !Array.isArray(provider) &&
        (provider as { resolveProvider?: unknown }).resolveProvider === true;
      resolutionSupported ||= canResolve;
      const outcome = await session.inlayHints(
        serverId,
        uri,
        startLine0,
        endLine0,
        timeoutMs,
        client,
      );
      if (outcome.outcome === "failed")
        failures.push(`failed to retrieve inlay hints from ${serverId}`);
      else if (outcome.outcome === "unsupported")
        unsupported.push(`${serverId} does not support inlay hints`);
      else {
        const hints = await Promise.all(
          outcome.hints.map(async (hint) => {
            if (!canResolve || resolveAttempts >= MAX_RESOLVE_ATTEMPTS) return hint;
            resolveAttempts += 1;
            try {
              const resolved = await session.resolveInlayHint(serverId, hint, timeoutMs, client);
              return resolved.outcome === "ok" ? resolved.hint : hint;
            } catch {
              return hint;
            }
          }),
        );
        results.push({ serverId, hints });
      }
    }

    const fixedLines = [...failures, ...unsupported];
    if (results.length === 0) return text(fixedLines.join("\n"));
    const tooltipStatus = resolutionSupported
      ? "tooltips resolved when supported"
      : "label text only, tooltips not resolved";
    const footer = `coverage: ${result.matchedServers.length} server(s) queried for this range; ${tooltipStatus}; results reflect each server's current view and may lag recent edits; lines are 1-based UTF-16 code units; other ranges and files not checked`;
    const everySectionEmpty = results.every(
      ({ hints }) => formatInlayHints(hints, MAX_OUTPUT_CHARS) === "",
    );
    if (everySectionEmpty && failures.length === 0)
      return text(
        [...fixedLines, "No inlay hints in the requested range.", footer]
          .filter(Boolean)
          .join("\n"),
      );

    const multipleServers = results.length > 1;
    const headers = multipleServers ? results.map(({ serverId }) => `${serverId}:`) : [];
    const fixedOutput = [...fixedLines, ...headers, footer].filter(Boolean).join("\n");
    const sectionBudget = Math.max(
      1,
      Math.floor((MAX_OUTPUT_CHARS - fixedOutput.length - (results.length + 1)) / results.length),
    );
    const sections = results.map(({ serverId, hints }) => {
      const formatted = formatInlayHints(hints, sectionBudget);
      return multipleServers ? `${serverId}:\n${formatted}` : formatted;
    });
    return text([...fixedLines, ...sections, footer].filter(Boolean).join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(`Unable to retrieve inlay hints: ${message}`);
  }
}

function text(value: string) {
  return {
    content: [{ type: "text" as const, text: value.slice(0, MAX_OUTPUT_CHARS) }],
    details: undefined,
  };
}
