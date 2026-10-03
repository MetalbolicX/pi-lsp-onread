import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addToStore, canonicalizeRoot, loadTrustStore, removeFromStore, saveTrustStore } from "../../../src/runtime/trust-store.js";

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-lsp-trust-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("trust store", () => {
	it("loads an empty store when the file is missing", async () => {
		const path = join(await makeDirectory(), "missing.json");
		expect(await loadTrustStore({ path })).toEqual({ ok: true, store: { version: 1, trustedRoots: [] } });
	});

	it("reports malformed JSON with the file and actionable parse context without throwing", async () => {
		const path = join(await makeDirectory(), "broken.json");
		await writeFile(path, "{ invalid", "utf8");

		const result = await loadTrustStore({ path });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(path);
			expect(result.errors.join(" ")).toMatch(/json|parse|invalid/i);
		}
	});

	it.each([
		["version", { version: 2, trustedRoots: [] }],
		["trustedRoots", { version: 1, trustedRoots: [3] }],
	])("rejects an invalid %s shape and names the file", async (_field, contents) => {
		const path = join(await makeDirectory(), "wrong-shape.json");
		await writeFile(path, JSON.stringify(contents), "utf8");

		const result = await loadTrustStore({ path });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toContain(path);
			expect(result.errors.join(" ")).toMatch(/version|trustedRoots/i);
		}
	});

	it("canonicalizes existing paths through realpath and falls back to resolve", async () => {
		const directory = await makeDirectory();
		const existing = join(directory, "existing");
		await mkdir(existing);
		expect(await canonicalizeRoot(existing)).toBe(await import("node:fs/promises").then(({ realpath }) => realpath(existing)));

		const missing = join(directory, "not-created", "child");
		expect(await canonicalizeRoot(missing)).toBe(resolve(missing));
	});

	it("adds roots idempotently while preserving order", () => {
		const store = { version: 1 as const, trustedRoots: ["/one", "/two"] };
		expect(addToStore(store, "/two")).toEqual({ changed: false, store });
		expect(addToStore(store, "/three")).toEqual({ changed: true, store: { version: 1, trustedRoots: ["/one", "/two", "/three"] } });
	});

	it("removes an existing root and reports an absent root as unchanged", () => {
		const store = { version: 1 as const, trustedRoots: ["/one", "/two"] };
		expect(removeFromStore(store, "/missing")).toEqual({ changed: false, store });
		expect(removeFromStore(store, "/one")).toEqual({ changed: true, store: { version: 1, trustedRoots: ["/two"] } });
	});

	it("atomically saves parseable JSON with a trailing newline", async () => {
		const directory = await makeDirectory();
		const path = join(directory, "nested", "store.json");
		const store = { version: 1 as const, trustedRoots: ["/project"] };
		await saveTrustStore({ path, store });

		const serialized = await readFile(path, "utf8");
		expect(serialized.endsWith("\n")).toBe(true);
		expect(JSON.parse(serialized)).toEqual(store);
		expect(await loadTrustStore({ path })).toEqual({ ok: true, store });
	});
});
