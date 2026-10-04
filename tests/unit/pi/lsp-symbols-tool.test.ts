import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
	name: string;
	parameters: unknown;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
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

async function setup(options: { trusted?: boolean; documentSymbols?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ documentSymbols: options.documentSymbols }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	sessions.push(session);
	const pi = fakePiApi();
	const createSession = vi.fn(async () => session);
	createExtension({ createSession: createSession as never })(pi as never);
	return { ...project, session, createSession, tool: pi.tools.get("lsp_symbols") };
}

async function execute(tool: Tool | undefined, path: string, cwd: string) {
	if (!tool) throw new Error("lsp_symbols tool was not registered");
	const result = await tool.execute("call-1", { path }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("lsp_symbols tool", () => {
	it("registers with read-only intent", async () => {
		const { tool } = await setup();
		expect(tool).toBeDefined();
		expect(tool?.name).toBe("lsp_symbols");
		expect(tool?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
	});

	it("returns fixture-backed symbols and file-only coverage", async () => {
		const { filePath, projectRoot, tool } = await setup({ documentSymbols: true });
		await writeFile(filePath, "export function greet() { return 'hello'; }\nclass Greeter {}\n");
		const output = await execute(tool, "broken.ts", projectRoot);
		expect(output).toContain("coverage: 1 server(s) checked for this file;");
		expect(output).toContain("greet [function]");
		expect(output).toContain("Greeter [class]");
		expect(output).toContain("L1:1-");
	});

	it("reports matched servers without document-symbol support", async () => {
		const { filePath, projectRoot, tool } = await setup();
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("fake does not support document symbols");
	});

	it("returns trust guidance without starting a server for an untrusted root", async () => {
		const { filePath, projectRoot, session, tool } = await setup({ trusted: false });
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("pi-lsp-onread trust add");
		expect(session.pool.size).toBe(0);
	});

	it("states explicitly when no server matches the file", async () => {
		const { filePath, projectRoot, session, tool } = await setup();
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		session.configResult.config.lsp.fake!.extensions = [".rs"];
		const output = await execute(tool, filePath, projectRoot);
		expect(output).toContain("No language servers match this file.");
		expect(session.pool.size).toBe(0);
	});

	it("keeps output within the 8000-character limit", async () => {
		const { filePath, projectRoot, tool } = await setup({ documentSymbols: true });
		await writeFile(filePath, Array.from({ length: 500 }, (_, index) => `function symbol${index}() {}`).join("\n"));
		const output = await execute(tool, filePath, projectRoot);
		expect(output.length).toBeLessThanOrEqual(8000);
	});
});
