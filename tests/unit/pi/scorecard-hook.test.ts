import { describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { DiagnosticsStore } from "../../../src/diagnostics/store.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

type Handler = (event: unknown, ctx: { cwd: string }) => unknown;
function fakePiApi() {
	const handlers = new Map<string, Handler[]>();
	const entries: unknown[] = [];
	const renderers = new Map<string, unknown>();
	return {
		handlers, entries, renderers,
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
			return () => {};
		},
		appendEntry: (entry: unknown) => entries.push(entry),
		registerEntryRenderer: (type: string, renderer: unknown) => renderers.set(type, renderer),
	};
}

function mockSession(scorecard: boolean) {
	const diagnostics = new DiagnosticsStore();
	const uri = "file:///project/a.ts";
	const previous: Snapshot = { serverId: "ts", uri, version: 0, receivedAt: 0, items: [] };
	const current: Snapshot = { ...previous, version: 1, items: [] };
	diagnostics.record(previous);
	diagnostics.record(current);
	return {
		configResult: { ok: true, config: { version: 1, scorecard, lsp: { ts: { command: ["ts"], extensions: [".ts"], languageId: "typescript" } }, diagnostics: { onRead: "cached", onChange: "wait", waitMs: 0, severities: ["error"], maxItems: 10, maxChars: 4000 } } },
		trustResult: { ok: false, errors: ["not trusted"] }, diagnostics, projectRoot: "/project",
		pool: new Map(), dispose: vi.fn(async () => {}),
	};
}

describe("scorecard extension hook", () => {
	it("registers agent_settled once and appends one non-looping entry after edit activity", async () => {
		const pi = fakePiApi();
		const session = mockSession(true);
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		expect(pi.handlers.get("agent_settled")).toHaveLength(1);
		const resultHandler = pi.handlers.get("tool_result")![0]!;
		await resultHandler({ toolName: "edit", input: { path: "a.ts" }, content: [], isError: false }, { cwd: "/project" });
		const settled = await pi.handlers.get("agent_settled")![0]!({}, { cwd: "/project" });
		expect(settled).toBeUndefined();
		expect(pi.entries).toHaveLength(1);
		expect(pi.entries[0]).toMatchObject({ customType: "lsp-scorecard" });
		await pi.handlers.get("agent_settled")![0]!({}, { cwd: "/project" });
		expect(pi.entries).toHaveLength(1);
		expect(pi.renderers.has("lsp-scorecard")).toBe(true);
	});

	it("excludes read activity", async () => {
		const pi = fakePiApi();
		const session = mockSession(true);
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		await pi.handlers.get("tool_result")![0]!({ toolName: "read", input: { path: "a.ts" }, content: [], isError: false }, { cwd: "/project" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		await pi.handlers.get("agent_settled")![0]!({}, { cwd: "/project" });
		expect(pi.entries).toHaveLength(0);
	});

	it.each(["disabled", "disposed", "no edit activity"])("does not append when %s", async (scenario) => {
		const pi = fakePiApi();
		const session = mockSession(scenario !== "disabled");
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		if (scenario === "disposed") await pi.handlers.get("session_shutdown")![0]!({}, { cwd: "/project" });
		await pi.handlers.get("agent_settled")![0]!({}, { cwd: "/project" });
		expect(pi.entries).toHaveLength(0);
	});
});
