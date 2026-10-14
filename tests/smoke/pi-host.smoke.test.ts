import { execFile, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type AgentSession,
  AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type LoadExtensionsResult,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPiHostProject,
  listOwnedGopls,
  type PiHostSmokeProject,
  removePiHostProject,
} from "./pi-host-fixture.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXTENSION_BUNDLE = resolve(REPO_ROOT, "dist", "extension.js");
const CLI_BUNDLE = resolve(REPO_ROOT, "dist", "cli.js");
const TEST_TIMEOUT = 180_000;
const INIT_TIMEOUT = 90_000;
const ACTIVATION_WAIT_MS = 30_000;
const SHUTDOWN_WAIT_MS = 10_000;
const SCRIPTED_PROVIDER = "scripted";
const SCRIPTED_MODEL_ID = "scripted-1";

/** Exact registration list from src/extension.ts (18 tools). */
const LSP_TOOLS = [
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_implementation",
  "lsp_type_definition",
  "lsp_call_hierarchy",
  "lsp_type_hierarchy",
  "lsp_references",
  "lsp_code_actions",
  "lsp_organize_imports",
  "lsp_hover",
  "lsp_inlay_hints",
  "lsp_selection_range",
  "lsp_document_highlight",
  "lsp_code_lens",
  "lsp_rename",
  "lsp_formatting",
  "lsp_symbols",
  "lsp_workspace_symbols",
] as const;

const MODEL_CONFIG = {
  id: SCRIPTED_MODEL_ID,
  name: "Scripted",
  api: "pi-host-smoke",
  baseUrl: "http://127.0.0.1:9",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 100_000,
  maxTokens: 4096,
};

/** Minimal shape of the pi-ai stream we consume: synchronous event push. */
interface ScriptedStream {
  push(event: unknown): void;
}
type ScriptedStreamFactory = () => ScriptedStream;

type ScriptedTurn =
  | { kind: "tool"; name: string; arguments: Record<string, unknown> }
  | { kind: "text"; text: string };

interface ToolResultRecord {
  toolName: string;
  text: string;
  isError: boolean;
}

const OBSERVATIONS: string[] = [];
function observe(line: string): void {
  OBSERVATIONS.push(line);
  console.log(`[pi-host-smoke] ${line}`);
}

/**
 * pi-ai is a transitive dependency (pnpm-strict, not directly importable) and the coding-agent
 * package does not re-export AssistantMessageEventStream. Resolve the real dist entry from the
 * repo's pnpm store and import it by URL.
 */
