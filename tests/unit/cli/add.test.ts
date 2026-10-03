import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/main.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-add-"));
}

const originalCwd = process.cwd();
afterEach(() => {
	process.chdir(originalCwd);
	vi.restoreAllMocks();
});

describe("add command", () => {
	it("creates a config and schema companion", async () => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["add", "go", "--project", root])).resolves.toBe(0);
		const config = JSON.parse(await readFile(join(root, ".pi", "lsp.json"), "utf8")) as { lsp: Record<string, unknown> };
		expect(config.lsp).toHaveProperty("go");
		await expect(readFile(join(root, ".pi", "lsp.schema.json"), "utf8")).resolves.toContain("$schema");
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Wrote"));
		expect(log).toHaveBeenCalledWith(expect.stringContaining("schema companion"));
	});

	it("extends existing config preserving custom server, schema, and diagnostics", async () => {
		const root = await tempRoot();
		const existing = { "$schema": "custom-schema.json", version: 1, diagnostics: { maxItems: 9 }, lsp: { custom: { command: ["custom-ls"], extensions: [".custom"], languageId: "custom" } } };
		await mkdir(join(root, ".pi"));
		await writeFile(join(root, ".pi", "lsp.json"), JSON.stringify(existing));
		await expect(main(["add", "go", "--project", root])).resolves.toBe(0);
		const updated = JSON.parse(await readFile(join(root, ".pi", "lsp.json"), "utf8")) as typeof existing & { lsp: Record<string, unknown> };
		expect(updated["$schema"]).toBe(existing["$schema"]);
		expect(updated.diagnostics).toEqual(existing.diagnostics);
		expect(updated.lsp.custom).toEqual(existing.lsp.custom);
		expect(updated.lsp).toHaveProperty("go");
	});

	it("reports NOOP entries as skipped", async () => {
		const root = await tempRoot();
		await expect(main(["add", "go", "--project", root])).resolves.toBe(0);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["add", "go", "--project", root])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringMatching(/no.?op|skip|already configured/i));
	});

	it("blocks conflicts even with --yes and prints both definitions", async () => {
		const root = await tempRoot();
		await mkdir(join(root, ".pi"));
		await writeFile(join(root, ".pi", "lsp.json"), JSON.stringify({ version: 1, lsp: { go: { command: ["custom-gopls"], extensions: [".go"], languageId: "go" } } }));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["add", "go", "--project", root, "--yes"])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("custom-gopls"));
		expect(error).toHaveBeenCalledWith(expect.stringContaining("gopls"));
	});

	it("lists valid preset ids for an unknown preset", async () => {
		const root = await tempRoot();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["add", "not-a-preset", "--project", root])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("typescript"));
		expect(error).toHaveBeenCalledWith(expect.stringContaining("python"));
	});

	it("returns a usage error when no positional preset is provided", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["add"])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage"));
	});

	it("dry-run prints a plan and writes nothing", async () => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["add", "go", "--project", root, "--dry-run"])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("lsp.json"));
		await expect(readdir(join(root, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reports malformed existing config without writing", async () => {
		const root = await tempRoot();
		await mkdir(join(root, ".pi"));
		const path = join(root, ".pi", "lsp.json");
		await writeFile(path, "{");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["add", "go", "--project", root])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining(path));
		expect(await readFile(path, "utf8")).toBe("{");
	});
});
