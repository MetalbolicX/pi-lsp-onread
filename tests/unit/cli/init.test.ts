import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "../../../src/cli/commands/init.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-init-"));
}

function input(lines: string[], isTTY = false): PassThrough & { isTTY: boolean } {
	const stream = new PassThrough() as PassThrough & { isTTY: boolean };
	stream.isTTY = isTTY;
	lines.forEach((line, index) => setTimeout(() => stream.write(line), 10 + index * 100));
	return stream;
}

const originalCwd = process.cwd();
afterEach(() => {
	process.chdir(originalCwd);
	vi.restoreAllMocks();
});

describe("init command", () => {
	it("creates a config and schema companion from noninteractive languages", async () => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(init(["--project", root, "--languages", "go,rust", "--yes"])).resolves.toBe(0);
		const config = JSON.parse(await readFile(join(root, ".pi", "lsp.json"), "utf8")) as { lsp: Record<string, unknown> };
		expect(Object.keys(config.lsp)).toEqual(["go", "rust"]);
		await expect(readFile(join(root, ".pi", "lsp.schema.json"), "utf8")).resolves.toContain("$schema");
		expect(log).toHaveBeenCalledWith(expect.stringContaining("lsp.json"));
	});

	it("extends existing config and preserves custom servers and schema", async () => {
		const root = await tempRoot();
		const existing = { "$schema": "custom-schema.json", version: 1, diagnostics: { maxItems: 9 }, lsp: { custom: { command: ["custom-ls"], extensions: [".custom"], languageId: "custom" } } };
		await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, ".pi")));
		await writeFile(join(root, ".pi", "lsp.json"), JSON.stringify(existing));
		await expect(init(["--project", root, "--languages", "go", "--yes"])).resolves.toBe(0);
		const updated = JSON.parse(await readFile(join(root, ".pi", "lsp.json"), "utf8")) as typeof existing & { lsp: Record<string, unknown> };
		expect(updated["$schema"]).toBe(existing["$schema"]);
		expect(updated.diagnostics).toEqual(existing.diagnostics);
		expect(updated.lsp.custom).toEqual(existing.lsp.custom);
		await expect(readFile(join(root, ".pi", "lsp.schema.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reports NOOP entries without treating them as additions", async () => {
		const root = await tempRoot();
		await expect(init(["--project", root, "--languages", "go", "--yes"])).resolves.toBe(0);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(init(["--project", root, "--languages", "go", "--yes"])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringMatching(/no.?op|already configured/i));
	});

	it("blocks conflicts even with --yes and prints both definitions", async () => {
		const root = await tempRoot();
		await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, ".pi")));
		await writeFile(join(root, ".pi", "lsp.json"), JSON.stringify({ version: 1, lsp: { go: { command: ["custom-gopls"], extensions: [".go"], languageId: "go" } } }));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(init(["--project", root, "--languages", "go", "--yes"])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("custom-gopls"));
		expect(error).toHaveBeenCalledWith(expect.stringContaining("gopls"));
	});

	it("prints a dry-run plan without writing", async () => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(init(["--project", root, "--languages", "go", "--dry-run"])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("lsp.json"));
		await expect(readdir(join(root, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("requires --languages on non-TTY input", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(init(["--project", await tempRoot()], { stdin: input([], false) })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("--languages"));
	});

	it("reports malformed existing config without writing", async () => {
		const root = await tempRoot();
		await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, ".pi")));
		const path = join(root, ".pi", "lsp.json");
		await writeFile(path, "{");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(init(["--project", root, "--languages", "go", "--yes"])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining(path));
		expect(await readFile(path, "utf8")).toBe("{");
	});

	it("supports interactive selection by number and preset id", async () => {
		const root = await tempRoot();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(init(["--project", root], { stdin: input(["1\n", "y\n"], true) })).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("typescript"));
		const second = await tempRoot();
		await expect(init(["--project", second], { stdin: input(["go\n", "y\n"], true) })).resolves.toBe(0);
		expect(JSON.parse(await readFile(join(second, ".pi", "lsp.json"), "utf8"))).toHaveProperty("lsp.go");
	});
});

describe("manifest selection hints", () => {
	it("maps root manifests and package toolchain dependencies to preset ids", async () => {
		const root = await tempRoot();
		await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { typescript: "^5", rescript: "^11" } }));
		await writeFile(join(root, "go.mod"), "module example.test/app\n");
		const { detectManifestPresets } = await import("../../../src/cli/manifests.js");
		expect(await detectManifestPresets(root)).toEqual(expect.arrayContaining(["typescript", "rescript", "go"]));
	});

	it("returns no hints for unrecognized manifests", async () => {
		const root = await tempRoot();
		await writeFile(join(root, "unknown.marker"), "");
		const { detectManifestPresets } = await import("../../../src/cli/manifests.js");
		expect(await detectManifestPresets(root)).toEqual([]);
	});
});
