import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createExtension } from "../../../src/extension.js";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { createProject, fakeConfig, removeProject } from "../runtime/runtime-test-helpers.js";

type Tool = {
	name: string;
	label?: string;
	description?: string;
	parameters: unknown;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
	execute: (id: string, params: { path: string; line: number; character: number; includeDeclaration?: boolean }, signal?: AbortSignal, update?: unknown, ctx?: { cwd: string }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
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

async function setup(options: { trusted?: boolean; navigation?: boolean } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({
		config: fakeConfig({ navigation: options.navigation }),
		projectRoot: project.projectRoot,
		trustStorePath: project.trustStorePath,
	});
	sessions.push(session);
	const pi = fakePiApi();
	const createSession = vi.fn(async () => session);
	createExtension({ createSession: createSession as never })(pi as never);
	return {
		...project,
		session,
		createSession,
		definition: pi.tools.get("lsp_definition"),
		references: pi.tools.get("lsp_references"),
	};
}

async function execute(tool: Tool | undefined, path: string, line: number, character: number, cwd: string, includeDeclaration?: boolean) {
	if (!tool) throw new Error("navigation tool was not registered");
	const result = await tool.execute("call-1", { path, line, character, ...(includeDeclaration === undefined ? {} : { includeDeclaration }) }, undefined, undefined, { cwd });
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("LSP navigation tools", () => {
	it("registers both tools with read-only intent and position schemas", async () => {
		const { definition, references } = await setup();
		for (const tool of [definition, references]) {
			expect(tool).toBeDefined();
			if (!tool) throw new Error("Expected navigation tool to be registered");
			expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
			const schema = tool.parameters as { properties: Record<string, { type: string; minimum?: number }>; required: string[] };
			expect(schema.properties.line).toEqual({ type: "integer", minimum: 1 });
			expect(schema.properties.character).toEqual({ type: "integer", minimum: 1 });
			expect(schema.required).toContain("line");
			expect(schema.required).toContain("character");
		}
		if (!references) throw new Error("Expected references tool to be registered");
		expect((references.parameters as { properties: Record<string, unknown> }).properties.includeDeclaration).toEqual({ type: "boolean" });
	});

	it("returns definition with decoded path, 1-based coordinates, and coverage", async () => {
		const { filePath, projectRoot, session, definition } = await setup({ navigation: true });
		await writeFile(filePath, "first line\nsecond line\n");
		const definitionRequest = vi.spyOn(session, "definition");
		definitionRequest.mockResolvedValue({ outcome: "ok", locations: [{ uri: pathToFileURL(filePath).href, range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } } }] });
		const output = await execute(definition, filePath, 2, 4, projectRoot);
		expect(output).toContain("coverage: 1 server(s) queried for this position;");
		expect(output).toContain(filePath);
		expect(output).toContain(`${filePath}:2:4-2:4`);
	});

	it("reports an honest empty definition for an out-of-range line", async () => {
		const { filePath, projectRoot, definition } = await setup({ navigation: true });
		await writeFile(filePath, "one line\n");
		expect(await execute(definition, filePath, 3, 1, projectRoot)).toContain("No definition found at this position.");
	});

	it("returns references for every document line and forwards includeDeclaration", async () => {
		const { filePath, projectRoot, session, references } = await setup({ navigation: true });
		await writeFile(filePath, "alpha\nbeta\ngamma\n");
		const referenceRequest = vi.spyOn(session, "references");
		referenceRequest.mockResolvedValue({ outcome: "ok", locations: [
			{ uri: pathToFileURL(filePath).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
			{ uri: pathToFileURL(filePath).href, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } },
			{ uri: pathToFileURL(filePath).href, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } } },
		] });
		const output = await execute(references, filePath, 1, 1, projectRoot, true);
		expect(output).toContain(`${filePath}:1:1-1:6`);
		expect(output).toContain(`${filePath}:2:1-2:5`);
		expect(output).toContain(`${filePath}:3:1-3:6`);
		expect(referenceRequest).toHaveBeenCalledWith("fake", expect.any(String), 0, 0, true, 5000, expect.anything());
	});

	it("reports unsupported navigation providers", async () => {
		const { filePath, projectRoot, definition } = await setup();
		expect(await execute(definition, filePath, 1, 1, projectRoot)).toContain("fake does not support definition");
	});

	it.each([[0, 1], [1, 1.5]])("rejects invalid position %s:%s", async (line, character) => {
		const { filePath, projectRoot, session, definition } = await setup({ navigation: true });
		const definitionRequest = vi.spyOn(session, "definition");
		const output = await execute(definition, filePath, line, character, projectRoot);
		expect(output).toBe("line and character must be positive integers (1-based).");
		expect(definitionRequest).not.toHaveBeenCalled();
	});

	it("returns trust guidance without starting a server for an untrusted root", async () => {
		const { filePath, projectRoot, session, definition } = await setup({ trusted: false, navigation: true });
		const output = await execute(definition, filePath, 1, 1, projectRoot);
		expect(output).toContain("pi-lsp-onread trust add");
		expect(session.pool.size).toBe(0);
	});

	it("states explicitly when no server matches the file", async () => {
		const { filePath, projectRoot, session, references } = await setup({ navigation: true });
		if (!session.configResult.ok || session.configResult.config.lsp === false) throw new Error("Expected LSP config");
		session.configResult.config.lsp.fake!.extensions = [".rs"];
		const output = await execute(references, filePath, 1, 1, projectRoot);
		expect(output).toContain("No language servers match this file.");
		expect(session.pool.size).toBe(0);
	});

	it("keeps output within the 8000-character limit", async () => {
		const { filePath, projectRoot, references } = await setup({ navigation: true });
		await writeFile(filePath, Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n"));
		const output = await execute(references, filePath, 1, 1, projectRoot);
		expect(output.length).toBeLessThanOrEqual(8000);
	});
});
