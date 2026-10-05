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

async function setup(options: { trusted?: boolean; codeActions?: boolean; variants?: string } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ codeActions: options.codeActions }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	if (session.configResult.ok && session.configResult.config.lsp !== false && options.variants) {
		session.configResult.config.lsp.fake!.env = { ...session.configResult.config.lsp.fake!.env, FAKE_ORGANIZE_IMPORTS_VARIANTS: options.variants };
	}
	sessions.push(session);
	const pi = fakePiApi();
	createExtension({ createSession: vi.fn(async () => session) as never })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_organize_imports") };
}

async function execute(tool: Tool | undefined, path: string, cwd: string) {
	if (!tool) throw new Error("organize imports tool was not registered");
	const result = await tool.execute("call-1", { path }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

const footer = "preview only: nothing was applied; coverage: 1 server(s) checked for this file; results reflect each server's current view and may lag recent edits";

describe("LSP organize imports tool", () => {
	it("registers a read-only tool with a closed path-only schema", async () => {
		const { tool } = await setup();
		expect(tool).toBeDefined();
		if (!tool) throw new Error("Expected organize imports tool to be registered");
		expect(tool.name).toBe("lsp_organize_imports");
		expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		const schema = tool.parameters as { required: string[]; additionalProperties: boolean; properties: Record<string, { type: string }> };
		expect(schema.required).toEqual(["path"]);
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties).toEqual({ path: { type: "string" } });
	});

	it("previews the resolved organize-imports edit without applying it", async () => {
		const { filePath, projectRoot, tool } = await setup({ codeActions: true });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("+ // organized line 0");
		expect(output).toContain(filePath);
		expect(output).toContain(footer);
		const outputLines = output.split("\n");
		expect(outputLines.some((line) => line.startsWith("+ // organized line 0"))).toBe(true);
	});

	it("prefers an exact organize-imports kind over prefixed siblings", async () => {
		const { filePath, projectRoot, tool } = await setup({ codeActions: true, variants: "exact-and-prefix" });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("+ // exact organize imports");
		expect(output).not.toContain("additional organize-imports action(s) not shown.");
	});

	it("reports omitted additional prefix-matching organize-imports actions", async () => {
		const { filePath, projectRoot, tool } = await setup({ codeActions: true, variants: "prefix-only" });
		const output = await execute(tool, filePath, projectRoot);
		expect(output.split("\n")).toContain("fake: 1 additional organize-imports action(s) not shown.");
	});

	it("reports when a server has no organize-imports action", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		vi.spyOn(session, "codeActions").mockResolvedValue({ outcome: "ok", actions: [{ title: "Fix", kind: "quickfix" }] });
		expect(await execute(tool, filePath, projectRoot)).toContain("fake reported no organize-imports action.");
	});

	it("rejects an organize-imports edit outside the trusted root", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		vi.spyOn(session, "codeActions").mockResolvedValue({ outcome: "ok", actions: [{ kind: "source.organizeImports", edit: { changes: { "file:///etc/other.txt": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "bad" }] } } }] });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("preview rejected for fake:");
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

	it("bounds the complete output", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ codeActions: true });
		vi.spyOn(session, "codeActions").mockResolvedValue({ outcome: "ok", actions: [{ kind: "source.organizeImports", edit: { changes: { [new URL(`file://${filePath}`).href]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "x".repeat(20_000) }] } } }] });
		expect((await execute(tool, filePath, projectRoot)).length).toBeLessThanOrEqual(8000);
	});
});
