import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = { name: string; parameters: unknown; annotations?: unknown; execute: (id: string, params: { path: string; line: number; character: number }, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ text?: string }> }> };
function fakePiApi() {
	const tools = new Map<string, Tool>();
	return { tools, on() { return () => {}; }, registerTool(tool: Tool) { tools.set(tool.name, tool); } };
}
const sessions: RuntimeSession[] = [];
const projects: string[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.dispose())); await Promise.all(projects.splice(0).map(removeProject)); });
async function setup(options: { trusted?: boolean; servers?: number } = {}) {
	const project = await createProject(options.trusted ?? true); projects.push(project.projectRoot);
	const config = fakeConfig({ navigation: true });
	if (options.servers && options.servers > 1 && config.lsp !== false) {
		config.lsp.other = { ...config.lsp.fake! };
	}
	const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath }); sessions.push(session);
	const pi = fakePiApi(); createExtension({ createSession: async () => session })(pi as never);
	return { ...project, session, tool: pi.tools.get("lsp_hover") };
}
async function execute(tool: Tool | undefined, path: string, line: number, character: number, cwd: string) {
	if (!tool) throw new Error("hover tool was not registered");
	const result = await tool.execute("call", { path, line, character }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}
describe("lsp_hover", () => {
	it("registers as read-only with a strict 1-based position schema", async () => {
		const { filePath, projectRoot, tool } = await setup();
		await execute(tool, filePath, 1, 1, projectRoot);
		expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
		expect(tool?.parameters).toMatchObject({ required: ["path", "line", "character"], additionalProperties: false });
	});
	it("returns hover text and exact coverage footer", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		vi.spyOn(session, "hover").mockResolvedValue({ outcome: "ok", hover: { contents: { kind: "markdown", value: "**symbol**" } } });
		expect(await execute(tool, filePath, 2, 4, projectRoot)).toBe("**symbol**\ncoverage: 1 server(s) queried for this position; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; other positions and files not checked");
		expect(session.hover).toHaveBeenCalledWith("fake", expect.any(String), 1, 3, 5000, expect.anything());
	});
	it("uses the fixture server response and its null no-hover path", async () => {
		const { filePath, projectRoot, tool } = await setup();
		expect(await execute(tool, filePath, 1, 1, projectRoot)).toContain("**fixture hover**");
		expect(await execute(tool, filePath, 1, 2, projectRoot)).toContain("No hover found at this position.");
	});
	it("shows server headers for multiple matched servers", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ servers: 2 });
		vi.spyOn(session, "hover").mockImplementation(async (serverId) => ({ outcome: "ok", hover: { contents: serverId } }));
		const output = await execute(tool, filePath, 1, 1, projectRoot);
		expect(output.split("\n").slice(0, 4)).toEqual(["fake:", "fake", "other:", "other"]);
		expect(output).toContain("coverage: 2 server(s) queried for this position;");
	});
	it("reports unsupported and failed servers", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		vi.spyOn(session, "hover").mockResolvedValue({ outcome: "unsupported", hover: null });
		expect(await execute(tool, filePath, 1, 1, projectRoot)).toBe("fake does not support hover");
		vi.spyOn(session, "hover").mockResolvedValue({ outcome: "failed", hover: null });
		expect(await execute(tool, filePath, 1, 1, projectRoot)).toBe("failed to retrieve hover from fake");
	});
	it("validates coordinates before requesting", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		const request = vi.spyOn(session, "hover");
		expect(await execute(tool, filePath, 0, 1, projectRoot)).toBe("line and character must be positive integers (1-based).");
		expect(await execute(tool, filePath, 1, 1.5, projectRoot)).toBe("line and character must be positive integers (1-based).");
		expect(request).not.toHaveBeenCalled();
	});
	it("returns trust guidance and no-match text", async () => {
		const untrusted = await setup({ trusted: false });
		expect(await execute(untrusted.tool, untrusted.filePath, 1, 1, untrusted.projectRoot)).toContain("pi-lsp-onread trust add");
		const matching = await setup();
		if (!matching.session.configResult.ok || matching.session.configResult.config.lsp === false) throw new Error("Expected config");
		matching.session.configResult.config.lsp.fake!.extensions = [".rs"];
		expect(await execute(matching.tool, matching.filePath, 1, 1, matching.projectRoot)).toBe("No language servers match this file.");
	});
});
