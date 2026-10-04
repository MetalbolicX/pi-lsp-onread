import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
	name: string;
	parameters: unknown;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
	execute: (id: string, params: { path: string; query: string }, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
};

function fakePiApi() {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	return {
		tools,
		handlers,
		on(event: string, handler: (...args: never[]) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		registerTool(tool: Tool) { tools.set(tool.name, tool); },
	};
}

const sessions: RuntimeSession[] = [];
const projects: string[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});

async function setup(options: { trusted?: boolean; workspaceSymbols?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ workspaceSymbols: options.workspaceSymbols }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	sessions.push(session);
	const pi = fakePiApi();
	const createSession = vi.fn(async () => session);
	createExtension({ createSession: createSession as never })(pi as never);
	return { ...project, session, createSession, tool: pi.tools.get("lsp_workspace_symbols") };
}

async function execute(tool: Tool | undefined, path: string, query: string, cwd: string) {
	if (!tool) throw new Error("lsp_workspace_symbols tool was not registered");
	const result = await tool.execute("call-1", { path, query }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("lsp_workspace_symbols tool", () => {
	it("registers with read-only intent", async () => {
		const { tool } = await setup();
		expect(tool).toBeDefined();
		expect(tool?.name).toBe("lsp_workspace_symbols");
		expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
	});

	it("returns fixture-backed matching workspace symbols and coverage", async () => {
		const { filePath, projectRoot, tool } = await setup({ workspaceSymbols: true });
		await writeFile(filePath, "export function findThing() { return true; }\n");
		const output = await execute(tool, filePath, "find", projectRoot);
		expect(output).toContain("findThing");
		expect(output).toContain("coverage:");
		expect(output).toMatch(/broken\.ts:\d+:\d+/);
	});

	it("reports when the query matches no symbols", async () => {
		const { filePath, projectRoot, tool } = await setup({ workspaceSymbols: true });
		await writeFile(filePath, "function findThing() {}\n");
		const output = await execute(tool, filePath, "nothing-here", projectRoot);
		expect(output).toContain('No symbols matched "nothing-here" in the server\'s current index.');
	});

	it("reports matched servers without workspace-symbol support", async () => {
		const { filePath, projectRoot, tool } = await setup();
		const output = await execute(tool, filePath, "find", projectRoot);
		expect(output).toContain("fake does not support workspace symbol search");
	});

	it("rejects an empty query after activation without requesting symbols", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ workspaceSymbols: true });
		const workspaceSymbols = vi.spyOn(session, "workspaceSymbols");
		const output = await execute(tool, filePath, "  \t ", projectRoot);
		expect(output).toBe("Search query must not be empty.");
		expect(workspaceSymbols).not.toHaveBeenCalled();
	});

	it("returns trust guidance without starting a server for an untrusted root", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ trusted: false, workspaceSymbols: true });
		const output = await execute(tool, filePath, "find", projectRoot);
		expect(output).toContain("pi-lsp-onread trust add");
		expect(session.pool.size).toBe(0);
	});

	it("states explicitly when no server matches the file", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ workspaceSymbols: true });
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		session.configResult.config.lsp.fake!.extensions = [".rs"];
		const output = await execute(tool, filePath, "find", projectRoot);
		expect(output).toContain("No language servers match this file.");
		expect(session.pool.size).toBe(0);
	});

	it("keeps output within the 8000-character limit", async () => {
		const { filePath, projectRoot, tool } = await setup({ workspaceSymbols: true });
		await writeFile(filePath, Array.from({ length: 500 }, (_, index) => `function symbol${index}() {}`).join("\n"));
		const output = await execute(tool, filePath, "symbol", projectRoot);
		expect(output.length).toBeLessThanOrEqual(8000);
	});
});
