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
  createGoProject,
  fixedMainGo,
  libGo,
  removeGoProject,
  type GoSmokeProject,
  warmupMainGo,
} from "./go-smoke-fixture.js";

const execFileAsync = promisify(execFile);
const GOPLS_BIN = process.env.GOPLS_BIN ?? "/home/metalbolicx/go/bin/gopls";
const GO_BIN = process.env.GO_BIN ?? "go";
const SERVER_ID = "gopls";
const REQUEST_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT = 120_000;
const GOPLS_SETTINGS = {
  hints: {
    assignVariableTypes: true,
    parameterNames: true,
    rangeVariableTypes: true,
  },
  codelenses: {
    test: true,
    generate: true,
  },
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

function goplsConfig(): EffectiveConfig {
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
        command: [GOPLS_BIN],
        extensions: [".go"],
        languageId: "go",
        rootMarkers: ["go.mod"],
        disabled: false,
        initializeTimeoutMs: 60_000,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        initialization: GOPLS_SETTINGS,
        settings: GOPLS_SETTINGS,
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

const OBSERVATIONS: string[] = [];
function observe(line: string): void {
  OBSERVATIONS.push(line);
  console.log(`[gopls-smoke] ${line}`);
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

describe.skipIf(!process.env.GOPLS_SMOKE)("layer-1 real gopls smoke", () => {
  let project: GoSmokeProject;
  let session: RuntimeSession;
  let tools: Map<string, Tool>;
  let handlers: Map<string, PiHandler[]>;
  let goplsVersion = "";
  let goVersion = "";
  let capabilities: Record<string, unknown> = {};

  function uri(): string {
    return pathToFileURL(project.mainPath).href;
  }

  function activeClient() {
    const [client] = session.pool.values();
    if (!client) throw new Error("expected a pooled gopls client");
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
    project = await createGoProject();
    observe(`fixture project root: ${project.projectRoot}`);
    session = await RuntimeSession.create({
      config: goplsConfig(),
      projectRoot: project.projectRoot,
      trustStorePath: project.trustStorePath,
    });
    const pi = fakePiApi();
    ({ tools, handlers } = pi);
    createExtension({ createSession: async () => session })(pi as never);
    try {
      goplsVersion = (await execFileAsync(GOPLS_BIN, ["version"])).stdout.trim();
    } catch (error) {
      goplsVersion = `unavailable: ${message(error)}`;
    }
    try {
      goVersion = (await execFileAsync(GO_BIN, ["version"])).stdout.trim();
    } catch (error) {
      goVersion = `unavailable: ${message(error)}`;
    }
    observe(`gopls version verbatim: ${goplsVersion}`);
    observe(`go version verbatim: ${goVersion}`);
  });

  afterAll(async () => {
    await session.dispose();
    if (project) await removeGoProject(project.projectRoot);
    console.log(`[gopls-smoke] observations:\n${OBSERVATIONS.join("\n")}`);
  });

  it(
    "S1 refuses an untrusted root without spawning a server",
    async () => {
      const untrustedTrustPath = `${project.projectRoot}/untrusted.trust.json`;
      await writeFile(untrustedTrustPath, `${JSON.stringify({ version: 1, trustedRoots: [] })}\n`);
      const untrusted = await RuntimeSession.create({
        config: goplsConfig(),
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
    "S2 returns the read before the server is ready, then gopls initializes",
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
              input: { path: "main.go" },
              content: [{ type: "text", text: "read main.go" }],
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
        60_000,
        "gopls ready",
      );
      const client = activeClient();
      capabilities = client.capabilities() ?? {};
      observe(
        `S2 gopls ready; negotiated positionEncoding = ${client.positionEncoding() ?? "unset"}`,
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
      await waitFor(
        () =>
          (session.diagnostics.get(SERVER_ID, uri())?.items ?? []).some((item) =>
            item.message.includes("undefinedHelper"),
          ),
        30_000,
        "initial undefinedHelper diagnostic",
      );
      const read = expectOk(await activate(session, project.mainPath, "read"));
      expect(read.formatted).toMatch(/gopls: (fresh: current|stale|unknown)/);
      expect(read.formatted).toContain("undefinedHelper");
      observe(`S3 initial read diagnostics:\n${read.formatted}`);

      // Republish a broken variant so a baseline snapshot exists for the edit delta.
      await writeFile(project.mainPath, warmupMainGo);
      await activate(session, project.mainPath, "edit");

      await writeFile(project.mainPath, fixedMainGo);
      const fixStarted = Date.now();
      const fix = expectOk(await activate(session, project.mainPath, "edit"));
      const fixElapsedMs = Date.now() - fixStarted;
      const resolvedSection =
        fix.formatted.split("Resolved since previous snapshot:")[1]?.split("waited ")[0] ?? "";
      expect(fix.formatted).toContain("Resolved since previous snapshot:");
      expect(resolvedSection).toContain("undefinedHelper");
      observe(`S3 fix edit delta in ${fixElapsedMs}ms:\n${fix.formatted}`);
    },
    TEST_TIMEOUT,
  );

  it(
    "S4 resolves navigation, including the UTF-16 astral-position probe",
    async () => {
      const lines = fixedMainGo.split("\n");
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
      expect(definition).toContain("lib.go:9:6");
      observe(
        `S4 definition after astral literal (L${astralLineIndex + 1}:C${astralChar}):\n${definition}`,
      );

      const references = await toolText("lsp_references", project.mainPath, {
        line: astralLineIndex + 1,
        character: astralChar,
        includeDeclaration: true,
      });
      expect(references).toContain("lib.go");
      observe(`S4 references:\n${references}`);

      const greetingLineIndex = lines.findIndex((line) => line.includes("func greeting"));
      const greetingChar = (lines[greetingLineIndex] ?? "").indexOf("greeting") + 1;
      const hover = await toolText("lsp_hover", project.mainPath, {
        line: greetingLineIndex + 1,
        character: greetingChar,
      });
      expect(hover).toContain("greeting");
      observe(`S4 hover:\n${hover}`);

      const symbols = await toolText("lsp_symbols", project.mainPath);
      expect(symbols).toContain("main");
      expect(symbols).toContain("greeting");
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
      observe(`S5 formatting preview:\n${formatting}`);

      const organize = await toolText("lsp_organize_imports", project.libPath);
      expect(organize).not.toContain("does not support code actions");
      expect(organize).toContain("preview only");
      expect(organize).not.toContain("No formatting preview available.");
      observe(`S5 organize-imports preview:\n${organize}`);

      const libLines = libGo.split("\n");
      const osLineIndex = libLines.findIndex((line) => line.includes('"os"'));
      expect(osLineIndex).toBeGreaterThanOrEqual(0);
      const osPosition = { line: osLineIndex + 1, character: 3 };
      const listing = await toolText("lsp_code_actions", project.libPath, osPosition);
      observe(`S5 code actions listing:\n${listing}`);
      const previewable = listing.match(/^(\d+)\. \[(?:previewable|needs resolve)\]/m);
      expect(
        previewable,
        `expected a previewable code action; received:\n${listing}`,
      ).not.toBeNull();
      const actionIndex = Number(previewable?.[1]);
      const preview = await toolText("lsp_code_actions", project.libPath, {
        ...osPosition,
        action: actionIndex,
      });
      expect(preview).toContain("preview only");
      expect(preview).not.toContain("failed to resolve action");
      observe(`S5 code action ${actionIndex} preview:\n${preview}`);

      const mainLines = fixedMainGo.split("\n");
      const greetingLineIndex = mainLines.findIndex((line) => line.includes("func greeting"));
      const greetingChar = (mainLines[greetingLineIndex] ?? "").indexOf("greeting") + 1;
      const renamePosition = { line: greetingLineIndex + 1, character: greetingChar };
      const prepare = await toolText("lsp_rename", project.mainPath, {
        ...renamePosition,
        mode: "prepare",
      });
      if (/does not support prepareRename/.test(prepare)) {
        observe(`S5 rename prepare: prepareRename not advertised by gopls (recorded)\n${prepare}`);
      } else {
        expect(prepare).toContain("ready to rename");
        observe(`S5 rename prepare:\n${prepare}`);
      }
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
      observe("S5 disk unchanged: main.go and lib.go byte-identical after all previews");
    },
    TEST_TIMEOUT,
  );

  it(
    "S6 reports optional-capability outcomes honestly",
    async () => {
      const uriValue = uri();
      const client = activeClient();
      const lines = fixedMainGo.split("\n");
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
        observe(`S6 call hierarchy incoming calls:\n${incoming}`);
        observe(`S6 call hierarchy outgoing calls:\n${outgoing}`);
      }

      const dogLineIndex = libGo
        .split("\n")
        .findIndex((line) => line.startsWith("type Dog struct"));
      const dogPosition = {
        line: dogLineIndex + 1,
        character: "type Dog struct{}".indexOf("Dog") + 1,
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
          run: () => toolText("lsp_code_lens", project.testPath, { startLine: 1, endLine: 40 }),
          nonTrivial: /L\d+:C\d+ "/,
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
        startLine: 13,
        endLine: 17,
      });
      const hintOutput = `main.go(1-9):\n${mainHints}\nlib.go(13-17):\n${libHints}`;
      if (/does not support/.test(hintOutput) && !inlayAdvertised) {
        observe("S6 inlay_hints: unsupported (capability absent)");
      } else if (/failed to retrieve/.test(hintOutput)) {
        observe(`S6 FINDING inlay_hints: failed on advertised capability\n${hintOutput}`);
      } else {
        observe(`S6 inlay_hints: ok (advertised=${inlayAdvertised})\n${hintOutput}`);
        if (inlayAdvertised) expect(hintOutput).toMatch(/L\d+:C\d+\s+\[(?:type|param)\]/);
      }

      // Boundary probe: an end line at or past the last line (the tool's default 200-line
      // window) is rejected by real gopls because the 1-based endLine is sent as a 0-based
      // LSP line. Recorded as a finding; never swallowed.
      const outOfRange = await toolText("lsp_inlay_hints", project.mainPath, {
        startLine: 1,
        endLine: 40,
      });
      if (/failed to retrieve/.test(outOfRange)) {
        const probe = await activeClient().request(
          "textDocument/inlayHint",
          {
            textDocument: { uri: uri() },
            range: { start: { line: 0, character: 0 }, end: { line: 40, character: 0 } },
          },
          REQUEST_TIMEOUT_MS,
        );
        observe(
          `S6 FINDING lsp_inlay_hints rejects an end line past the document; raw gopls result: ${JSON.stringify(probe)}`,
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
      expect(Boolean(process.env.GOPLS_SMOKE)).toBe(true);
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
