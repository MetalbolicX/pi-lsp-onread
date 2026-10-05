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
async function setup(options: { trusted?: boolean; rename?: boolean; renameBoolean?: boolean; overlapping?: boolean; prepareBareRange?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const config = fakeConfig();
	if (config.lsp === false) throw new Error("Expected LSP config");
	config.lsp.fake!.env = {
		...(options.rename ? { FAKE_RENAME: "1" } : {}),
		...(options.renameBoolean ? { FAKE_RENAME_BOOLEAN: "1" } : {}),
		...(options.overlapping ? { FAKE_OVERLAPPING_RENAME: "1" } : {}),
		...(options.prepareBareRange ? { FAKE_PREPARE_BARE_RANGE: "1" } : {}),
	};
	const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
	sessions.push(session);
	const pi = fakePiApi();
	createExtension({ createSession: vi.fn(async () => session) as never })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_rename") };
}
async function execute(tool: Tool | undefined, path: string, cwd: string, params: Record<string, unknown> = {}) {
	if (!tool) throw new Error("rename tool was not registered");
	const result = await tool.execute("call-1", { path, line: 1, character: 1, ...params }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}
const prepareFooter = "coverage: 1 server(s) checked for this position; readiness reflects each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; nothing was applied";
const previewFooter = "preview only: nothing was applied; coverage: 1 server(s) checked for this position; multi-file edits are rendered per file; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units";

describe("LSP rename tool", () => {
	it("registers read-only parameters and trust-gates activation", async () => {
		const untrusted = await setup({ trusted: false, rename: true });
		expect(untrusted.tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		expect(await execute(untrusted.tool, untrusted.filePath, untrusted.projectRoot)).toContain("pi-lsp-onread trust add");
		expect(untrusted.session.pool.size).toBe(0);
	});
	it("reports no matching server", async () => {
		const value = await setup({ rename: true });
		if (!value.session.configResult.ok || value.session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		value.session.configResult.config.lsp.fake!.extensions = [".rs"];
		expect(await execute(value.tool, value.filePath, value.projectRoot)).toBe("No language servers match this file.");
	});
	it("prepares with exact line structure and handles an unadvertised prepare capability", async () => {
		const capable = await setup({ rename: true });
		const ready = await execute(capable.tool, capable.filePath, capable.projectRoot, { mode: "prepare" });
		expect(ready.split("\n")).toEqual(["fake: ready to rename \"fixtureSymbol\" at L1:C1-L1:C14.", prepareFooter]);
		const declined = await setup({ rename: true });
		vi.spyOn(declined.session, "prepareRename").mockResolvedValue({ outcome: "ok", prepare: null });
		expect((await execute(declined.tool, declined.filePath, declined.projectRoot, { mode: "prepare" })).split("\n")).toEqual([
			"fake: position is not renamable (server returned no prepare result).", "No matched language server offers prepareRename for this position.", prepareFooter,
		]);
		const booleanProvider = await setup({ renameBoolean: true });
		const unsupported = await execute(booleanProvider.tool, booleanProvider.filePath, booleanProvider.projectRoot, { mode: "prepare" });
		expect(unsupported.split("\n")).toEqual(["fake does not support prepareRename (plain rename may still be available).", "No matched language server offers prepareRename for this position.", prepareFooter]);
	});
	it("renders a bare Range prepare result as an at-clause without a placeholder", async () => {
		const value = await setup({ rename: true, prepareBareRange: true });
		const ready = await execute(value.tool, value.filePath, value.projectRoot, { mode: "prepare" });
		expect(ready.split("\n")).toEqual([`fake: ready to rename at L1:C1-L1:C14.`, prepareFooter]);
	});
	it("previews multi-file rename edits and rejects overlapping edits", async () => {
		const value = await setup({ rename: true });
		const preview = await execute(value.tool, value.filePath, value.projectRoot, { newName: "renamedSymbol" });
		expect(preview.split("\n")).toEqual([
			`warning: current content unavailable for ${value.filePath}.second; ranges unverified`,
			value.filePath, "L1:1-1:6", "- error", "+ renamedSymbol", "L1:8-1:14", "- broken source", "+ renamedSymbol",
			`${value.filePath}.second`, "L1:1-1:1", "+ renamedSymbol", previewFooter,
		]);
		const overlap = await setup({ rename: true, overlapping: true });
		const rejected = await execute(overlap.tool, overlap.filePath, overlap.projectRoot, { newName: "renamedSymbol" });
		expect(rejected.split("\n")).toEqual(["fake: preview rejected:", `overlapping text edits in ${overlap.filePath}`, "No rename preview available.", previewFooter]);
	});
	it("validates name and position, and reports null edits", async () => {
		const value = await setup({ rename: true });
		expect(await execute(value.tool, value.filePath, value.projectRoot)).toBe("newName must be a non-empty string.");
		expect(await execute(value.tool, value.filePath, value.projectRoot, { newName: "" })).toBe("newName must be a non-empty string.");
		expect(await execute(value.tool, value.filePath, value.projectRoot, { line: 0 })).toBe("line and character must be positive integers (1-based).");
		expect(await execute(value.tool, value.filePath, value.projectRoot, { character: 1.5 })).toBe("line and character must be positive integers (1-based).");
		vi.spyOn(value.session, "rename").mockResolvedValue({ outcome: "ok", edit: null });
		expect((await execute(value.tool, value.filePath, value.projectRoot, { newName: "new" })).split("\n")).toEqual(["fake returned no rename edit.", "No rename preview available.", previewFooter]);
	});
	it("reports per-server headers, unsupported providers, and failed requests", async () => {
		const value = await setup({ rename: true });
		if (!value.session.configResult.ok || value.session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		value.session.configResult.config.lsp.other = { ...value.session.configResult.config.lsp.fake!, command: [process.execPath, "unused"], env: {} };
		value.session.configResult.config.lsp.other!.extensions = [".ts"];
		vi.spyOn(value.session, "rename").mockImplementation(async (serverId) => serverId === "fake"
			? { outcome: "ok", edit: { changes: { [`file://${value.filePath}`]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "n" }] } } }
			: { outcome: "unsupported", edit: null });
		const output = await execute(value.tool, value.filePath, value.projectRoot, { newName: "new" });
		expect(output.split("\n")).toEqual([
			"other does not support rename.", value.filePath, "L1:1-1:2", "- e", "+ n", previewFooter.replace("1 server(s)", "2 server(s)"),
		]);
		vi.spyOn(value.session, "rename").mockResolvedValue({ outcome: "failed", edit: null });
		const failed = await execute(value.tool, value.filePath, value.projectRoot, { newName: "new" });
		expect(failed.split("\n")).toEqual([
			"failed to retrieve rename edit from fake", "failed to retrieve rename edit from other", "No rename preview available.",
			"preview only: nothing was applied; coverage: 2 server(s) checked for this position; multi-file edits are rendered per file; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units",
		]);
	});
});
