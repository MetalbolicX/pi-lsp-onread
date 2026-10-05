import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = { name: string; parameters: unknown; annotations?: unknown; execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ text?: string }> }> };
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
async function setup(options: { trusted?: boolean; formatting?: boolean; overlapping?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const config = fakeConfig();
	if (config.lsp === false) throw new Error("Expected LSP config");
	config.lsp.fake!.env = {
		...(options.formatting ? { FAKE_FORMATTING: "1" } : {}),
		...(options.overlapping ? { FAKE_OVERLAPPING_FORMATTING: "1" } : {}),
	};
	const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
	sessions.push(session);
	const pi = fakePiApi();
	createExtension({ createSession: vi.fn(async () => session) as never })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_formatting") };
}
async function execute(tool: Tool | undefined, path: string, cwd: string, params: Record<string, unknown> = {}) {
	if (!tool) throw new Error("formatting tool was not registered");
	const result = await tool.execute("call-1", { path, ...params }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}
function footer(options = "tabSize 2, insertSpaces true", count = 1) {
	return `preview only: nothing was applied; options: ${options}; coverage: ${count} server(s) checked for this file; results reflect each server's current view and may lag recent edits; other files are not formatted`;
}
const oneEdit = (newText: string) => [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText }];

describe("LSP formatting tool", () => {
	it("registers read-only parameters and trust-gates activation", async () => {
		const value = await setup({ trusted: false, formatting: true });
		expect(value.tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		expect(await execute(value.tool, value.filePath, value.projectRoot)).toContain("pi-lsp-onread trust add");
		expect(value.session.pool.size).toBe(0);
	});
	it("reports no matching server", async () => {
		const value = await setup({ formatting: true });
		if (!value.session.configResult.ok || value.session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		value.session.configResult.config.lsp.fake!.extensions = [".rs"];
		expect(await execute(value.tool, value.filePath, value.projectRoot)).toBe("No language servers match this file.");
	});
	it("renders an engine-validated single-server preview and exact options footer", async () => {
		const value = await setup({ formatting: true });
		const output = await execute(value.tool, value.filePath, value.projectRoot);
		expect(output.split("\n")).toEqual([
			value.filePath, "L1:1-1:6", "- error", "+ formatted with tabSize 2", "L2:1-2:1", "+ formatted with tabSize 2, insertSpaces true", footer(),
		]);
	});
	it("passes option overrides and falls back to tabSize 2 when invalid", async () => {
		const value = await setup({ formatting: true });
		expect((await execute(value.tool, value.filePath, value.projectRoot, { tabSize: 4, insertSpaces: false, trimTrailingWhitespace: true })).split("\n").at(-1)).toBe(footer("tabSize 4, insertSpaces false, trimTrailingWhitespace"));
		expect((await execute(value.tool, value.filePath, value.projectRoot, { tabSize: 0 })).split("\n").at(-1)).toBe(footer());
	});
	it("renders separate server sections with per-server headers", async () => {
		const value = await setup({ formatting: true });
		if (!value.session.configResult.ok || value.session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		value.session.configResult.config.lsp.other = { ...value.session.configResult.config.lsp.fake!, command: [process.execPath, "unused"], env: {} };
		value.session.configResult.config.lsp.other!.extensions = [".ts"];
		vi.spyOn(value.session, "formatting").mockImplementation(async (serverId) => ({ outcome: "ok", edits: oneEdit(serverId === "fake" ? "one" : "two") }));
		const output = await execute(value.tool, value.filePath, value.projectRoot);
		expect(output.split("\n")).toEqual([
			"fake:", value.filePath, "L1:1-1:2", "- e", "+ one", "other:", value.filePath, "L1:1-1:2", "- e", "+ two", footer("tabSize 2, insertSpaces true", 2),
		]);
	});
	it("reports unsupported and failed requests", async () => {
		const value = await setup({ formatting: true });
		vi.spyOn(value.session, "formatting").mockResolvedValue({ outcome: "unsupported", edits: [] });
		expect((await execute(value.tool, value.filePath, value.projectRoot)).split("\n")).toEqual(["fake does not support formatting.", "No formatting preview available.", footer()]);
		vi.spyOn(value.session, "formatting").mockResolvedValue({ outcome: "failed", edits: [] });
		expect((await execute(value.tool, value.filePath, value.projectRoot)).split("\n")).toEqual(["failed to retrieve formatting edits from fake", "No formatting preview available.", footer()]);
	});
	it("rejects overlapping formatting edits with the validation reason", async () => {
		const value = await setup({ formatting: true, overlapping: true });
		expect((await execute(value.tool, value.filePath, value.projectRoot)).split("\n")).toEqual([
			"fake: preview rejected:", `overlapping text edits in ${value.filePath}`, "No formatting preview available.", footer(),
		]);
	});
	it("reports no formatting changes when the server returns no edits", async () => {
		const value = await setup({ formatting: true });
		vi.spyOn(value.session, "formatting").mockResolvedValue({ outcome: "ok", edits: [] });
		expect((await execute(value.tool, value.filePath, value.projectRoot)).split("\n")).toEqual(["fake: no formatting changes.", "No formatting preview available.", footer()]);
	});
});
