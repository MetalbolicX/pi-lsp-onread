import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/main.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-trust-"));
}

const originalCwd = process.cwd();
afterEach(() => {
	process.chdir(originalCwd);
	vi.restoreAllMocks();
});

describe("trust command", () => {
	it("bare trust lists roots in stored order and prints the count", async () => {
		const root = await tempRoot();
		const storePath = join(root, "trust.json");
		await writeFile(storePath, JSON.stringify({ version: 1, trustedRoots: ["/first", "/second"] }));
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["trust"], { trustStorePath: storePath })).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith("/first\n/second\n2 trusted roots.");
	});

	it.each([["trust"], ["trust", "list"]])("prints the empty-store message for missing or empty store (%s)", async (...args) => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(args, { trustStorePath: join(root, "missing.json") })).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith("No trusted roots.");
	});

	it("adds cwd by default and persists the canonical root", async () => {
		const root = await tempRoot();
		const storePath = join(root, "store", "trust.json");
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		process.chdir(root);
		await expect(main(["trust", "add"], { trustStorePath: storePath })).resolves.toBe(0);
		const store = JSON.parse(await readFile(storePath, "utf8")) as { trustedRoots: string[] };
		expect(store.trustedRoots).toEqual([root]);
		expect(log).toHaveBeenCalledWith(`Trusted: ${root}\nStore: ${storePath}`);
	});

	it("does not write when adding an already trusted root", async () => {
		const root = await tempRoot();
		const storePath = join(root, "trust.json");
		const contents = JSON.stringify({ version: 1, trustedRoots: [root] });
		await writeFile(storePath, contents);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["trust", "add", root], { trustStorePath: storePath })).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(`Already trusted: ${root}`);
		expect(await readFile(storePath, "utf8")).toBe(contents);
	});

	it("strictly rejects removing a root that is absent", async () => {
		const root = await tempRoot();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["trust", "remove", root], { trustStorePath: join(root, "trust.json") })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(`Not trusted: ${root}`);
	});

	it("removes a trusted root and persists the result", async () => {
		const root = await tempRoot();
		const storePath = join(root, "trust.json");
		await writeFile(storePath, JSON.stringify({ version: 1, trustedRoots: [root, "/other"] }));
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["trust", "remove", root], { trustStorePath: storePath })).resolves.toBe(0);
		expect(JSON.parse(await readFile(storePath, "utf8")).trustedRoots).toEqual(["/other"]);
		expect(log).toHaveBeenCalledWith(`Removed trust: ${root}`);
	});

	it.each(["trust", "trust add", "trust remove"])("malformed store blocks %s without writing", async (command) => {
		const root = await tempRoot();
		const storePath = join(root, "trust.json");
		await writeFile(storePath, "{");
		const before = await readFile(storePath, "utf8");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const args = command.split(" ");
		await expect(main([...args, ...(args.length > 1 ? [root] : [])], { trustStorePath: storePath })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining(storePath));
		expect(await readFile(storePath, "utf8")).toBe(before);
	});

	it("rejects an unknown trust subcommand", async () => {
		const root = await tempRoot();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["trust", "wat"], { trustStorePath: join(root, "trust.json") })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage"));
	});

	it("keeps help successful and documents trust", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["help"])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Trust"));
	});
});
