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

	it("returns workspace symbols and passes the exact query string to the request", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const symbols = [{ name: "alpha", kind: 12 }, { name: "beta", kind: 13 }];
		let requestArgs: unknown[] = [];
		const client = {
			capabilities: () => ({ workspaceSymbolProvider: true }),
			request: async (...args: unknown[]) => { requestArgs = args; return { ok: true, value: symbols }; },
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.workspaceSymbols("fake", "", 1234, client)).toEqual({ outcome: "ok", symbols });
			expect(requestArgs).toEqual(["workspace/symbol", { query: "" }, 1234]);
		} finally { await session.dispose(); }
	});

	it("caps workspace symbols at 1000 entries", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const symbols = Array.from({ length: 1001 }, (_, index) => ({ name: `symbol-${index}` }));
		const client = {
			capabilities: () => ({ workspaceSymbolProvider: true }),
			request: async () => ({ ok: true, value: symbols }),
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			const result = await session.workspaceSymbols("fake", "symbol", 1000, client);
			expect(result.outcome).toBe("ok");
			expect(result.symbols).toHaveLength(1000);
			expect(result.symbols[999]).toEqual(symbols[999]);
		} finally { await session.dispose(); }
	});

	it("returns unsupported when workspace symbols are unavailable or no client resolves", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = {
			capabilities: () => ({}),
			request: async () => ({ ok: true, value: [] }),
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.workspaceSymbols("fake", "", 1000, client)).toEqual({ outcome: "unsupported", symbols: [] });
			expect(await session.workspaceSymbols("missing", "")).toEqual({ outcome: "unsupported", symbols: [] });
		} finally { await session.dispose(); }
	});

	it.each([
		["request errors", async () => { throw new Error("request failed"); }],
		["request times out", async () => { throw new Error("Request timed out"); }],
		["request returns not-ok", async () => ({ ok: false })],
		["response value is not an array", async () => ({ ok: true, value: { symbols: [] } })],
		["response value is missing", async () => ({ ok: true })],
	])("returns failed when workspace-symbol %s", async (_label, response) => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = {
			capabilities: () => ({ workspaceSymbolProvider: true }),
			request: response,
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.workspaceSymbols("fake", "query", 1000, client)).toEqual({ outcome: "failed", symbols: [] });
		} finally { await session.dispose(); }
	});

	it("returns failed for a non-positive workspace-symbol timeout", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		let requested = false;
		const client = {
			capabilities: () => ({ workspaceSymbolProvider: true }),
			request: async () => { requested = true; return { ok: true, value: [] }; },
			documents: { version: () => undefined },
		} as unknown as LspClient;
		try {
			expect(await session.workspaceSymbols("fake", "query", 0, client)).toEqual({ outcome: "failed", symbols: [] });
			expect(requested).toBe(false);
		} finally { await session.dispose(); }
	});

	describe.each([
		{
			name: "definition",
			capability: "definitionProvider",
			method: "textDocument/definition",
			invoke: (session: RuntimeSession, client: LspClient, timeoutMs = 1234) => session.definition("fake", "file:///target.ts", -2, 19, timeoutMs, client),
			params: { textDocument: { uri: "file:///target.ts" }, position: { line: -2, character: 19 } },
		},
		{
			name: "references",
			capability: "referencesProvider",
			method: "textDocument/references",
			invoke: (session: RuntimeSession, client: LspClient, timeoutMs = 1234, includeDeclaration = true) => session.references("fake", "file:///target.ts", -2, 19, includeDeclaration, timeoutMs, client),
			params: { textDocument: { uri: "file:///target.ts" }, position: { line: -2, character: 19 }, context: { includeDeclaration: true } },
		},
	])("$name requests", ({ name, capability, method, invoke, params }) => {
		async function setupRequest(value: unknown, requestOk = true) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			let args: unknown[] = [];
			const client = {
				capabilities: () => ({ [capability]: true }),
				request: async (...requestArgs: unknown[]) => { args = requestArgs; return requestOk ? { ok: true, value } : { ok: false }; },
				documents: { version: () => undefined },
			} as unknown as LspClient;
			return { session, client, getArgs: () => args };
		}

		it("returns array results and sends exact request params", async () => {
			const locations = [{ uri: "file:///a.ts" }, { uri: "file:///b.ts" }];
			const { session, client, getArgs } = await setupRequest(locations);
			try {
				expect(await invoke(session, client)).toEqual({ outcome: "ok", locations });
				expect(getArgs()).toEqual([method, params, 1234]);
			} finally { await session.dispose(); }
		});

		it("treats null results as an empty successful answer", async () => {
			const { session, client } = await setupRequest(null);
			try { expect(await invoke(session, client)).toEqual({ outcome: "ok", locations: [] }); }
			finally { await session.dispose(); }
		});

		it("returns unsupported without capability or a resolved client", async () => {
			const { session, client } = await setupRequest([]);
			const incapable = { ...client, capabilities: () => ({}) } as unknown as LspClient;
			try {
				expect(await invoke(session, incapable)).toEqual({ outcome: "unsupported", locations: [] });
				const unresolved = name === "definition"
					? await session.definition("missing", "file:///target.ts", -2, 19)
					: await session.references("missing", "file:///target.ts", -2, 19, true);
				expect(unresolved).toEqual({ outcome: "unsupported", locations: [] });
			} finally { await session.dispose(); }
		});

		it.each([
			["request errors", async () => { throw new Error("request failed"); }],
			["request timeouts", async () => { throw new Error("timed out"); }],
			["not-ok responses", async () => ({ ok: false })],
		])("fails on %s without throwing", async (_label, request) => {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			const client = { capabilities: () => ({ [capability]: true }), request, documents: { version: () => undefined } } as unknown as LspClient;
			try { expect(await invoke(session, client)).toEqual({ outcome: "failed", locations: [] }); }
			finally { await session.dispose(); }
		});

		it("fails before requesting when timeout is non-positive", async () => {
			const { session, client, getArgs } = await setupRequest([]);
			try {
				expect(await invoke(session, client, 0)).toEqual({ outcome: "failed", locations: [] });
				expect(getArgs()).toEqual([]);
			} finally { await session.dispose(); }
		});

		it("caps valid arrays at 1000 entries", async () => {
			const locations = Array.from({ length: 1001 }, (_, index) => ({ index }));
			const { session, client } = await setupRequest(locations);
			try {
				const result = await invoke(session, client);
				expect(result.outcome).toBe("ok");
				expect(result.locations).toHaveLength(1000);
				expect(result.locations[999]).toEqual(locations[999]);
			} finally { await session.dispose(); }
		});
	});

	it("wraps a single definition location object and rejects primitive results", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const location = { uri: "file:///definition.ts" };
		const client = { capabilities: () => ({ definitionProvider: true }), request: async () => ({ ok: true, value: location }), documents: { version: () => undefined } } as unknown as LspClient;
		try {
			expect(await session.definition("fake", "file:///target.ts", 0, 0, 1000, client)).toEqual({ outcome: "ok", locations: [location] });
			const primitive = { ...client, request: async () => ({ ok: true, value: 42 }) } as unknown as LspClient;
			expect(await session.definition("fake", "file:///target.ts", 0, 0, 1000, primitive)).toEqual({ outcome: "failed", locations: [] });
		} finally { await session.dispose(); }
	});

	it.each([true, false])("passes references includeDeclaration=%s exactly", async (includeDeclaration) => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		let args: unknown[] = [];
		const client = { capabilities: () => ({ referencesProvider: true }), request: async (...received: unknown[]) => { args = received; return { ok: true, value: [] }; }, documents: { version: () => undefined } } as unknown as LspClient;
		try {
			expect(await session.references("fake", "file:///target.ts", -2, 19, includeDeclaration, 1234, client)).toEqual({ outcome: "ok", locations: [] });
			expect(args).toEqual(["textDocument/references", { textDocument: { uri: "file:///target.ts" }, position: { line: -2, character: 19 }, context: { includeDeclaration } }, 1234]);
		} finally { await session.dispose(); }
	});

	it("rejects an object references result", async () => {
		const { projectRoot, trustStorePath } = await setup();
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
		const client = { capabilities: () => ({ referencesProvider: true }), request: async () => ({ ok: true, value: { uri: "file:///reference.ts" } }), documents: { version: () => undefined } } as unknown as LspClient;
		try { expect(await session.references("fake", "file:///target.ts", 0, 0, true, 1000, client)).toEqual({ outcome: "failed", locations: [] }); }
		finally { await session.dispose(); }
	});

	describe("codeActions requests", () => {
		const range = { start: { line: -2, character: 19 }, end: { line: 3, character: -4 } };
		const actions = [{ title: "Fix it", kind: "quickfix" }, { title: "Refactor" }];

		async function setupRequest(value: unknown, requestOk = true) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			let args: unknown[] = [];
			const client = {
				capabilities: () => ({ codeActionProvider: true }),
				request: async (...requestArgs: unknown[]) => { args = requestArgs; return requestOk ? { ok: true, value } : { ok: false }; },
				documents: { version: () => undefined },
			} as unknown as LspClient;
			return { session, client, getArgs: () => args };
		}

		it("returns arrays and passes exact request params", async () => {
			const { session, client, getArgs } = await setupRequest(actions);
			try {
				expect(await session.codeActions("fake", "file:///target.ts", range, 1234, client)).toEqual({ outcome: "ok", actions });
				expect(getArgs()).toEqual(["textDocument/codeAction", { textDocument: { uri: "file:///target.ts" }, range }, 1234]);
			} finally { await session.dispose(); }
		});

		it("treats null and undefined as no actions and caps arrays at 1000", async () => {
			const { session, client } = await setupRequest(null);
			const undefinedClient = { ...client, request: async () => ({ ok: true }) } as unknown as LspClient;
			const manyClient = { ...client, request: async () => ({ ok: true, value: Array.from({ length: 1001 }, (_, index) => index) }) } as unknown as LspClient;
			try {
				expect(await session.codeActions("fake", "file:///target.ts", range, 1000, client)).toEqual({ outcome: "ok", actions: [] });
				expect(await session.codeActions("fake", "file:///target.ts", range, 1000, undefinedClient)).toEqual({ outcome: "ok", actions: [] });
				const capped = await session.codeActions("fake", "file:///target.ts", range, 1000, manyClient);
				expect(capped.outcome).toBe("ok");
				expect(capped.actions).toHaveLength(1000);
				expect(capped.actions[999]).toBe(999);
			} finally { await session.dispose(); }
		});

		it("returns unsupported without capability or a resolved client", async () => {
			const { session, client } = await setupRequest([]);
			const incapable = { ...client, capabilities: () => ({}) } as unknown as LspClient;
			try {
				expect(await session.codeActions("fake", "file:///target.ts", range, 1000, incapable)).toEqual({ outcome: "unsupported", actions: [] });
				expect(await session.codeActions("missing", "file:///target.ts", range)).toEqual({ outcome: "unsupported", actions: [] });
			} finally { await session.dispose(); }
		});

		it.each([
			["request errors", async () => { throw new Error("request failed"); }],
			["timeouts", async () => { throw new Error("timed out"); }],
			["not-ok responses", async () => ({ ok: false })],
			["non-array results", async () => ({ ok: true, value: { title: "not an array" } })],
			["primitive results", async () => ({ ok: true, value: 42 })],
		])("returns failed for %s", async (_label, request) => {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			const client = { capabilities: () => ({ codeActionProvider: true }), request, documents: { version: () => undefined } } as unknown as LspClient;
			try { expect(await session.codeActions("fake", "file:///target.ts", range, 1000, client)).toEqual({ outcome: "failed", actions: [] }); }
			finally { await session.dispose(); }
		});

		it("fails before requesting when timeout is non-positive", async () => {
			const { session, client, getArgs } = await setupRequest(actions);
			try {
				expect(await session.codeActions("fake", "file:///target.ts", range, 0, client)).toEqual({ outcome: "failed", actions: [] });
				expect(getArgs()).toEqual([]);
			} finally { await session.dispose(); }
		});
	});

	describe("resolveCodeAction requests", () => {
		const action = { title: "Fix it", kind: "quickfix", data: { opaque: [1, 2] } };
		const resolved = { ...action, edit: { changes: {} } };

		async function setupRequest(value: unknown, requestOk = true) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			let args: unknown[] = [];
			const client = {
				capabilities: () => ({ codeActionProvider: { resolveProvider: true } }),
				request: async (...requestArgs: unknown[]) => { args = requestArgs; return requestOk ? { ok: true, value } : { ok: false }; },
				documents: { version: () => undefined },
			} as unknown as LspClient;
			return { session, client, getArgs: () => args };
		}

		it("returns an object and passes the exact action params", async () => {
			const { session, client, getArgs } = await setupRequest(resolved);
			try {
				expect(await session.resolveCodeAction("fake", action, 1234, client)).toEqual({ outcome: "ok", action: resolved });
				expect(getArgs()).toEqual(["codeAction/resolve", action, 1234]);
			} finally { await session.dispose(); }
		});

		it("returns unsupported without a client or resolve capability", async () => {
			const { session, client } = await setupRequest(resolved);
			const noResolve = { ...client, capabilities: () => ({ codeActionProvider: { resolveProvider: false } }) } as unknown as LspClient;
			const nonObjectProvider = { ...client, capabilities: () => ({ codeActionProvider: true }) } as unknown as LspClient;
			const nullProvider = { ...client, capabilities: () => ({ codeActionProvider: null }) } as unknown as LspClient;
			try {
				for (const incapable of [noResolve, nonObjectProvider, nullProvider]) {
					expect(await session.resolveCodeAction("fake", action, 1000, incapable)).toEqual({ outcome: "unsupported", action: null });
				}
				expect(await session.resolveCodeAction("missing", action)).toEqual({ outcome: "unsupported", action: null });
			} finally { await session.dispose(); }
		});

		it.each([
			["request errors", async () => { throw new Error("request failed"); }],
			["timeouts", async () => { throw new Error("timed out"); }],
			["not-ok responses", async () => ({ ok: false })],
			["null results", async () => ({ ok: true, value: null })],
			["undefined results", async () => ({ ok: true })],
			["primitive results", async () => ({ ok: true, value: 42 })],
			["array results", async () => ({ ok: true, value: [] })],
		])("returns failed for %s", async (_label, request) => {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			const client = { capabilities: () => ({ codeActionProvider: { resolveProvider: true } }), request, documents: { version: () => undefined } } as unknown as LspClient;
			try { expect(await session.resolveCodeAction("fake", action, 1000, client)).toEqual({ outcome: "failed", action: null }); }
			finally { await session.dispose(); }
		});

		it("fails before requesting when timeout is non-positive", async () => {
			const { session, client, getArgs } = await setupRequest(resolved);
			try {
				expect(await session.resolveCodeAction("fake", action, 0, client)).toEqual({ outcome: "failed", action: null });
				expect(getArgs()).toEqual([]);
			} finally { await session.dispose(); }
		});
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

	describe("hover requests", () => {
		async function makeSession(capabilities: Record<string, unknown>, request: (...args: unknown[]) => Promise<unknown>) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			const client = { capabilities: () => capabilities, request, documents: { version: () => undefined } } as unknown as LspClient;
			return { session, client };
		}
		it("passes hover payload and exact position", async () => {
			let args: unknown[] = [];
			const hover = { contents: "details" };
			const { session, client } = await makeSession({ hoverProvider: { workDoneProgress: true } }, async (...received) => { args = received; return { ok: true, value: hover }; });
			try {
				expect(await session.hover("fake", "file:///x.ts", 2, 4, 1234, client)).toEqual({ outcome: "ok", hover });
				expect(args).toEqual(["textDocument/hover", { textDocument: { uri: "file:///x.ts" }, position: { line: 2, character: 4 } }, 1234]);
			} finally { await session.dispose(); }
		});
		it("treats null as no hover", async () => {
			const { session, client } = await makeSession({ hoverProvider: true }, async () => ({ ok: true, value: null }));
			try { expect(await session.hover("fake", "file:///x.ts", 0, 0, 1000, client)).toEqual({ outcome: "ok", hover: null }); }
			finally { await session.dispose(); }
		});
		it("returns unsupported without a hover capability", async () => {
			const { session, client } = await makeSession({}, async () => ({ ok: true, value: {} }));
			try { expect(await session.hover("fake", "file:///x.ts", 0, 0, 1000, client)).toEqual({ outcome: "unsupported", hover: null }); }
			finally { await session.dispose(); }
		});
		it("returns failed when the request throws", async () => {
			const { session, client } = await makeSession({ hoverProvider: true }, async () => { throw new Error("request failed"); });
			try { expect(await session.hover("fake", "file:///x.ts", 0, 0, 1000, client)).toEqual({ outcome: "failed", hover: null }); }
			finally { await session.dispose(); }
		});
	});

	describe("inlay hint requests", () => {
		async function makeSession(capabilities: Record<string, unknown>, request: (...args: unknown[]) => Promise<unknown>) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			const client = { capabilities: () => capabilities, request, documents: { version: () => undefined } } as unknown as LspClient;
			return { session, client };
		}
		it("passes exact range and returns array results", async () => {
			let args: unknown[] = [];
			const hints = [{ position: { line: 2, character: 0 }, label: "type" }];
			const { session, client } = await makeSession({ inlayHintProvider: { resolveProvider: true } }, async (...received) => { args = received; return { ok: true, value: hints }; });
			try {
				expect(await session.inlayHints("fake", "file:///x.ts", 1, 5, 1234, client)).toEqual({ outcome: "ok", hints });
				expect(args).toEqual(["textDocument/inlayHint", { textDocument: { uri: "file:///x.ts" }, range: { start: { line: 1, character: 0 }, end: { line: 5, character: 0 } } }, 1234]);
			} finally { await session.dispose(); }
		});
		it("treats null and other non-array results as empty successful answers", async () => {
			const { session, client } = await makeSession({ inlayHintProvider: true }, async () => ({ ok: true, value: null }));
			try {
				expect(await session.inlayHints("fake", "file:///x.ts", 0, 1, 1000, client)).toEqual({ outcome: "ok", hints: [] });
				const malformed = { ...client, request: async () => ({ ok: true, value: { hints: [] } }) } as unknown as LspClient;
				expect(await session.inlayHints("fake", "file:///x.ts", 0, 1, 1000, malformed)).toEqual({ outcome: "ok", hints: [] });
			} finally { await session.dispose(); }
		});
		it("rejects absent and empty-array capabilities", async () => {
			const { session, client } = await makeSession({}, async () => ({ ok: true, value: [] }));
			try {
				expect(await session.inlayHints("fake", "file:///x.ts", 0, 1, 1000, client)).toEqual({ outcome: "unsupported", hints: [] });
				const empty = { ...client, capabilities: () => ({ inlayHintProvider: [] }) } as unknown as LspClient;
				expect(await session.inlayHints("fake", "file:///x.ts", 0, 1, 1000, empty)).toEqual({ outcome: "unsupported", hints: [] });
			} finally { await session.dispose(); }
		});
		it("returns failed when the request throws", async () => {
			const { session, client } = await makeSession({ inlayHintProvider: true }, async () => { throw new Error("request failed"); });
			try { expect(await session.inlayHints("fake", "file:///x.ts", 0, 1, 1000, client)).toEqual({ outcome: "failed", hints: [] }); }
			finally { await session.dispose(); }
		});
	});

	describe("formatting requests", () => {
		async function makeSession(capabilities: Record<string, unknown>, request: (...args: unknown[]) => Promise<unknown>) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			let args: unknown[] = [];
			const client = { capabilities: () => capabilities, request: async (...received: unknown[]) => { args = received; return request(...received); }, documents: { version: () => undefined } } as unknown as LspClient;
			return { session, client, getArgs: () => args };
		}
		const uri = "file:///format.ts";
		const options = { tabSize: 4, insertSpaces: false, trimTrailingWhitespace: true };

		it("passes formatting options and clamps edits to 1000", async () => {
			const edits = Array.from({ length: 1001 }, (_, index) => ({ index }));
			const { session, client, getArgs } = await makeSession({ documentFormattingProvider: true }, async () => ({ ok: true, value: edits }));
			try {
				const result = await session.formatting("fake", uri, options, 1234, client);
				expect(result.outcome).toBe("ok");
				expect(result.edits).toHaveLength(1000);
				expect(result.edits[999]).toEqual(edits[999]);
				expect(getArgs()).toEqual(["textDocument/formatting", { textDocument: { uri }, options }, 1234]);
			} finally { await session.dispose(); }
		});

		it("treats a null response as no formatting changes", async () => {
			const { session, client } = await makeSession({ documentFormattingProvider: {} }, async () => ({ ok: true, value: null }));
			try { expect(await session.formatting("fake", uri, options, 1000, client)).toEqual({ outcome: "ok", edits: [] }); }
			finally { await session.dispose(); }
		});

		it("returns unsupported without the formatting capability", async () => {
			const { session, client } = await makeSession({}, async () => ({ ok: true, value: [] }));
			try { expect(await session.formatting("fake", uri, options, 1000, client)).toEqual({ outcome: "unsupported", edits: [] }); }
			finally { await session.dispose(); }
		});

		it("returns failed when the formatting request throws", async () => {
			const { session, client } = await makeSession({ documentFormattingProvider: true }, async () => { throw new Error("request failed"); });
			try { expect(await session.formatting("fake", uri, options, 1000, client)).toEqual({ outcome: "failed", edits: [] }); }
			finally { await session.dispose(); }
		});
	});

	describe("rename requests", () => {
		async function makeSession(capabilities: Record<string, unknown>, request: (...args: unknown[]) => Promise<unknown>) {
			const { projectRoot, trustStorePath } = await setup();
			const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot, trustStorePath });
			let args: unknown[] = [];
			const client = { capabilities: () => capabilities, request: async (...received: unknown[]) => { args = received; return request(...received); }, documents: { version: () => undefined } } as unknown as LspClient;
			return { session, client, getArgs: () => args };
		}
		const uri = "file:///rename.ts";
		const position = { line: 3, character: 5 };
		const prepare = { range: { start: position, end: { line: 3, character: 10 } }, placeholder: "symbol" };
		const edit = { changes: { [uri]: [] } };

		it("sends prepareRename and preserves result and null", async () => {
			const { session, client, getArgs } = await makeSession({ renameProvider: { prepareProvider: true } }, async () => ({ ok: true, value: prepare }));
			try {
				expect(await session.prepareRename("fake", uri, 3, 5, 1234, client)).toEqual({ outcome: "ok", prepare });
				expect(getArgs()).toEqual(["textDocument/prepareRename", { textDocument: { uri }, position }, 1234]);
				const nullClient = { ...client, request: async () => ({ ok: true, value: null }) } as unknown as LspClient;
				expect(await session.prepareRename("fake", uri, 3, 5, 1234, nullClient)).toEqual({ outcome: "ok", prepare: null });
			} finally { await session.dispose(); }
		});
		it("gates prepare by rename and prepareProvider capabilities", async () => {
			const { session, client } = await makeSession({ renameProvider: true }, async () => ({ ok: true, value: prepare }));
			try {
				expect(await session.prepareRename("fake", uri, 3, 5, 1234, { ...client, capabilities: () => ({}) } as unknown as LspClient)).toEqual({ outcome: "unsupported", prepare: null });
				expect(await session.prepareRename("fake", uri, 3, 5, 1234, client)).toEqual({ outcome: "unsupported", prepare: null });
			} finally { await session.dispose(); }
		});
		it("sends rename and supports boolean or object provider forms", async () => {
			const { session, client, getArgs } = await makeSession({ renameProvider: { prepareProvider: true } }, async () => ({ ok: true, value: edit }));
			try {
				expect(await session.rename("fake", uri, 3, 5, "renamed", 1234, client)).toEqual({ outcome: "ok", edit });
				expect(getArgs()).toEqual(["textDocument/rename", { textDocument: { uri }, position, newName: "renamed" }, 1234]);
				const booleanProvider = { ...client, capabilities: () => ({ renameProvider: true }), request: async () => ({ ok: true, value: null }) } as unknown as LspClient;
				expect(await session.rename("fake", uri, 3, 5, "renamed", 1234, booleanProvider)).toEqual({ outcome: "ok", edit: null });
			} finally { await session.dispose(); }
		});
		it("reports unsupported capabilities and failed requests", async () => {
			const { session, client } = await makeSession({}, async () => { throw new Error("request failed"); });
			try {
				expect(await session.rename("fake", uri, 3, 5, "renamed", 1234, client)).toEqual({ outcome: "unsupported", edit: null });
				const capable = { ...client, capabilities: () => ({ renameProvider: true }) } as unknown as LspClient;
				expect(await session.rename("fake", uri, 3, 5, "renamed", 1234, capable)).toEqual({ outcome: "failed", edit: null });
				expect(await session.prepareRename("fake", uri, 3, 5, 1234, { ...capable, capabilities: () => ({ renameProvider: { prepareProvider: true } }) } as unknown as LspClient)).toEqual({ outcome: "failed", prepare: null });
			} finally { await session.dispose(); }
		});
	});
});