function resolvePiAiEntry(): string {
  const pnpmDir = join(REPO_ROOT, "node_modules", ".pnpm");
  const entry = readdirSync(pnpmDir).find((name) => name.startsWith("@earendil-works+pi-ai@"));
  if (!entry) throw new Error("pi-ai is not installed under node_modules/.pnpm");
  return join(pnpmDir, entry, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js");
}

let createStream: ScriptedStreamFactory;
let scriptedTurns: ScriptedTurn[] = [];
let scriptedToolCallSeq = 0;

function script(turns: ScriptedTurn[]): void {
  scriptedTurns = [...turns];
}
function toolTurn(name: string, args: Record<string, unknown>): ScriptedTurn {
  return { kind: "tool", name, arguments: args };
}
function textTurn(text: string): ScriptedTurn {
  return { kind: "text", text };
}

function assistantMessage(content: unknown[], stopReason: string): Record<string, unknown> {
  return {
    role: "assistant",
    provider: SCRIPTED_PROVIDER,
    model: SCRIPTED_MODEL_ID,
    api: "pi-host-smoke",
    timestamp: Date.now(),
    stopReason,
    content,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

/**
 * Scripted no-network model: each provider call consumes one queued turn. Tool turns emit a
 * single tool call; text turns emit the final stop response. An exhausted queue emits a stop
 * response so the agent loop always terminates.
 */
function scriptedStream(): ScriptedStream {
  const turn = scriptedTurns.shift() ?? { kind: "text" as const, text: "SCRIPT-EXHAUSTED" };
  const stream = createStream();
  if (turn.kind === "tool") {
    scriptedToolCallSeq += 1;
    const toolCall = {
      type: "toolCall",
      id: `scripted-call-${scriptedToolCallSeq}`,
      name: turn.name,
      arguments: turn.arguments,
    };
    const message = assistantMessage([toolCall], "toolUse");
    stream.push({ type: "start", partial: message });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
    return stream;
  }
  const empty = assistantMessage([], "stop");
  stream.push({ type: "start", partial: empty });
  stream.push({ type: "text_start", contentIndex: 0, partial: empty });
  const full = assistantMessage([{ type: "text", text: turn.text }], "stop");
  stream.push({ type: "text_delta", contentIndex: 0, delta: turn.text, partial: full });
  stream.push({ type: "text_end", contentIndex: 0, content: turn.text, partial: full });
  stream.push({ type: "done", reason: "stop", message: full });
  return stream;
}

function toolResults(messages: readonly unknown[]): ToolResultRecord[] {
  const records: ToolResultRecord[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "toolResult") continue;
    const content = Array.isArray(record.content) ? record.content : [];
    const text = content
      .map((part) => {
        if (typeof part !== "object" || part === null) return "";
        const value = (part as Record<string, unknown>).text;
        return typeof value === "string" ? value : "";
      })
      .join("\n");
    records.push({
      toolName: typeof record.toolName === "string" ? record.toolName : "",
      text,
      isError: record.isError === true,
    });
  }
  return records;
}

function latestDiagnostics(records: readonly ToolResultRecord[]): string {
  return [...records].reverse().find((record) => record.toolName === "lsp_diagnostics")?.text ?? "";
}

/** Best-effort orphan check: exact-name gopls processes visible to pgrep. */
function countGopls(): number {
  try {
    const output = execFileSync("pgrep", ["-x", "gopls"], { encoding: "utf8" });
    return output.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Raw `pgrep -a gopls` listing so the orphan finding carries verbatim evidence. */
function listGopls(): string {
  try {
    return execFileSync("pgrep", ["-a", "gopls"], { encoding: "utf8" }).trim();
  } catch {
    return "<none>";
  }
}

describe.skipIf(!process.env.PI_HOST_SMOKE)("layer-2 real Pi host smoke", () => {
  let project: PiHostSmokeProject;
  let originalHome: string | undefined;
  let modelRuntime: ModelRuntime;
  let sessionA: AgentSession;
  let extensionsA: LoadExtensionsResult;

  interface TrackedSession {
    label: string;
    session: AgentSession;
    runtime: AgentSessionRuntime;
    disposed: boolean;
  }
  const tracked: TrackedSession[] = [];

  function track(
    label: string,
    session: AgentSession,
    runtime: AgentSessionRuntime,
  ): TrackedSession {
    const record: TrackedSession = { label, session, runtime, disposed: false };
    tracked.push(record);
    return record;
  }

  /** Idempotent teardown; `runtime.dispose()` emits `session_shutdown` before raw session disposal. */
  async function disposeTracked(record: TrackedSession): Promise<void> {
    if (record.disposed) return;
    record.disposed = true;
    await record.runtime.dispose();
  }

  async function disposeAllTracked(): Promise<void> {
    for (const record of [...tracked].reverse()) {
      try {
        await disposeTracked(record);
      } catch {
        /* afterAll cleanup must never mask the original failure */
      }
    }
  }

  function requireModel() {
    const model = modelRuntime.getModel(SCRIPTED_PROVIDER, SCRIPTED_MODEL_ID);
    if (!model) throw new Error("scripted model was not registered");
    return model;
  }

  async function runCli(args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("node", [CLI_BUNDLE, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: project.homeDir },
    });
    return `${stdout}${stderr}`;
  }

  /**
   * Build a host session through the production runtime path (services -> fromServices ->
   * AgentSessionRuntime -> bindExtensions). `AgentSessionRuntime.dispose()` emits
   * `{type:"session_shutdown", reason:"quit"}` before `session.dispose()`, which the extension
   * needs to dispose its RuntimeSession and SIGTERM pooled servers.
   *
   * A raw `AgentSession.dispose()` never emits `session_shutdown` (recorded finding in
   * odd/tasks/pi-host-smoke-hardening.md), so a raw session would leak an owned gopls past its
   * scenario and pollute S5's owned-process assertion. Every host session therefore goes through
   * the runtime so each scenario can tear down its own children.
   */
  async function createHostSession(): Promise<{
    session: AgentSession;
    extensionsResult: LoadExtensionsResult;
    record: TrackedSession;
  }> {
    const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
      const services = await createAgentSessionServices({
        cwd: options.cwd,
        agentDir: options.agentDir,
        modelRuntime,
        resourceLoaderOptions: { additionalExtensionPaths: [EXTENSION_BUNDLE] },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        model: requireModel(),
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    const services = await createAgentSessionServices({
      cwd: project.projectRoot,
      agentDir: project.agentDir,
      modelRuntime,
      resourceLoaderOptions: { additionalExtensionPaths: [EXTENSION_BUNDLE] },
    });
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(),
      model: requireModel(),
    });
    await created.session.bindExtensions({});
    const runtime = new AgentSessionRuntime(created.session, services, createRuntime);
    const record = track("host", created.session, runtime);
    return { session: created.session, extensionsResult: created.extensionsResult, record };
  }

  async function promptAndCollect(
    session: AgentSession,
    prompt: string,
  ): Promise<ToolResultRecord[]> {
    const start = session.messages.length;
    await session.prompt(prompt);
    return toolResults(session.messages.slice(start));
  }

  /** Read-only `/proc/<pid>/cwd` ownership count for the fixture project; never signals a pid. */
  async function ownedGopls(): Promise<number[]> {
    return listOwnedGopls(project.projectRoot);
  }

  async function waitForOwnedGopls(
    predicate: (pids: number[]) => boolean,
    timeoutMs: number,
  ): Promise<number[]> {
    let owned = await ownedGopls();
    const deadline = Date.now() + timeoutMs;
    while (!predicate(owned) && Date.now() < deadline) {
      await sleep(250);
      owned = await ownedGopls();
    }
    return owned;
  }

  async function disposeTrackedAndWait(record: TrackedSession): Promise<void> {
    await disposeTracked(record);
    const owned = await waitForOwnedGopls((pids) => pids.length === 0, SHUTDOWN_WAIT_MS);
    observe(`disposed ${record.label} session; owned gopls after shutdown = ${owned.length}`);
  }

  function trustStorePath(): string {
    return join(project.agentDir, "lsp.trust.json");
  }

  async function isTrusted(): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(trustStorePath(), "utf8")) as {
        trustedRoots?: unknown;
      };
      return (
        Array.isArray(parsed.trustedRoots) && parsed.trustedRoots.includes(project.canonicalRoot)
      );
    } catch {
      return false;
    }
  }

  async function ensureTrusted(): Promise<void> {
    if (await isTrusted()) {
      observe(`trust already present for ${project.canonicalRoot}; CLI trust add not needed`);
      return;
    }
    const output = await runCli(["trust", "add", project.canonicalRoot]);
    observe(`CLI trust add output: ${output.trim().replaceAll("\n", " | ")}`);
  }

  async function createTrustedHostSession(): Promise<{
    session: AgentSession;
    extensionsResult: LoadExtensionsResult;
    record: TrackedSession;
  }> {
    await ensureTrusted();
    return createHostSession();
  }

  beforeAll(async () => {
    originalHome = process.env.HOME;
    process.env.PI_HOST_SMOKE_KEY = "no-network";
    project = await createPiHostProject();
    process.env.HOME = project.homeDir;
    observe(`fixture project root: ${project.projectRoot}`);
    observe(`isolated HOME: ${project.homeDir}`);
    const piAi = (await import(pathToFileURL(resolvePiAiEntry()).href)) as {
      createAssistantMessageEventStream: ScriptedStreamFactory;
    };
    createStream = piAi.createAssistantMessageEventStream;

    // The gopls preset id in src/presets/catalog.ts is "go" (command ["gopls"]); the plan's
    // "gopls" id does not exist, so the real CLI rejects it. Server id in config is "go".
    const addOutput = await runCli(["add", "go", "--project", project.projectRoot, "--yes"]);
    observe(`CLI add go output: ${addOutput.trim().replaceAll("\n", " | ")}`);

    modelRuntime = await ModelRuntime.create({
      authPath: project.authPath,
      modelsPath: project.modelsPath,
    });
    modelRuntime.registerProvider(SCRIPTED_PROVIDER, {
      apiKey: "$PI_HOST_SMOKE_KEY",
      api: "pi-host-smoke",
      models: [MODEL_CONFIG],
      streamSimple: scriptedStream,
    } as never);

    const created = await createHostSession();
    sessionA = created.session;
    extensionsA = created.extensionsResult;
    observe(`host session A created; active tools = ${sessionA.getActiveToolNames().length}`);
  }, INIT_TIMEOUT);

  afterAll(async () => {
    await disposeAllTracked();
    if (project) await removePiHostProject(project);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    console.log(`[pi-host-smoke] observations:\n${OBSERVATIONS.join("\n")}`);
  }, INIT_TIMEOUT);

  it(
    "S1 loads the built extension bundle into a real Pi host",
    () => {
      observe(`S1 loaded extension paths: ${extensionsA.extensions.map((e) => e.path).join(", ")}`);
      expect(extensionsA.errors).toEqual([]);
      const bundle = extensionsA.extensions.find((e) => e.path.endsWith("dist/extension.js"));
      expect(bundle).toBeDefined();
      observe(`S1 bundle loaded: ${bundle?.path}; tools in extension map = ${bundle?.tools.size}`);
    },
    TEST_TIMEOUT,
  );

  it(
    "S2 registers all 18 lsp tools on the real session",
    () => {
      const active = sessionA.getActiveToolNames();
      observe(`S2 active tools (${active.length}): ${active.join(", ")}`);
      for (const name of LSP_TOOLS) expect(active).toContain(name);
      expect(LSP_TOOLS).toHaveLength(18);
    },
    TEST_TIMEOUT,
  );

  it(
    "S4 gates diagnostics on the real trust store, then clears after CLI trust add",
    async () => {
      const preTrusted = await isTrusted();
      if (preTrusted) {
        observe(
          "S4 observe: trust already granted earlier in this run — untrusted assertions skipped honestly",
        );
      } else {
        script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S4-untrusted-done")]);
        const ownedBefore = await ownedGopls();
        const untrustedResults = await promptAndCollect(sessionA, "diagnose main.go");
        const ownedAfter = await ownedGopls();
        const untrustedOutput = latestDiagnostics(untrustedResults);
        observe(`S4 untrusted diagnostics output:\n${untrustedOutput}`);
        expect(untrustedOutput).toContain("Trust this project root with");
        expect(untrustedOutput).toContain("trust add");
        observe(
          `S4 owned gopls before/after untrusted call: ${ownedBefore.length}/${ownedAfter.length}` +
            ` (global exact-name count, supplementary: ${countGopls()})`,
        );
        expect(ownedAfter.length).toBeLessThanOrEqual(ownedBefore.length);
        expect(ownedAfter).toHaveLength(0);
      }

      await ensureTrusted();

      const trusted = await createTrustedHostSession();
      observe("S4 trusted session created after trust add");
      try {
        script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S4-trusted-done")]);
        let trustedOutput = latestDiagnostics(
          await promptAndCollect(trusted.session, "diagnose main.go"),
        );
        const deadline = Date.now() + ACTIVATION_WAIT_MS;
        while (
          !(trustedOutput.includes("coverage:") && trustedOutput.includes("undefinedHelper")) &&
          Date.now() < deadline
        ) {
          await sleep(1_000);
          script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S4-poll-done")]);
          trustedOutput = latestDiagnostics(
            await promptAndCollect(trusted.session, "re-check diagnostics for main.go"),
          );
        }
        observe(`S4 trusted diagnostics output:\n${trustedOutput}`);
        // The old contract (`toContain("coverage:")`) could not distinguish zero-coverage output:
        // e.g. "pending — no diagnostics received yet from go" already carries
        // "coverage: 1 server(s) checked", so it passed before a usable server was ready.
        expect(trustedOutput).not.toContain("trust add");
        expect(trustedOutput).toContain("coverage:");
        expect(trustedOutput).toContain("undefinedHelper");
      } finally {
        try {
          await disposeTrackedAndWait(trusted.record);
        } catch {
          /* scenario cleanup is best-effort; afterAll still disposes the registry */
        }
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S3 activates gopls on a real read and surfaces the deliberate error",
    async () => {
      const trusted = await createTrustedHostSession();
      const { session } = trusted;
      try {
        expect(await ownedGopls()).toHaveLength(0);

        script([toolTurn("read", { path: "main.go" }), textTurn("S3-read-done")]);
        const readResults = await promptAndCollect(session, "read main.go");
        const readResult = readResults.find((record) => record.toolName === "read");
        observe(
          `S3 read tool result (first 600 chars):\n${(readResult?.text ?? "").slice(0, 600)}`,
        );
        expect(readResult?.isError).toBe(false);
        expect((readResult?.text ?? "").length).toBeGreaterThan(0);

        // No explicit lsp_diagnostics call has run on this session yet, so any owned gopls here
        // comes from read-triggered activation rather than a diagnostics-triggered activation.
        const activated = await waitForOwnedGopls((pids) => pids.length >= 1, ACTIVATION_WAIT_MS);
        observe(`S3 owned gopls after read = ${activated.join(", ") || "<none>"}`);
        expect(activated.length).toBeGreaterThanOrEqual(1);

        script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S3-step-done")]);
        let output = latestDiagnostics(await promptAndCollect(session, "diagnose main.go"));
        const deadline = Date.now() + ACTIVATION_WAIT_MS;
        while (
          !(output.includes("undefinedHelper") && /fresh: current/.test(output)) &&
          Date.now() < deadline
        ) {
          await sleep(1_000);
          script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S3-poll-done")]);
          output = latestDiagnostics(
            await promptAndCollect(session, "re-check diagnostics for main.go"),
          );
        }
        observe(`S3 diagnostics output:\n${output}`);
        expect(output).toContain("undefinedHelper");
        expect(output).toMatch(/fresh: current/);
      } finally {
        try {
          await disposeTrackedAndWait(trusted.record);
        } catch {
          /* scenario cleanup is best-effort; afterAll still disposes the registry */
        }
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "S5 production AgentSessionRuntime.dispose() exits owned gopls children",
    async () => {
      const host = await createTrustedHostSession();
      const { session } = host;
      const active = session.getActiveToolNames();
      observe(`S5 production runtime active tools (${active.length}): ${active.join(", ")}`);
      // Verify the built bundle registered its 18 extension tools through the services path: a
      // loader that was never reloaded registers zero tools (H0 spike finding).
      for (const name of LSP_TOOLS) expect(active).toContain(name);
      expect(LSP_TOOLS.filter((name) => active.includes(name))).toHaveLength(18);
      const servicesDiagnostics = host.record.runtime.services.diagnostics;
      if (servicesDiagnostics.length > 0) {
        observe(
          `S5 services diagnostics:\n${servicesDiagnostics.map((d) => `${d.type}: ${d.message}`).join("\n")}`,
        );
      }

      script([toolTurn("read", { path: "main.go" }), textTurn("S5-read-done")]);
      await promptAndCollect(session, "read main.go");

      const activated = await waitForOwnedGopls((pids) => pids.length >= 1, ACTIVATION_WAIT_MS);
      observe(`S5 owned gopls after read = ${activated.join(", ") || "<none>"}`);
      expect(activated.length).toBeGreaterThanOrEqual(1);

      await disposeTracked(host.record);
      const after = await waitForOwnedGopls((pids) => pids.length === 0, SHUTDOWN_WAIT_MS);
      observe(`S5 owned gopls after runtime.dispose() = ${after.join(", ") || "<none>"}`);
      observe(`S5 global exact-name gopls after runtime.dispose():\n${listGopls()}`);
      // Raw AgentSession.dispose() never emits session_shutdown (recorded finding in
      // odd/tasks/pi-host-smoke-hardening.md) and is intentionally not re-asserted here; this
      // test exercises only the production AgentSessionRuntime.dispose() path.
      expect(after).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );
});
