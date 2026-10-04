import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
	name: string;
	parameters: unknown;
	annotations?: { readOnlyHint?: boolean };
	execute: (id: string, params: { path: string }, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
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

async function setup(options: { trusted?: boolean; pullDiagnostics?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ pullDiagnostics: options.pullDiagnostics }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	sessions.push(session);
	const pi = fakePiApi();
	const createSession = vi.fn(async () => session);
	createExtension({ createSession: createSession as never })(pi as never);
	return { ...project, session, createSession, tool: pi.tools.get("lsp_diagnostics") };
}

async function execute(tool: Tool | undefined, path: string, cwd: string) {
	if (!tool) throw new Error("lsp_diagnostics tool was not registered");
	const result = await tool.execute("call-1", { path }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("lsp_diagnostics tool", () => {
	it("registers the exact tool with read-only intent", async () => {
		const { tool } = await setup();
		expect(tool).toBeDefined();
		expect(tool?.name).toBe("lsp_diagnostics");
		expect(tool?.annotations?.readOnlyHint).toBe(true);
	});

	it("returns pulled diagnostics, freshness, and exact file-only coverage", async () => {
		const { filePath, projectRoot, tool } = await setup({ pullDiagnostics: true });
		const output = await execute(tool, "broken.ts", projectRoot);
		expect(output).toContain("Diagnostics for broken.ts:");
		expect(output).toContain("fresh: current");
		expect(output).toContain("error 1:1 fake-lsp: error: broken source");
		expect(output).toContain("coverage: 1 server(s) checked for this file; other files and workspace not checked");
		expect(filePath).toBe(`${projectRoot}/broken.ts`);
	});

	it("returns trust guidance without starting a server for an untrusted root", async () => {
		const { filePath, projectRoot, session, createSession, tool } = await setup({ trusted: false });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("pi-lsp-onread trust add");
		expect(session.pool.size).toBe(0);
		expect(createSession).toHaveBeenCalledTimes(1);
	});

	it("states explicitly when no server matches the file", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		session.configResult.config.lsp.fake!.extensions = [".rs"];
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("No language servers match this file.");
		expect(session.pool.size).toBe(0);
	});

	it("does not present a cached successful pull as fresh after a later pull hangs", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ pullDiagnostics: true });
		const initial = await execute(tool, filePath, projectRoot);
		expect(initial).toContain("fresh: current");
		expect(initial).toContain("error 1:1 fake-lsp: error: broken source");
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		const server = session.configResult.config.lsp.fake!;
		server.env = { ...server.env, FAKE_HANG_METHOD: "textDocument/diagnostic", FAKE_SUPPRESS_PUBLISH: "1" };
		const poolKey = session.getPoolKey("fake", projectRoot);
		const previousClient = session.pool.get(poolKey);
		if (!previousClient) throw new Error("Expected pooled fake client");
		session.pool.delete(poolKey);
		await previousClient.dispose();

		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("failed to pull diagnostics from fake");
		expect(output).not.toContain("fresh: current");
		expect(output).not.toContain("error 1:1 fake-lsp: error: broken source");
	}, 10_000);

	it("bounds pull failures, names the failed server, and does not imply clean diagnostics", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ pullDiagnostics: true });
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		const server = session.configResult.config.lsp.fake!;
		server.env = { ...server.env, FAKE_HANG_METHOD: "textDocument/diagnostic", FAKE_SUPPRESS_PUBLISH: "1" };
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("failed to pull diagnostics from fake");
		expect(output).not.toMatch(/\b(clean|all clear|no issues)\b/i);
		expect(output.length).toBeLessThan(10_000);
	}, 10_000);

	it("resolves relative paths against the tool context cwd", async () => {
		const { projectRoot, createSession, tool } = await setup({ pullDiagnostics: true });
		await execute(tool, "broken.ts", projectRoot);
		expect(createSession).toHaveBeenCalledWith(projectRoot);
	});
});
