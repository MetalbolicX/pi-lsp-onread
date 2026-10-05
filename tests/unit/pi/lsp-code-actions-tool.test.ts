import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
	name: string;
	parameters: unknown;
	annotations?: unknown;
	execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ text?: string }> }>;
};

function fakePiApi() {
	const tools = new Map<string, Tool>();
	return {
		tools,
		on() { return () => {}; },
		registerTool(tool: Tool) { tools.set(tool.name, tool); },
	};
}

const sessions: RuntimeSession[] = [];
const projects: string[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});

async function setup(options: { trusted?: boolean; codeActions?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ codeActions: options.codeActions }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	sessions.push(session);
	const pi = fakePiApi();
	createExtension({ createSession: vi.fn(async () => session) as never })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_code_actions") };
}

async function execute(tool: Tool | undefined, path: string, cwd: string, params: Record<string, unknown> = {}) {
	if (!tool) throw new Error("code actions tool was not registered");
	const result = await tool.execute("call-1", { path, line: 1, character: 1, ...params }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("LSP code actions tool", () => {
	it("registers a read-only tool with validated schemas", async () => {
		const { tool } = await setup();
		expect(tool).toBeDefined();
		if (!tool) throw new Error("Expected code actions tool to be registered");
		expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		const schema = tool.parameters as { required: string[]; additionalProperties: boolean; properties: Record<string, { type: string; minimum?: number }> };
		expect(schema.required).toEqual(["path", "line", "character"]);
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.action).toEqual({ type: "integer", minimum: 1 });
		expect(schema.properties.line).toEqual({ type: "integer", minimum: 1 });
		expect(schema.properties.character).toEqual({ type: "integer", minimum: 1 });
	});

	it("lists actions with stable numbers, exact markers, and the read-only footer", async () => {
		const { filePath, projectRoot, tool } = await setup({ codeActions: true });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("1. [previewable] Fix thing (quickfix) (quickfix)");
		expect(output).toContain("2. [needs resolve] Organize imports (needs resolve) (source.organizeImports)");
		expect(output).toContain("3. [command only — not previewable] Do fake thing (command only) (quickfix)");
		expect(output).toContain("coverage: 1 server(s) checked for this position; actions are listed as reported by servers; call this tool with an action number to preview its edit — previews are never applied, and commands are never executed");
		const outputLines = output.split("\n");
		expect(outputLines.some((entry) => entry.startsWith("2. [needs resolve]"))).toBe(true);
	});

	it("previews inline and resolved edits without applying them", async () => {
		const { filePath, projectRoot, tool } = await setup({ codeActions: true });
		const inline = await execute(tool, filePath, projectRoot, { action: 1 });
		expect(inline).toContain("action 1: Fix thing (quickfix)");
		expect(inline).toContain("+ // fixed line 0");
		expect(inline).toContain("preview only: nothing was applied");
		const resolved = await execute(tool, filePath, projectRoot, { action: 2 });
		expect(resolved).toContain("action 2: Organize imports (needs resolve)");
		expect(resolved).toContain("+ // organized line 0");
	});

	it("refuses command-only actions and validates indices", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		expect(await execute(tool, filePath, projectRoot, { action: 3 })).toContain("Action 3 is command-only; pi-lsp-onread never executes server commands.");
		expect(await execute(tool, filePath, projectRoot, { action: 4 })).toContain("No action at index 4. Call without action to list available actions.");
		const resolveAction = vi.spyOn(session, "resolveCodeAction");
		expect(await execute(tool, filePath, projectRoot, { action: 0 })).toBe("action must be a positive integer.");
		expect(resolveAction).not.toHaveBeenCalled();
	});

	it("rejects previews outside the trusted root", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		vi.spyOn(session, "codeActions").mockResolvedValue({ outcome: "ok", actions: [{ title: "Escape", edit: { changes: { "file:///etc/other.txt": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "bad" }] } } }] });
		const output = await execute(tool, filePath, projectRoot, { action: 1 });
		expect(output).toContain("preview rejected for action 1:");
		expect(output).toContain("outside trusted root");
	});

	it("reports unsupported, untrusted, and unmatched servers", async () => {
		const unsupported = await setup();
		expect(await execute(unsupported.tool, unsupported.filePath, unsupported.projectRoot)).toContain("fake does not support code actions");
		const untrusted = await setup({ trusted: false, codeActions: true });
		expect(await execute(untrusted.tool, untrusted.filePath, untrusted.projectRoot)).toContain("pi-lsp-onread trust add");
		const unmatched = await setup({ codeActions: true });
		if (!unmatched.session.configResult.ok || unmatched.session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		unmatched.session.configResult.config.lsp.fake!.extensions = [".rs"];
		expect(await execute(unmatched.tool, unmatched.filePath, unmatched.projectRoot)).toBe("No language servers match this file.");
	});

	it("rejects invalid coordinates before requesting actions and caps output", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		const request = vi.spyOn(session, "codeActions");
		expect(await execute(tool, filePath, projectRoot, { line: 0 })).toBe("line and character must be positive integers (1-based).");
		expect(request).not.toHaveBeenCalled();
		const oversized = vi.spyOn(session, "codeActions").mockResolvedValue({ outcome: "ok", actions: Array.from({ length: 1000 }, (_, index) => ({ title: "x".repeat(100), index })) });
		expect((await execute(tool, filePath, projectRoot)).length).toBeLessThanOrEqual(8000);
		expect(oversized).toHaveBeenCalled();
	});
});
