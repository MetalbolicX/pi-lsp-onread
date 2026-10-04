import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSession } from "../../../src/runtime/session.js";
import type { LspClient } from "../../../src/lsp/client.js";
import { fakeConfig } from "./runtime-test-helpers.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
	const projectRoot = await mkdtemp(join(tmpdir(), "pi-lsp-session-"));
	directories.push(projectRoot);
	const trustStorePath = join(projectRoot, "trust.json");
	await writeFile(trustStorePath, JSON.stringify({ version: 1, trustedRoots: [projectRoot] }));
	return { projectRoot, trustStorePath };
}

describe("RuntimeSession", () => {
	async function sessionWithPullResponse(value: unknown) {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = {
			capabilities: () => ({ diagnosticProvider: {} }),
			request: async () => ({ ok: true, value }),
			documents: { version: () => 7 },
		} as unknown as LspClient;
		return { session, client };
	}

	it.each([
		["missing items", { kind: "full", resultId: "next" }],
		["non-array items", { kind: "full", resultId: "next", items: {} }],
	])("rejects malformed full reports with %s without changing state", async (_label, report) => {
		const { session, client } = await sessionWithPullResponse(report);
		try {
			session.pullState.set("fake", "file:///test.ts", "previous");
			expect(await session.pullFresh("fake", "file:///test.ts", 1000, client)).toBe("failed");
			expect(session.diagnostics.has("fake", "file:///test.ts")).toBe(false);
			expect(session.pullState.get("fake", "file:///test.ts")).toBe("previous");
		} finally {
			await session.dispose();
		}
	});

	it("rejects unchanged reports without a string resultId without changing pull state", async () => {
		const { session, client } = await sessionWithPullResponse({ kind: "unchanged", resultId: 42 });
		try {
			session.pullState.set("fake", "file:///test.ts", "previous");
			expect(await session.pullFresh("fake", "file:///test.ts", 1000, client)).toBe("failed");
			expect(session.pullState.get("fake", "file:///test.ts")).toBe("previous");
		} finally {
			await session.dispose();
		}
	});

	it("records only valid items from a full report", async () => {
		const validItem = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "valid" };
		const { session, client } = await sessionWithPullResponse({ kind: "full", items: [null, validItem] });
		try {
			expect(await session.pullFresh("fake", "file:///test.ts", 1000, client)).toBe("full");
			expect(session.diagnostics.get("fake", "file:///test.ts")?.items).toEqual([
				{ ...validItem, severity: 1 },
			]);
		} finally {
			await session.dispose();
		}
	});

	it("accepts a full report without resultId without changing pull state", async () => {
		const { session, client } = await sessionWithPullResponse({ kind: "full", items: [] });
		try {
			session.pullState.set("fake", "file:///test.ts", "previous");
			expect(await session.pullFresh("fake", "file:///test.ts", 1000, client)).toBe("full");
			expect(session.pullState.get("fake", "file:///test.ts")).toBe("previous");
		} finally {
			await session.dispose();
		}
	});
	it("pulls workspace diagnostics for multiple documents and preserves unchanged snapshots", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig({ workspaceDiagnostics: true }), projectRoot, trustStorePath });
		try {
			const config = session.configResult;
			if (!config.ok || config.config.lsp === false) throw new Error("Expected LSP config");
			const server = config.config.lsp.fake!;
			const result = await session.getOrCreateClient(session.getPoolKey("fake", projectRoot), {
				serverId: "fake", server, root: projectRoot, projectRoot,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.message);
			const firstUri = "file:///workspace-first.ts";
			const secondUri = "file:///workspace-second.ts";
			await result.client.ensure();
			await result.client.documents.open(firstUri, "typescript", "error: first");
			await result.client.documents.open(secondUri, "typescript", "error: second");
			expect(await session.pullWorkspace("fake", 1000, result.client)).toBe("applied");
			const secondSnapshot = session.diagnostics.get("fake", secondUri);
			expect(secondSnapshot?.items[0]?.message).toBe("error: second");
			const resultId = session.pullState.get("fake", secondUri);
			expect(typeof resultId).toBe("string");
			expect(await session.pullWorkspace("fake", 1000, result.client)).toBe("applied");
			expect(session.diagnostics.get("fake", secondUri)).toBe(secondSnapshot);
			expect(session.pullState.get("fake", secondUri)).toBe(resultId);
		} finally {
			await session.dispose();
		}
	});

	it("does not request a workspace pull when workspace diagnostics are unsupported", async () => {
		const { session, client } = await sessionWithPullResponse({ items: [] });
		let requested = false;
		const incapable = {
			...client,
			capabilities: () => ({ diagnosticProvider: { workspaceDiagnostics: false } }),
			request: async () => { requested = true; return { ok: true, value: { items: [] } }; },
		} as unknown as LspClient;
		try {
			expect(await session.pullWorkspace("fake", 1000, incapable)).toBe("unsupported");
			expect(requested).toBe(false);
		} finally {
			await session.dispose();
		}
	});

	it("rejects a non-array workspace items response", async () => {
		const { session, client } = await sessionWithPullResponse({ items: {} });
		const workspaceClient = { ...client, capabilities: () => ({ diagnosticProvider: { workspaceDiagnostics: true } }) } as unknown as LspClient;
		try {
			expect(await session.pullWorkspace("fake", 1000, workspaceClient)).toBe("failed");
		} finally { await session.dispose(); }
	});

	it("skips malformed workspace entries while applying valid entries individually", async () => {
		const { session, client } = await sessionWithPullResponse({ items: [
			{ uri: 42, kind: "full", items: [] },
			{ uri: "file:///bad-kind.ts", kind: "partial", items: [] },
			{ uri: "file:///missing-items.ts", kind: "full" },
			{ uri: "file:///missing-result.ts", kind: "unchanged" },
			{ uri: "file:///valid.ts", kind: "full", resultId: "valid-id", items: [] },
			{ uri: "file:///also-valid.ts", kind: "unchanged", resultId: "next-id" },
		] });
		const workspaceClient = { ...client, capabilities: () => ({ diagnosticProvider: { workspaceDiagnostics: true } }) } as unknown as LspClient;
		try {
			const unchangedSnapshot = { serverId: "fake", uri: "file:///also-valid.ts", version: null, receivedAt: 1, items: [] };
			session.diagnostics.record(unchangedSnapshot);
			session.pullState.set("fake", "file:///also-valid.ts", "old-id");
			session.pullState.set("fake", "file:///missing-result.ts", "old");
			expect(await session.pullWorkspace("fake", 1000, workspaceClient)).toBe("applied");
			expect(session.diagnostics.has("fake", "file:///valid.ts")).toBe(true);
			expect(session.pullState.get("fake", "file:///valid.ts")).toBe("valid-id");
			expect(session.pullState.get("fake", "file:///also-valid.ts")).toBe("next-id");
			expect(session.diagnostics.get("fake", "file:///also-valid.ts")).toBe(unchangedSnapshot);
			expect(session.pullState.get("fake", "file:///missing-result.ts")).toBe("old");
			expect(session.diagnostics.entries().some((snapshot) => snapshot.uri === "file:///bad-kind.ts")).toBe(false);
		} finally { await session.dispose(); }
	});

	it("returns failed without throwing when a workspace pull times out", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const config = fakeConfig({ workspaceDiagnostics: true });
		if (config.lsp === false) throw new Error("Expected LSP config");
		config.lsp.fake!.env = { ...config.lsp.fake!.env, FAKE_HANG_METHOD: "workspace/diagnostic" };
		const session = await RuntimeSession.create({ config, projectRoot, trustStorePath });
		try {
			const server = session.configResult.ok && session.configResult.config.lsp !== false ? session.configResult.config.lsp.fake! : undefined;
			if (!server) throw new Error("Expected fake server configuration");
			const result = await session.getOrCreateClient(session.getPoolKey("fake", projectRoot), { serverId: "fake", server, root: projectRoot, projectRoot });
			if (!result.ok) throw new Error(result.message);
			await result.client.ensure();
			const started = Date.now();
			expect(await session.pullWorkspace("fake", 30, result.client)).toBe("failed");
			expect(Date.now() - started).toBeLessThan(1000);
		} finally { await session.dispose(); }
	});

	it("returns changed snapshots at or after the timestamp in uri then server order", async () => {
		const { projectRoot, trustStorePath } = await setup();
		let now = 10;
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath, clock: () => now });
		const makeSnapshot = (serverId: string, uri: string) => ({ serverId, uri, version: null, receivedAt: now, items: [] });
		try {
			session.diagnostics.record(makeSnapshot("zeta", "file:///b.ts"));
			now = 20;
			session.diagnostics.record(makeSnapshot("alpha", "file:///a.ts"));
			session.diagnostics.record(makeSnapshot("beta", "file:///a.ts"));
			const before = session.diagnostics.entries();
			const changed = session.changedSince(20);
			expect(changed).toEqual([
				{ serverId: "alpha", uri: "file:///a.ts", receivedAt: 20 },
				{ serverId: "beta", uri: "file:///a.ts", receivedAt: 20 },
			]);
			expect(session.diagnostics.entries()).toEqual(before);
		} finally { await session.dispose(); }
	});

	it("returns document symbols from a valid array response and passes the request params", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const symbols = [{ name: "alpha", kind: 12 }, { name: "beta", kind: 13 }];
		let requestArgs: unknown[] = [];
		const client = {
			capabilities: () => ({ documentSymbolProvider: true }),
			request: async (...args: unknown[]) => { requestArgs = args; return { ok: true, value: symbols }; },
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.documentSymbols("fake", "file:///symbols.ts", 1234, client)).toEqual({ outcome: "ok", symbols });
			expect(requestArgs).toEqual([
				"textDocument/documentSymbol",
				{ textDocument: { uri: "file:///symbols.ts" } },
				1234,
			]);
		} finally { await session.dispose(); }
	});

	it("caps document symbols at 1000 entries", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const symbols = Array.from({ length: 1001 }, (_, index) => ({ name: `symbol-${index}` }));
		const client = {
			capabilities: () => ({ documentSymbolProvider: true }),
			request: async () => ({ ok: true, value: symbols }),
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			const result = await session.documentSymbols("fake", "file:///symbols.ts", 1000, client);
			expect(result.outcome).toBe("ok");
			expect(result.symbols).toHaveLength(1000);
			expect(result.symbols[999]).toEqual(symbols[999]);
		} finally { await session.dispose(); }
	});

	it("returns unsupported when document symbols are unavailable or no client resolves", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = {
			capabilities: () => ({}),
			request: async () => ({ ok: true, value: [] }),
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.documentSymbols("fake", "file:///symbols.ts", 1000, client)).toEqual({ outcome: "unsupported", symbols: [] });
			expect(await session.documentSymbols("missing", "file:///symbols.ts")).toEqual({ outcome: "unsupported", symbols: [] });
		} finally { await session.dispose(); }
	});

	it.each([
		["request errors", async () => { throw new Error("request failed"); }],
		["request times out", async () => { throw new Error("Request timed out"); }],
		["request returns not-ok", async () => ({ ok: false })],
		["response value is not an array", async () => ({ ok: true, value: { symbols: [] } })],
		["response value is missing", async () => ({ ok: true })],
	])("returns failed when document-symbol %s", async (_label, response) => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = {
			capabilities: () => ({ documentSymbolProvider: true }),
			request: response,
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.documentSymbols("fake", "file:///symbols.ts", 1000, client)).toEqual({ outcome: "failed", symbols: [] });
		} finally { await session.dispose(); }
	});

	it("returns failed for a non-positive document-symbol timeout", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		let requested = false;
		const client = {
			capabilities: () => ({ documentSymbolProvider: true }),
			request: async () => { requested = true; return { ok: true, value: [] }; },
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.documentSymbols("fake", "file:///symbols.ts", 0, client)).toEqual({ outcome: "failed", symbols: [] });
			expect(requested).toBe(false);
		} finally { await session.dispose(); }
	});

	it("loads its trust store once and exposes deterministic pool keys", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		try {
			expect(session.trustStore).toEqual({ version: 1, trustedRoots: [projectRoot] });
			expect(session.getPoolKey("fake", projectRoot)).toBe(`fake::${projectRoot}`);
			expect(session.getServerIds()).toEqual([]);
		} finally {
			await session.dispose();
		}
	});

	it("continues disposing pooled clients when one disposal rejects", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const disposed: string[] = [];
		session.pool.set("first", { dispose: async () => { disposed.push("first"); throw new Error("failed"); } } as unknown as LspClient);
		session.pool.set("second", { dispose: async () => { disposed.push("second"); } } as unknown as LspClient);
		await expect(session.dispose()).resolves.toBeUndefined();
		expect(disposed).toEqual(["first", "second"]);
	});

	it("retains config errors as a typed inactive condition", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: { ok: false, errors: ["invalid"] }, projectRoot, trustStorePath });
		try {
			expect(session.configResult).toEqual({ ok: false, errors: ["invalid"] });
		} finally {
			await session.dispose();
		}
	});
});
