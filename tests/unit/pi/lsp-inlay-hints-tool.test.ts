import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = { name: string; parameters: unknown; annotations?: unknown; execute: (id: string, params: { path: string; startLine?: number; endLine?: number }, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ text?: string }> }> };
function fakePiApi() {
	const tools = new Map<string, Tool>();
	return { tools, on() { return () => {}; }, registerTool(tool: Tool) { tools.set(tool.name, tool); } };
}
const sessions: RuntimeSession[] = [];
const projects: string[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.dispose())); await Promise.all(projects.splice(0).map(removeProject)); });
async function setup(options: { trusted?: boolean; servers?: number; resolveInlayHints?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true); projects.push(project.projectRoot);
	const config = fakeConfig();
	if (options.resolveInlayHints && config.lsp !== false) config.lsp.fake!.env = { ...config.lsp.fake!.env, FAKE_INLAY_HINT_RESOLVE: "1" };
	if (options.servers && options.servers > 1 && config.lsp !== false) config.lsp.other = { ...config.lsp.fake! };
	const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath }); sessions.push(session);
	const pi = fakePiApi(); createExtension({ createSession: async () => session })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_inlay_hints") };
}
async function execute(tool: Tool | undefined, path: string, cwd: string, startLine?: number, endLine?: number) {
	if (!tool) throw new Error("inlay hints tool was not registered");
	const result = await tool.execute("call", { path, ...(startLine === undefined ? {} : { startLine }), ...(endLine === undefined ? {} : { endLine }) }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}
describe("lsp_inlay_hints", () => {
	it("registers read-only and returns exact line structure and coverage", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "ok", hints: [{ position: { line: 0, character: 1 }, kind: 1, label: "string" }] });
		expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		expect(await execute(tool, filePath, projectRoot)).toBe("L1:C2  [type] string\ncoverage: 1 server(s) queried for this range; label text only, tooltips not resolved; results reflect each server's current view and may lag recent edits; lines are 1-based UTF-16 code units; other ranges and files not checked");
		expect(session.inlayHints).toHaveBeenCalledWith("fake", expect.any(String), 0, 200, 5000, expect.anything());
	});
	it("resolves fixture tooltips and reports resolution in separate output lines", async () => {
		const { filePath, projectRoot, tool } = await setup({ resolveInlayHints: true });
		await writeFile(filePath, "first line\nsecond line\n");
		const lines = (await execute(tool, filePath, projectRoot)).split("\n");
		expect(lines.slice(0, 3)).toEqual([
			"L1:C6  [type] string — fixture type tooltip",
			"L1:C9  [param] argument — fixture parameter tooltip",
			"L2:C1   -> result — fixture result tooltip",
		]);
		expect(lines.at(-1)).toContain("tooltips resolved when supported");
		expect(lines.at(-1)).not.toContain("tooltips not resolved");
	});
	it("continues after resolve failures and caps attempts at twenty per range", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ resolveInlayHints: true });
		const hints = Array.from({ length: 21 }, (_, index) => ({ position: { line: 0, character: index }, label: `hint-${index}` }));
		vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "ok", hints });
		const resolve = vi.spyOn(session, "resolveInlayHint").mockResolvedValue({ outcome: "failed", hint: null });
		const lines = (await execute(tool, filePath, projectRoot)).split("\n");
		expect(resolve).toHaveBeenCalledTimes(20);
		expect(lines.slice(0, 21)).toHaveLength(21);
		expect(lines[0]).toBe("L1:C1  hint-0");
		expect(lines[20]).toBe("L1:C21  hint-20");
		expect(lines.at(-1)).toContain("tooltips resolved when supported");
	});
	it("uses the fixture server inlay hints", async () => {
		const { filePath, projectRoot, tool } = await setup();
		await writeFile(filePath, "first line\nsecond line\n");
		const output = await execute(tool, filePath, projectRoot);
		expect(output.split("\n").slice(0, 3)).toEqual(["L1:C6  [type] string", "L1:C9  [param] argument", "L2:C1   -> result"]);
	});
	it("uses a 200-line default window and clamps requests to 2000 lines", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		const request = vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "ok", hints: [] });
		await execute(tool, filePath, projectRoot);
		expect(request).toHaveBeenLastCalledWith("fake", expect.any(String), 0, 200, 5000, expect.anything());
		await execute(tool, filePath, projectRoot, 4, 9000);
		expect(request).toHaveBeenLastCalledWith("fake", expect.any(String), 3, 2003, 5000, expect.anything());
	});
	it("shows sections for multiple servers", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ servers: 2 });
		vi.spyOn(session, "inlayHints").mockImplementation(async (serverId) => ({ outcome: "ok", hints: [{ position: { line: 0, character: 0 }, label: serverId }] }));
		const output = await execute(tool, filePath, projectRoot);
		expect(output.split("\n").slice(0, 4)).toEqual(["fake:", "L1:C1  fake", "other:", "L1:C1  other"]);
		expect(output).toContain("coverage: 2 server(s) queried for this range;");
	});
	it("reports unsupported and failed servers", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "unsupported", hints: [] });
		expect(await execute(tool, filePath, projectRoot)).toBe("fake does not support inlay hints");
		vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "failed", hints: [] });
		expect(await execute(tool, filePath, projectRoot)).toBe("failed to retrieve inlay hints from fake");
	});
	it("reports empty results, validates range, and handles trust/no-match", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		vi.spyOn(session, "inlayHints").mockResolvedValue({ outcome: "ok", hints: [] });
		expect(await execute(tool, filePath, projectRoot)).toContain("No inlay hints in the requested range.");
		expect(await execute(tool, filePath, projectRoot, 8, 2)).toBe("startLine must be <= endLine.");
		const untrusted = await setup({ trusted: false });
		expect(await execute(untrusted.tool, untrusted.filePath, untrusted.projectRoot)).toContain("pi-lsp-onread trust add");
		const noMatch = await setup();
		if (!noMatch.session.configResult.ok || noMatch.session.configResult.config.lsp === false) throw new Error("Expected config");
		noMatch.session.configResult.config.lsp.fake!.extensions = [".rs"];
		expect(await execute(noMatch.tool, noMatch.filePath, noMatch.projectRoot)).toBe("No language servers match this file.");
	});
});
