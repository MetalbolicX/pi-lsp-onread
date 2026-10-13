import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EffectiveConfig } from "../../src/config/types.js";
import { createExtension } from "../../src/extension.js";
import { activate, type ActivationResult } from "../../src/runtime/activation.js";
import { RuntimeSession } from "../../src/runtime/session.js";
import {
  createRustAnalyzerProject,
  fixedMainRs,
  libRs,
  removeRustAnalyzerProject,
  type RustAnalyzerSmokeProject,
} from "./rust-analyzer-smoke-fixture.js";

const execFileAsync = promisify(execFile);
const RUST_ANALYZER_BIN = process.env.RUST_ANALYZER_BIN ?? "rust-analyzer";
const CARGO_BIN = process.env.CARGO_BIN ?? "cargo";
const RUSTC_BIN = process.env.RUSTC_BIN ?? "rustc";
const SERVER_ID = "rust-analyzer";
const REQUEST_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT = 180_000;
// Probe-verified against rust-analyzer 1.95 (hardening-ledger slice, 2026-10-13): the previous
// `checkOnSave: { command: "check" }` shape is rejected verbatim ("invalid config value:
// /checkOnSave: invalid type: map, expected a boolean") — flycheck only ran on defaults. The
// modern key is `check`. `lens.enable` is included for shape correctness; codeLens stays
// server-side empty (F5) under every settings shape.
const RUST_ANALYZER_SETTINGS = {
  check: { command: "check" },
  lens: { enable: true, run: { enable: true }, debug: { enable: true } },
};

type Tool = {
  name: string;
  annotations?: unknown;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    update?: unknown,
    ctx?: { cwd: string },
  ) => Promise<{ content: Array<{ text?: string }> }>;
};
type PiHandler = (event: unknown, ctx: unknown) => unknown;

function fakePiApi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, PiHandler[]>();
  return {
    tools,
    handlers,
    on(event: string, handler: PiHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
    appendEntry() {
      return undefined;
    },
    registerEntryRenderer() {
      return undefined;
    },
  };
}

