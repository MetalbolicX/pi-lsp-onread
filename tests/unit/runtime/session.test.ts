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
