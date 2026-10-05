import { describe, expect, it, vi } from "vitest";
import { createExtension } from "../../../src/extension.js";
import { DiagnosticsStore } from "../../../src/diagnostics/store.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

type Handler = (event: unknown, ctx: { cwd: string }) => unknown;
function fakePi() {
	const handlers = new Map<string, Handler[]>();
	return { handlers, on(name: string, handler: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); return () => {}; } };
}
function mockSession(preflight: string, throwOnGet = false, snapshotVersion = 1, clientVersion: number | null = 1, severity = 1) {
	const uri = "file:///project/a.ts";
	const diagnostics = new DiagnosticsStore();
	diagnostics.record({ serverId: "ts", uri, version: snapshotVersion, receivedAt: 0, items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity, message: "before edit" }] } satisfies Snapshot);
	const client = { documents: { version: () => clientVersion === null ? undefined : clientVersion } };
	return {
		configResult: { ok: true, config: { version: 1, preflight, lsp: { ts: { command: ["ts"], extensions: [".ts"], languageId: "typescript" } }, diagnostics: { onRead: "cached", onChange: "wait", waitMs: 0, severities: ["error"], maxItems: 10, maxChars: 4000 } } },
		trustResult: { ok: false, errors: ["not trusted"] }, diagnostics, projectRoot: "/project", pool: new Map([["ts::/project", client]]),
		getPoolKey: (serverId: string, root: string) => `${serverId}::${root}`,
		getOrCreateClient: vi.fn(), clock: () => 0, fsReadFile: vi.fn(async () => ""), dispose: vi.fn(async () => {}),
		...(throwOnGet ? { diagnostics: { get() { throw new Error("store failed"); }, baseline: () => undefined, record() {}, entries: () => [] } } : {}),
	};
}
async function startedExtension(mode: string, throwOnGet = false) {
	const pi = fakePi();
	const session = mockSession(mode, throwOnGet);
	const logError = vi.fn();
	const createSession = vi.fn(async () => session as never);
	createExtension({ createSession, logError })(pi as never);
	await pi.handlers.get("session_start")![0]!({}, { cwd: "/project" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	return { pi, session, createSession, logError };
}

describe("preflight tool_call hook", () => {
	it("registers one handler and blocks only with fresh errors without mutating input", async () => {
		const { pi } = await startedExtension("block");
		expect(pi.handlers.get("tool_call")).toHaveLength(1);
		const input = { path: "a.ts" };
		const outcome = await pi.handlers.get("tool_call")![0]!({ toolName: "edit", input }, { cwd: "/project" });
		expect(outcome).toMatchObject({ block: true, reason: expect.stringContaining("before edit") });
		expect(input).toEqual({ path: "a.ts" });
	});

	it("surfaces an advisory after edit result and ignores off/no-session", async () => {
		const { pi: active, session: advisorySession } = await startedExtension("advisory");
		delete (advisorySession.configResult as unknown as { config: { preflight?: string } }).config.preflight;
		await active.handlers.get("tool_call")![0]!({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" });
		const result = await active.handlers.get("tool_result")![0]!({ toolName: "edit", input: { path: "a.ts" }, content: [], isError: false }, { cwd: "/project" });
		expect(JSON.stringify(result)).toContain("1 error(s) pre-existed before this edit");
		const { pi: off } = await startedExtension("off");
		expect(await off.handlers.get("tool_call")![0]!({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" })).toBeUndefined();
		const fresh = fakePi();
		createExtension({ createSession: vi.fn(async () => mockSession("block") as never) })(fresh as never);
		expect(await fresh.handlers.get("tool_call")![0]!({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" })).toBeUndefined();
	});

	it.each([
		["stale", 0, 1, 1],
		["unknown live version", 1, null, 1],
		["non-error diagnostic", 1, 1, 2],
	])("fails open and emits no advisory for %s", async (_label, snapshotVersion, clientVersion, severity) => {
		const pi = fakePi();
		const session = mockSession("advisory", false, snapshotVersion as number, clientVersion as number | null, severity as number);
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		await pi.handlers.get("session_start")![0]!({}, { cwd: "/project" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		const input = { path: "a.ts" };
		expect(await pi.handlers.get("tool_call")![0]!({ toolName: "edit", input }, { cwd: "/project" })).toBeUndefined();
		expect(input).toEqual({ path: "a.ts" });
		const result = await pi.handlers.get("tool_result")![0]!({ toolName: "edit", input, content: [], isError: false }, { cwd: "/project" });
		expect(JSON.stringify(result)).not.toContain("pre-existed before this edit");
	});

	it("fails open for stale evidence in block mode", async () => {
		const pi = fakePi();
		const session = mockSession("block", false, 0, 1);
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		await pi.handlers.get("session_start")![0]!({}, { cwd: "/project" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(await pi.handlers.get("tool_call")![0]!({ toolName: "write", input: { path: "a.ts" } }, { cwd: "/project" })).toBeUndefined();
	});

	it("ignores non-edit tools, non-string paths, and unmatched files", async () => {
		const { pi } = await startedExtension("block");
		const hook = pi.handlers.get("tool_call")![0]!;
		for (const event of [
			{ toolName: "read", input: { path: "a.ts" } },
			{ toolName: "edit", input: { path: 42 } },
			{ toolName: "edit", input: { path: "README.md" } },
		]) expect(await hook(event, { cwd: "/project" })).toBeUndefined();
	});

	it("never throws when the store fails", async () => {
		const { pi, logError } = await startedExtension("block", true);
		await expect(pi.handlers.get("tool_call")![0]!({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" })).resolves.toBeUndefined();
		expect(logError).toHaveBeenCalled();
	});

	it("drops a stashed note when a later edit of the same path is no longer erroring", async () => {
		const pi = fakePi();
		const uri = "file:///project/a.ts";
		const diagnostics = new DiagnosticsStore();
		const recordAt = (version: number, severity: number) => diagnostics.record({ serverId: "ts", uri, version, receivedAt: version, items: severity === 0 ? [] : [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity, message: "before edit" }] } satisfies Snapshot);
		recordAt(1, 1);
		let liveVersion = 1;
		const session = {
			configResult: { ok: true, config: { version: 1, preflight: "advisory", lsp: { ts: { command: ["ts"], extensions: [".ts"], languageId: "typescript" } }, diagnostics: { onRead: "cached", onChange: "wait", waitMs: 0, severities: ["error"], maxItems: 10, maxChars: 4000 } } },
			trustResult: { ok: false, errors: ["not trusted"] }, diagnostics, projectRoot: "/project",
			pool: new Map([["ts::/project", { documents: { version: () => liveVersion } }]]),
		};
		createExtension({ createSession: vi.fn(async () => session as never) })(pi as never);
		await pi.handlers.get("session_start")![0]!({}, { cwd: "/project" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		const call = pi.handlers.get("tool_call")![0]!;
		const result = pi.handlers.get("tool_result")![0]!;
		await call({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" });
		await result({ toolName: "edit", input: { path: "a.ts" }, content: [], isError: true }, { cwd: "/project" });
		recordAt(2, 0);
		liveVersion = 2;
		await call({ toolName: "edit", input: { path: "a.ts" } }, { cwd: "/project" });
		const second = await result({ toolName: "edit", input: { path: "a.ts" }, content: [], isError: false }, { cwd: "/project" });
		expect(JSON.stringify(second)).not.toContain("pre-existed before this edit");
	});
});
