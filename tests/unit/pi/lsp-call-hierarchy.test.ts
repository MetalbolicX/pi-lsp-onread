import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = { name: string; annotations?: unknown; execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ text?: string }> }> };
function fakePiApi() {
	const tools = new Map<string, Tool>();
	return { tools, on() { return () => {}; }, registerTool(tool: Tool) { tools.set(tool.name, tool); } };
}
const sessions: RuntimeSession[] = [];
const projects: string[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});
async function setup(enabled: boolean) {
	const project = await createProject(true);
	projects.push(project.projectRoot);
	const config = fakeConfig();
	if (config.lsp === false) throw new Error("Expected LSP configuration");
	if (enabled) config.lsp.fake!.env = { ...config.lsp.fake!.env, FAKE_CALL_HIERARCHY: "1" };
	const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
	sessions.push(session);
	const pi = fakePiApi();
	createExtension({ createSession: async () => session })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_call_hierarchy") };
}
async function execute(tool: Tool | undefined, path: string, cwd: string, params: Record<string, unknown> = {}) {
	if (!tool) throw new Error("call hierarchy tool was not registered");
	return (await tool.execute("call-1", { path, line: 1, character: 1, ...params }, undefined, undefined, { cwd })).content.map(({ text }) => text ?? "").join("\n");
}
describe("LSP call hierarchy", () => {
	it("registers a read-only tool and lists prepared items with a verbatim-item footer", async () => {
		const { filePath, projectRoot, tool } = await setup(true);
		await writeFile(filePath, "function alpha() { beta(); }\nfunction beta() {}\n");
		expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("1. alpha (Function)");
		expect(output).toContain("pass an item back verbatim as item with mode incoming or outgoing");
		expect(output).toContain(`${filePath}:1:1`);
	});
	it.each(["incoming", "outgoing"])("lists %s calls", async (mode) => {
		const { filePath, projectRoot, tool } = await setup(true);
		await writeFile(filePath, "function alpha() {}\nfunction beta() {}\n");
		const output = await execute(tool, filePath, projectRoot, { mode, item: { name: "alpha", kind: 12, uri: `file://${filePath}`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } } } });
		expect(output).toContain(mode === "incoming" ? "alphaPeer → alpha" : "alpha → alphaPeer");
		expect(output).toContain(`${filePath}:1:1`);
	});
	it("explains that prepare must come first when the item is missing", async () => {
		const { filePath, projectRoot, tool } = await setup(true);
		expect(await execute(tool, filePath, projectRoot, { mode: "incoming" })).toContain("prepare first at a position");
	});
	it("reports unsupported call hierarchy providers", async () => {
		const { filePath, projectRoot, tool } = await setup(false);
		expect(await execute(tool, filePath, projectRoot)).toContain("does not support call hierarchy");
	});
	it("bounds output", async () => {
		const { filePath, projectRoot, tool, session } = await setup(true);
		await writeFile(filePath, "function fixture() {}");
		vi.spyOn(session, "prepareCallHierarchy").mockResolvedValue({ outcome: "ok", items: Array.from({ length: 100 }, (_, index) => ({
			name: `function_${index}_${"x".repeat(100)}`, kind: 12, uri: `file://${filePath}`,
			selectionRange: { start: { line: 0, character: index }, end: { line: 0, character: index + 1 } },
		})) });
		const output = await execute(tool, filePath, projectRoot);
		expect(output.length).toBeLessThanOrEqual(8000);
		expect(output).toContain("coverage: 1 server(s) queried");
		expect(output).toContain("pass an item back verbatim as item with mode incoming or outgoing");
		expect(output).toContain("output truncated to 8000 characters");
	});
});