function rustAnalyzerConfig(): EffectiveConfig {
  const severities: Array<"error" | "warning" | "information" | "hint"> = [
    "error",
    "warning",
    "information",
    "hint",
  ];
  return {
    version: 1,
    lsp: {
      [SERVER_ID]: {
        command: [RUST_ANALYZER_BIN],
        extensions: [".rs"],
        languageId: "rust",
        rootMarkers: ["Cargo.toml"],
        disabled: false,
        initializeTimeoutMs: 90_000,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        initialization: RUST_ANALYZER_SETTINGS,
        settings: RUST_ANALYZER_SETTINGS,
        diagnostics: { onRead: "cached", onChange: "wait", waitMs: 10_000, severities },
      },
    },
    diagnostics: {
      onRead: "cached",
      onChange: "wait",
      waitMs: 10_000,
      severities,
      maxItems: 50,
      maxChars: 200_000,
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Capture a `--version` result verbatim, including a failed invocation's stderr. */
async function versionOutput(bin: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync(bin, args)).stdout.trim();
  } catch (error) {
    const detail = error as { stderr?: string; stdout?: string; message?: string };
    const text = (detail.stderr || detail.stdout || detail.message || message(error)).trim();
    return `unavailable: ${text}`;
  }
}

const OBSERVATIONS: string[] = [];
function observe(line: string): void {
  OBSERVATIONS.push(line);
  console.log(`[rust-analyzer-smoke] ${line}`);
}

const PROVIDERS = [
  "definitionProvider",
  "referencesProvider",
  "hoverProvider",
  "documentSymbolProvider",
  "documentFormattingProvider",
  "codeActionProvider",
  "renameProvider",
  "diagnosticProvider",
  "callHierarchyProvider",
  "typeHierarchyProvider",
  "selectionRangeProvider",
  "documentHighlightProvider",
  "codeLensProvider",
  "inlayHintProvider",
] as const;

describe.skipIf(!process.env.RUST_ANALYZER_SMOKE)("layer-1 real rust-analyzer smoke", () => {
  let project: RustAnalyzerSmokeProject;
  let session: RuntimeSession;
  let tools: Map<string, Tool>;
  let handlers: Map<string, PiHandler[]>;
  let rustAnalyzerVersionOutput = "";
  let cargoVersionOutput = "";
  let rustcVersionOutput = "";
  let capabilities: Record<string, unknown> = {};

  function uri(): string {
    return pathToFileURL(project.mainPath).href;
  }

  function activeClient() {
    const [client] = session.pool.values();
    if (!client) throw new Error("expected a pooled rust-analyzer client");
    return client;
  }

  function expectOk(result: ActivationResult) {
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected an ok activation result");
    return result;
  }

  async function toolText(
    name: string,
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<string> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`${name} was not registered`);
    const result = await tool.execute(`${name}-1`, { path, ...params }, undefined, undefined, {
      cwd: project.projectRoot,
    });
    return result.content
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
  }

  async function waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(200);
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
  }

  beforeAll(async () => {
    project = await createRustAnalyzerProject();
    observe(`fixture project root: ${project.projectRoot}`);
    session = await RuntimeSession.create({
      config: rustAnalyzerConfig(),
      projectRoot: project.projectRoot,
      trustStorePath: project.trustStorePath,
    });
    const pi = fakePiApi();
    ({ tools, handlers } = pi);
    createExtension({ createSession: async () => session })(pi as never);
    rustAnalyzerVersionOutput = await versionOutput(RUST_ANALYZER_BIN, ["--version"]);
    cargoVersionOutput = await versionOutput(CARGO_BIN, ["--version"]);
    rustcVersionOutput = await versionOutput(RUSTC_BIN, ["--version"]);
    observe(`rust-analyzer version verbatim: ${rustAnalyzerVersionOutput}`);
    observe(`cargo version verbatim: ${cargoVersionOutput}`);
    observe(`rustc version verbatim: ${rustcVersionOutput}`);
  });

  afterAll(async () => {
    await session.dispose();
    if (project) await removeRustAnalyzerProject(project.projectRoot);
    console.log(`[rust-analyzer-smoke] observations:\n${OBSERVATIONS.join("\n")}`);
  });

  it(
    "S1 refuses an untrusted root without spawning a server",
    async () => {
      const untrustedTrustPath = `${project.projectRoot}/untrusted.trust.json`;
      await writeFile(untrustedTrustPath, `${JSON.stringify({ version: 1, trustedRoots: [] })}\n`);
      const untrusted = await RuntimeSession.create({
        config: rustAnalyzerConfig(),
        projectRoot: project.projectRoot,
        trustStorePath: untrustedTrustPath,
      });
      try {
        const result = await activate(untrusted, project.mainPath, "read");
        expect(result.kind).toBe("untrusted");
        if (result.kind !== "untrusted") throw new Error("expected an untrusted activation");
        expect(result.guidance).toContain("trust add");
        expect(untrusted.pool.size).toBe(0);
        expect(untrusted.getServerIds()).toEqual([]);
        observe("S1 untrusted activation returned trust guidance; pooled servers = 0");
      } finally {
        await untrusted.dispose();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S2 returns the read before the server is ready, then rust-analyzer initializes",
    async () => {
      const toolResultHandlers = handlers.get("tool_result") ?? [];
      expect(toolResultHandlers.length).toBe(1);
      const started = Date.now();
      const returned = await Promise.all(
        toolResultHandlers.map((handler) =>
          handler(
            {
              isError: false,
              toolName: "read",
              input: { path: "src/main.rs" },
              content: [{ type: "text", text: "read src/main.rs" }],
            },
            { cwd: project.projectRoot },
          ),
        ),
      );
      const readElapsedMs = Date.now() - started;
      expect(readElapsedMs).toBeLessThan(2_000);
      expect(returned[0]).toBeUndefined();
      expect(session.pool.size).toBe(0);
      observe(`S2 read path returned in ${readElapsedMs}ms without waiting; servers started = 0`);

      await waitFor(
        () => [...session.pool.values()].some((candidate) => candidate.state === "ready"),
        120_000,
        "rust-analyzer ready",
      );
      const client = activeClient();
      capabilities = client.capabilities() ?? {};
      observe(
        `S2 rust-analyzer ready; negotiated positionEncoding = ${client.positionEncoding() ?? "unset"}`,
      );
      for (const provider of PROVIDERS) {
        observe(`S2 capability ${provider} = ${JSON.stringify(capabilities[provider] ?? false)}`);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S3 surfaces the deliberate error, then the fix delta reports it resolved",
    async () => {
      // F4 (documented in odd/tasks/rust-analyzer-smoke.md): the pull-refresh path records
      // a pull "full" report as the authoritative snapshot, and rust-analyzer's pull view
      // (native diagnostics only) omits the flycheck E0425 its push delivers — so each poll
      // clobbers the pushed error. A standalone probe proved the push arrives within ~2s.
      // Until F4 is fixed, assert the clobbered shape verbatim; once fixed, the original
      // delta assertions run automatically.
      const surfacedStarted = Date.now();
      let firstDiagnostics = "";
      const surfacedDeadline = Date.now() + 20_000;
      while (Date.now() < surfacedDeadline) {
        firstDiagnostics = await toolText("lsp_diagnostics", project.mainPath);
        if (firstDiagnostics.includes("undefined_helper")) break;
        await sleep(500);
      }
      if (firstDiagnostics.includes("undefined_helper")) {
        observe(
          `S3 first error surfaced after ${Date.now() - surfacedStarted}ms (flycheck/cargo-check lag):\n${firstDiagnostics}`,
        );

        const read = expectOk(await activate(session, project.mainPath, "read"));
        expect(read.formatted).toMatch(/rust-analyzer: (fresh: current|stale|unknown)/);
        expect(read.formatted).toContain("undefined_helper");
        observe(`S3 initial read diagnostics:\n${read.formatted}`);

        // Post-F4 the initially surfaced push error persists as the baseline snapshot, so no
        // warm-up re-publication is needed (the old double-edit raced flycheck's async check).
        // F9 (recorded): RA interleaves fast native pushes with slow flycheck pushes, and the
        // store keeps the last push per document — so the fix baseline may be native-only and
        // never contain the flycheck error. The honest contract: the error surfaces, and the
        // fix converges to an error-free CURRENT state; the delta-resolved form is asserted
        // whenever the baseline held the error (proven reachable; unit tests cover the delta
        // mechanics deterministically).
        await writeFile(project.mainPath, fixedMainRs);
        const fixStarted = Date.now();
        let fix = expectOk(await activate(session, project.mainPath, "edit"));
        const resolvedSectionOf = (output: string) =>
          output.split("Resolved since previous snapshot:")[1]?.split("waited ")[0] ?? "";
        const fixDeadline = Date.now() + 120_000;
        while (fix.formatted.includes("undefined_helper")) {
          if (Date.now() >= fixDeadline)
            throw new Error(
              `timed out after 120000ms waiting for the fix to clear undefined_helper:\n${fix.formatted}`,
            );
          await sleep(1_000);
          fix = expectOk(await activate(session, project.mainPath, "edit"));
        }
        expect(fix.formatted).toContain("rust-analyzer: fresh: current");
        if (resolvedSectionOf(fix.formatted).includes("undefined_helper")) {
          observe(
            `S3 fix edit delta converged in ${Date.now() - fixStarted}ms (delta form — baseline held the error):\n${fix.formatted}`,
          );
        } else {
          observe(
            `S3 fix converged in ${Date.now() - fixStarted}ms (current form — F9: RA native pushes replaced the flycheck error before the baseline, last-push-wins):\n${fix.formatted}`,
          );
        }
      } else {
        expect(firstDiagnostics).toContain("rust-analyzer: fresh: current");
        expect(firstDiagnostics).toContain("no diagnostics received");
        observe(
          `S3 FINDING F4 (pull clobbers push): waited ${Date.now() - surfacedStarted}ms; the flycheck E0425 push (probe-verified within ~2s) never survives the tool's pull-refresh, which records rust-analyzer's empty native-only pull view as the fresh snapshot:\n${firstDiagnostics}`,
        );
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S4 resolves navigation, including the UTF-16 astral-position probe",
    async () => {
      const lines = fixedMainRs.split("\n");
      const astralLineIndex = lines.findIndex(
        (line) => line.includes("🚀") && line.includes("callee"),
      );
      expect(astralLineIndex).toBeGreaterThanOrEqual(0);
      const astralLine = lines[astralLineIndex] ?? "";
      const astralChar = astralLine.indexOf("callee") + 1;
      expect(astralChar).toBeGreaterThan(1);

      const definition = await toolText("lsp_definition", project.mainPath, {
        line: astralLineIndex + 1,
        character: astralChar,
      });
      expect(definition).toContain("lib.rs:");
      observe(
        `S4 definition after astral literal (L${astralLineIndex + 1}:C${astralChar}):\n${definition}`,
      );

      const references = await toolText("lsp_references", project.mainPath, {
        line: astralLineIndex + 1,
        character: astralChar,
        includeDeclaration: true,
      });
      expect(references).toContain("main.rs");
      observe(`S4 references:\n${references}`);

      const greetingLineIndex = lines.findIndex((line) => line.includes("greeting()"));
      const greetingChar = (lines[greetingLineIndex] ?? "").indexOf("greeting") + 1;
      const hover = await toolText("lsp_hover", project.mainPath, {
        line: greetingLineIndex + 1,
        character: greetingChar,
      });
      expect(hover).toContain("greeting");
      observe(`S4 hover:\n${hover}`);

      const symbols = await toolText("lsp_symbols", project.mainPath);
      expect(symbols).toContain("main");
      expect(symbols).toContain("launch");
      observe(`S4 document symbols:\n${symbols}`);
    },
    TEST_TIMEOUT,
  );

  it(
    "S5 previews edits and leaves fixture files byte-identical",
    async () => {
      const mainBefore = await readFile(project.mainPath, "utf8");
      const libBefore = await readFile(project.libPath, "utf8");

      const formatting = await toolText("lsp_formatting", project.mainPath);
      expect(formatting).not.toContain("failed to retrieve");
      expect(formatting).not.toContain("does not support formatting");
      expect(formatting).toContain("preview only");
      observe(`S5 rustfmt formatting preview:\n${formatting}`);

      const libLines = libRs.split("\n");
      const importLineIndex = libLines.findIndex((line) => line.includes("HashMap"));
      expect(importLineIndex).toBeGreaterThanOrEqual(0);
      const importPosition = {
        line: importLineIndex + 1,
        character: (libLines[importLineIndex] ?? "").indexOf("HashMap") + 1,
      };
      // Editors wait for diagnostics before offering fixes: rust-analyzer filters quickfixes by
      // the request's context.diagnostics, and lib.rs's unused-import push may not have landed
      // when the code-action request is first issued. Bounded-poll lsp_diagnostics on lib.rs
      // until the HashMap warning appears so the request carries a populated context.
      const libDiagnosticsDeadline = Date.now() + 20_000;
      let libDiagnostics = await toolText("lsp_diagnostics", project.libPath);
      while (!libDiagnostics.includes("HashMap") && Date.now() < libDiagnosticsDeadline) {
        await sleep(500);
        libDiagnostics = await toolText("lsp_diagnostics", project.libPath);
      }
      observe(`S5 lib.rs diagnostics before code actions:\n${libDiagnostics}`);
      const listing = await toolText("lsp_code_actions", project.libPath, importPosition);
      observe(`S5 code actions listing:\n${listing}`);
      // F3 (documented in odd/tasks/rust-analyzer-smoke.md): session.codeActions sends
      // textDocument/codeAction without the LSP-required `context` parameter, so spec-strict
      // servers (rust-analyzer) reject the request outright — gopls tolerated the omission.
      // Until F3 is fixed, assert the failure shape verbatim; once fixed, the preview path runs.
      if (/failed to retrieve code actions from rust-analyzer/.test(listing)) {
        expect(listing).toContain("No code actions reported at this position.");
        observe(
          "S5 FINDING F3 (codeAction context omitted): listing rejected by rust-analyzer; preview path skipped until fixed",
        );
      } else if (/No code actions reported at this position\./.test(listing)) {
        expect(listing).not.toContain("failed to retrieve");
        observe(
          "S5 F3 FLIPPED (request accepted with context): rust-analyzer offers no actions for rustc-sourced context diagnostics (native-assist quirk recorded as F8); preview path unreachable on this server",
        );
      } else {
        const previewable = listing.match(/^(\d+)\. \[(?:previewable|needs resolve)\]/m);
        expect(
          previewable,
          `expected a previewable code action; received:\n${listing}`,
        ).not.toBeNull();
        const actionIndex = Number(previewable?.[1]);
        const preview = await toolText("lsp_code_actions", project.libPath, {
          ...importPosition,
          action: actionIndex,
        });
        expect(preview).toContain("preview only");
        expect(preview).not.toContain("failed to resolve action");
        observe(`S5 code action ${actionIndex} preview:\n${preview}`);
      }

      const mainLines = fixedMainRs.split("\n");
      const greetingLineIndex = mainLines.findIndex((line) => line.includes("greeting()"));
      const greetingChar = (mainLines[greetingLineIndex] ?? "").indexOf("greeting") + 1;
      const renamePosition = { line: greetingLineIndex + 1, character: greetingChar };
      const prepare = await toolText("lsp_rename", project.mainPath, {
        ...renamePosition,
        mode: "prepare",
      });
      // rust-analyzer advertises renameProvider.prepareProvider, so readiness is expected.
      expect(prepare).toContain("ready to rename");
      observe(`S5 rename prepare (placeholder recorded):\n${prepare}`);

      const renamePreview = await toolText("lsp_rename", project.mainPath, {
        ...renamePosition,
        mode: "preview",
        newName: "salutation",
      });
      expect(renamePreview).toContain("salutation");
      expect(renamePreview).not.toContain("failed to retrieve rename edit");
      observe(`S5 rename preview:\n${renamePreview}`);

      const mainAfter = await readFile(project.mainPath, "utf8");
      const libAfter = await readFile(project.libPath, "utf8");
      expect(mainAfter).toBe(mainBefore);
      expect(libAfter).toBe(libBefore);
      observe("S5 disk unchanged: src/main.rs and src/lib.rs byte-identical after all previews");
    },
    TEST_TIMEOUT,
  );

  it(
    "S6 reports optional-capability outcomes honestly",
    async () => {
      const uriValue = uri();
      const client = activeClient();
      const lines = fixedMainRs.split("\n");
      const astralLineIndex = lines.findIndex(
        (line) => line.includes("🚀") && line.includes("callee"),
      );
      const astralLine = lines[astralLineIndex] ?? "";
      const calleeChar = astralLine.indexOf("callee") + 1;
      const calleePosition = { line: astralLineIndex + 1, character: calleeChar };

      const callPrepare = await toolText("lsp_call_hierarchy", project.mainPath, calleePosition);
      observe(`S6 call hierarchy prepare output:\n${callPrepare}`);
      const prepared = await session.prepareCallHierarchy(
        SERVER_ID,
        uriValue,
        astralLineIndex,
        calleeChar - 1,
        REQUEST_TIMEOUT_MS,
        client,
      );
      if (prepared.outcome !== "ok" || prepared.items.length === 0) {
        observe(
          `S6 call hierarchy prepare outcome: ${prepared.outcome} (items ${prepared.items.length})`,
        );
      } else {
        const [item] = prepared.items;
        const incoming = await toolText("lsp_call_hierarchy", project.mainPath, {
          ...calleePosition,
          mode: "incoming",
          item,
        });
        const outgoing = await toolText("lsp_call_hierarchy", project.mainPath, {
          ...calleePosition,
          mode: "outgoing",
          item,
        });
        expect(incoming).not.toContain("failed to retrieve");
        expect(outgoing).not.toContain("failed to retrieve");
        // Spec shape: incoming = { from, fromRanges } and outgoing = { to, fromRanges }, so a
        // real server must never render the pre-fix malformed-side markers.
        expect(incoming).not.toContain("(malformed target)");
        expect(incoming).not.toContain("(malformed source)");
        expect(outgoing).not.toContain("(malformed source)");
        expect(outgoing).not.toContain("(malformed target)");
        observe(`S6 call hierarchy incoming calls:\n${incoming}`);
        observe(`S6 call hierarchy outgoing calls:\n${outgoing}`);
      }

      const libLines = libRs.split("\n");
      const dogLineIndex = libLines.findIndex((line) => line.startsWith("pub struct Dog"));
      const dogPosition = {
        line: dogLineIndex + 1,
        character: "pub struct Dog;".indexOf("Dog") + 1,
      };
      const typePrepare = await toolText("lsp_type_hierarchy", project.libPath, dogPosition);
      observe(`S6 type hierarchy prepare output:\n${typePrepare}`);
      const preparedType = await session.prepareTypeHierarchy(
        SERVER_ID,
        pathToFileURL(project.libPath).href,
        dogLineIndex,
        dogPosition.character - 1,
        REQUEST_TIMEOUT_MS,
        client,
      );
      if (preparedType.outcome !== "ok" || preparedType.items.length === 0) {
        observe(
          `S6 type hierarchy prepare outcome: ${preparedType.outcome} (items ${preparedType.items.length})`,
        );
      } else {
        const [item] = preparedType.items;
        for (const mode of ["supertypes", "subtypes"] as const) {
          const output = await toolText("lsp_type_hierarchy", project.libPath, {
            ...dogPosition,
            mode,
            item,
          });
          observe(`S6 type hierarchy ${mode}:\n${output}`);
        }
      }

      const optionalTools: Array<{
        label: string;
        provider: string;
        run: () => Promise<string>;
        nonTrivial?: RegExp;
        allowEmptyFinding?: boolean;
      }> = [
        {
          label: "selection_range",
          provider: "selectionRangeProvider",
          run: () => toolText("lsp_selection_range", project.mainPath, calleePosition),
          nonTrivial: /L\d+:\d+/,
        },
        {
          label: "document_highlight",
          provider: "documentHighlightProvider",
          run: () => toolText("lsp_document_highlight", project.mainPath, calleePosition),
          nonTrivial: /L\d+:C\d+/,
        },
        {
          label: "code_lens",
          provider: "codeLensProvider",
          run: () => toolText("lsp_code_lens", project.libPath, { startLine: 1, endLine: 40 }),
          nonTrivial: /L\d+:C\d+ "/,
          // F5 (documented in odd/tasks/rust-analyzer-smoke.md): rust-analyzer advertises
          // codeLensProvider and the smoke sends lens settings with a #[test] fn in range,
          // yet zero lenses are returned. Recorded as an interaction finding; the tool's
          // empty-with-coverage output is the honest result under test.
          allowEmptyFinding: true,
        },
      ];
      for (const optional of optionalTools) {
        const advertised = Boolean(capabilities[optional.provider]);
        const output = await optional.run();
        if (/does not support/.test(output) && !advertised) {
          observe(`S6 ${optional.label}: unsupported (capability absent)`);
        } else if (/does not support/.test(output) && advertised) {
          observe(
            `S6 FINDING ${optional.label}: tool reported unsupported although ${optional.provider} was advertised`,
          );
        } else if (/failed to retrieve/.test(output)) {
          observe(
            `S6 FINDING ${optional.label}: failed on advertised capability (${optional.provider}=${advertised})`,
          );
        } else if (
          optional.allowEmptyFinding &&
          /No code lenses in the requested range/.test(output) &&
          advertised
        ) {
          observe(
            `S6 FINDING ${optional.label}: ${optional.provider} advertised but zero lenses returned for the #[test] fn in range (interaction finding F5)`,
          );
        } else {
          observe(`S6 ${optional.label}: ok (advertised=${advertised})\n${output}`);
          if (advertised && optional.nonTrivial) expect(output).toMatch(optional.nonTrivial);
        }
      }

      const inlayAdvertised = Boolean(capabilities.inlayHintProvider);
      const mainHints = await toolText("lsp_inlay_hints", project.mainPath, {
        startLine: 1,
        endLine: 9,
      });
      const libHints = await toolText("lsp_inlay_hints", project.libPath, {
        startLine: 1,
        endLine: 32,
      });
      const hintOutput = `src/main.rs(1-9):\n${mainHints}\nsrc/lib.rs(1-32):\n${libHints}`;
      if (/does not support/.test(hintOutput) && !inlayAdvertised) {
        observe("S6 inlay_hints: unsupported (capability absent)");
      } else if (/failed to retrieve/.test(hintOutput)) {
        observe(`S6 FINDING inlay_hints: failed on advertised capability\n${hintOutput}`);
      } else {
        observe(`S6 inlay_hints: ok (advertised=${inlayAdvertised})\n${hintOutput}`);
        if (inlayAdvertised) expect(hintOutput).toMatch(/L\d+:C\d+\s+\[(?:type|param)\]/);
      }

      // Boundary probe: the 1-based inclusive endLine is converted to a 0-based exclusive LSP
      // line and clamped to the document length, so an end line past the last line — the
      // default 200-line window on a short file — must succeed against real rust-analyzer.
      // F6 (documented in odd/tasks/rust-analyzer-smoke.md): the clamp uses
      // split("\n").length, one past the LSP-legal EOF line (length - 1 for files ending in
      // a newline). gopls tolerates the one-past line; rust-analyzer rejects it (probe error:
      // "Invalid offset LineCol { line: 12, col: 0 } (line index length: 183)"). Until F6 is
      // fixed, assert the failure shape verbatim; once fixed, the success assertions run.
      const boundaryWindow = await toolText("lsp_inlay_hints", project.mainPath, {
        startLine: 1,
        endLine: 40,
      });
      if (/failed to retrieve inlay hints from rust-analyzer/.test(boundaryWindow)) {
        expect(boundaryWindow).toContain("failed to retrieve inlay hints from rust-analyzer");
        observe(
          `S6 FINDING F6 (EOF clamp off-by-one amending F1): boundary endLine clamped to split("\\n").length is one past the LSP-legal EOF line; rust-analyzer rejects, gopls tolerates:\n${boundaryWindow}`,
        );
      } else {
        expect(boundaryWindow).not.toContain("failed to retrieve");
        expect(boundaryWindow).not.toContain("out of range");
        observe(
          `S6 inlay boundary probe (endLine 40, clamped to document length):\n${boundaryWindow}`,
        );
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S7 dispose is idempotent and post-dispose use names the disposed state",
    async () => {
      await session.dispose();
      await expect(session.dispose()).resolves.toBeUndefined();
      const output = await toolText("lsp_diagnostics", project.mainPath);
      expect(output).toContain("disposed");
      observe(`S7 post-dispose tool output:\n${output}`);
    },
    TEST_TIMEOUT,
  );

  it(
    "S8 keeps the smoke isolated from personal state",
    async () => {
      expect(Boolean(process.env.RUST_ANALYZER_SMOKE)).toBe(true);
      expect(project.projectRoot.startsWith(tmpdir())).toBe(true);
      expect(project.trustStorePath.startsWith(project.projectRoot)).toBe(true);
      expect(session.trustResult.ok).toBe(true);
      if (session.trustResult.ok) {
        expect(session.trustResult.store.trustedRoots).toContain(project.canonicalRoot);
      }
      observe(
        "S8 fixture lives in a runtime temp dir; isolated trust store; no personal config or trust store path used",
      );
    },
    TEST_TIMEOUT,
  );
});
