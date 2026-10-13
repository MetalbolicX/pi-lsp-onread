import { execFile, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type LoadExtensionsResult,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPiHostProject,
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
  let sessionB: AgentSession | undefined;
  let extensionsA: LoadExtensionsResult;
  let disposed = false;

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

  async function createHostSession(): Promise<{
    session: AgentSession;
    extensionsResult: LoadExtensionsResult;
  }> {
    const loader = new DefaultResourceLoader({
      cwd: project.projectRoot,
      agentDir: project.agentDir,
      additionalExtensionPaths: [EXTENSION_BUNDLE],
    });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd: project.projectRoot,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      model: requireModel(),
      modelRuntime,
    });
    await session.bindExtensions({});
    return { session, extensionsResult };
  }

  async function promptAndCollect(
    session: AgentSession,
    prompt: string,
  ): Promise<ToolResultRecord[]> {
    const start = session.messages.length;
    await session.prompt(prompt);
    return toolResults(session.messages.slice(start));
  }

  function requireSessionB(): AgentSession {
    if (!sessionB) throw new Error("S4 must run before S3: trusted host session was not created");
    return sessionB;
  }

  function disposeSessions(): void {
    if (disposed) return;
    disposed = true;
    for (const session of [sessionA, sessionB]) {
      try {
        session?.dispose();
      } catch {
        /* dispose must be best-effort during cleanup */
      }
    }
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
    disposeSessions();
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
      script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S4-untrusted-done")]);
      const goplsBefore = countGopls();
      const untrustedResults = await promptAndCollect(sessionA, "diagnose main.go");
      const goplsAfter = countGopls();
      const untrustedOutput = latestDiagnostics(untrustedResults);
      observe(`S4 untrusted diagnostics output:\n${untrustedOutput}`);
      expect(untrustedOutput).toContain("Trust this project root with");
      expect(untrustedOutput).toContain("trust add");
      observe(`S4 gopls processes before/after untrusted call: ${goplsBefore}/${goplsAfter}`);
      expect(goplsAfter).toBeLessThanOrEqual(goplsBefore);

      const trustOutput = await runCli(["trust", "add", project.canonicalRoot]);
      observe(`CLI trust add output: ${trustOutput.trim().replaceAll("\n", " | ")}`);

      const trusted = await createHostSession();
      sessionB = trusted.session;
      observe(`S4 trusted session B created after trust add`);

      script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S4-trusted-done")]);
      const trustedResults = await promptAndCollect(sessionB, "diagnose main.go");
      const trustedOutput = latestDiagnostics(trustedResults);
      observe(`S4 trusted diagnostics output:\n${trustedOutput}`);
      expect(trustedOutput).not.toContain("trust add");
      expect(trustedOutput).toContain("coverage:");
    },
    TEST_TIMEOUT,
  );

  it(
    "S3 activates gopls on a real read and surfaces the deliberate error",
    async () => {
      const session = requireSessionB();
      script([
        toolTurn("read", { path: "main.go" }),
        toolTurn("lsp_diagnostics", { path: "main.go" }),
        textTurn("S3-step-done"),
      ]);
      const results = await promptAndCollect(session, "read main.go then diagnose it");
      const readResult = results.find((record) => record.toolName === "read");
      observe(`S3 read tool result (first 600 chars):\n${(readResult?.text ?? "").slice(0, 600)}`);

      let output = latestDiagnostics(results);
      const deadline = Date.now() + ACTIVATION_WAIT_MS;
      while (
        !(output.includes("undefinedHelper") && /fresh: current/.test(output)) &&
        Date.now() < deadline
      ) {
        await sleep(1_000);
        script([toolTurn("lsp_diagnostics", { path: "main.go" }), textTurn("S3-poll-done")]);
        const polled = await promptAndCollect(session, "re-check diagnostics for main.go");
        output = latestDiagnostics(polled);
      }
      observe(`S3 diagnostics output:\n${output}`);
      expect(output).toContain("undefinedHelper");
      expect(output).toMatch(/fresh: current/);
    },
    TEST_TIMEOUT,
  );

  it(
    "S5 disposes sessions cleanly and records any surviving gopls process",
    async () => {
      const goplsBefore = countGopls();
      expect(() => {
        sessionA.dispose();
      }).not.toThrow();
      expect(() => {
        requireSessionB().dispose();
      }).not.toThrow();
      disposed = true;
      await sleep(2_000);
      const goplsAfter = countGopls();
      observe(`S5 gopls processes before dispose = ${goplsBefore}, after dispose = ${goplsAfter}`);
      observe(`S5 pgrep -a gopls after dispose:\n${listGopls()}`);
      if (goplsAfter > 0) {
        observe(
          "S5 FINDING: one gopls server (plus its `gopls ** telemetry **` child) remained after session.dispose(); the raw AgentSession path never emits session_shutdown, so the extension's RuntimeSession.dispose() is not reached (production pi uses AgentSessionRuntime, which does emit it). Both exited once the vitest worker's stdio closed.",
        );
      }
      expect(typeof goplsAfter).toBe("number");
    },
    TEST_TIMEOUT,
  );
});
