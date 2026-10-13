import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  parameters: unknown;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    update?: unknown,
    ctx?: { cwd: string },
  ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
};

function fakePiApi() {
  const tools = new Map<string, Tool>();
  return {
    tools,
    on() {
      return () => {};
    },
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
  };
}

const sessions: RuntimeSession[] = [];
const projects: string[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await Promise.all(projects.splice(0).map(removeProject));
});

async function setup(options: { navigation?: boolean; codeLens?: boolean } = {}) {
  const project = await createProject();
  projects.push(project.projectRoot);
  const config = fakeConfig({ navigation: options.navigation });
  if (config.lsp !== false)
    config.lsp.fake!.env = {
      ...config.lsp.fake!.env,
      ...(options.codeLens ? { FAKE_CODE_LENS: "1" } : {}),
    };
  const session = await RuntimeSession.create({
    config,
    projectRoot: project.projectRoot,
    trustStorePath: project.trustStorePath,
  });
  sessions.push(session);
  const pi = fakePiApi();
  createExtension({ createSession: vi.fn(async () => session) as never })(pi as never);
  return {
    ...project,
    session,
    selection: pi.tools.get("lsp_selection_range"),
    highlight: pi.tools.get("lsp_document_highlight"),
    lens: pi.tools.get("lsp_code_lens"),
  };
}

async function execute(tool: Tool | undefined, params: Record<string, unknown>, cwd: string) {
  if (!tool) throw new Error("editor tool was not registered");
  return (await tool.execute("call", params, undefined, undefined, { cwd })).content
    .map((item) => item.text ?? "")
    .join("\n");
}

describe("LSP editor tools", () => {
  it("registers three read-only one-shot tools", async () => {
    const { selection, highlight, lens } = await setup();
    for (const tool of [selection, highlight, lens]) {
      expect(tool).toBeDefined();
      expect(tool?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("returns server-provided selection nesting and document highlight kinds", async () => {
    const { filePath, projectRoot, selection, highlight } = await setup({ navigation: true });
    await writeFile(filePath, "function alpha() {\n  return alpha;\n}\n");
    const selectionLines = (
      await execute(selection, { path: filePath, line: 1, character: 10 }, projectRoot)
    ).split("\n");
    expect(selectionLines.some((line) => line.startsWith("1. L"))).toBe(true);
    expect(selectionLines.at(-1)).toContain("server-provided nesting");
    const highlightLines = (
      await execute(highlight, { path: filePath, line: 1, character: 10 }, projectRoot)
    ).split("\n");
    expect(highlightLines.some((line) => line.endsWith("(text)"))).toBe(true);
    expect(highlightLines.some((line) => line.endsWith("(read)"))).toBe(true);
    expect(highlightLines.some((line) => line.endsWith("(write)"))).toBe(true);
  });

  it("shows only code-lens titles intersecting the requested range and never executes commands", async () => {
    const { filePath, projectRoot, lens } = await setup({ codeLens: true });
    await writeFile(filePath, "one\ntwo\nthree\n");
    const lines = (
      await execute(lens, { path: filePath, startLine: 1, endLine: 2 }, projectRoot)
    ).split("\n");
    expect(lines.some((line) => line.includes('"3 references"'))).toBe(true);
    expect(lines.some((line) => line.includes("(no title)"))).toBe(true);
    expect(lines.some((line) => line.includes("outside range"))).toBe(false);
    expect(lines.some((line) => line.includes("never executed"))).toBe(true);
    expect(lines.some((line) => line.includes("unresolved"))).toBe(true);
  });

  it("marks over-cap results and preserves unknown highlight kinds", async () => {
    const { filePath, projectRoot, session, highlight, lens } = await setup();
    const highlightEntry = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      kind: 99,
    };
    const lensEntry = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      command: { title: "many" },
    };
    vi.spyOn(session, "documentHighlight").mockResolvedValue({
      outcome: "ok",
      highlights: Array.from({ length: 101 }, () => highlightEntry),
    });
    vi.spyOn(session, "codeLens").mockResolvedValue({
      outcome: "ok",
      lenses: Array.from({ length: 101 }, () => lensEntry),
    });
    const highlights = await execute(
      highlight,
      { path: filePath, line: 1, character: 1 },
      projectRoot,
    );
    expect(highlights.split("\n").some((line) => line.endsWith("(unknown)"))).toBe(true);
    expect(highlights).toContain("… 1 more highlights omitted (cap 100)");
    const lenses = await execute(lens, { path: filePath }, projectRoot);
    expect(lenses).toContain("… 1 more code lenses omitted (cap 100)");
  });

  it("reports unsupported providers and validates line windows", async () => {
    const { filePath, projectRoot, selection, highlight, lens } = await setup();
    expect(
      await execute(selection, { path: filePath, line: 1, character: 1 }, projectRoot),
    ).toContain("does not support selection range");
    expect(
      await execute(highlight, { path: filePath, line: 1, character: 1 }, projectRoot),
    ).toContain("does not support document highlight");
    expect(
      await execute(lens, { path: filePath, startLine: 3, endLine: 2 }, projectRoot),
    ).toContain("startLine must be <= endLine.");
  });
});
