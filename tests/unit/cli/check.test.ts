import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/main.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-check-"));
}

async function config(root: string, lsp: unknown): Promise<void> {
	await mkdir(join(root, ".pi"), { recursive: true });
	await writeFile(join(root, ".pi", "lsp.json"), JSON.stringify({ version: 1, lsp }));
}

const originalPath = process.env.PATH;
afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	vi.restoreAllMocks();
});

describe("check command", () => {
	it("succeeds when valid config executables are found on PATH", async () => {
		const root = await tempRoot();
		const bin = join(root, "bin");
		await mkdir(bin);
		const executable = join(bin, "gopls");
		await writeFile(executable, "#!/bin/sh\n");
		await chmod(executable, 0o755);
		process.env.PATH = bin;
		await config(root, { go: { command: ["gopls"], extensions: [".go"], languageId: "go" } });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining(`found at ${executable}`));
	});

	it("returns a finding for a missing executable", async () => {
		const root = await tempRoot();
		process.env.PATH = "";
		await config(root, { go: { command: ["missing-gopls"], extensions: [".go"], languageId: "go" } });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(1);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("MISSING: missing-gopls"));
	});

	it("reports disabled servers as skipped", async () => {
		const root = await tempRoot();
		await config(root, { go: { disabled: true } });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("go: skipped (disabled)"));
	});

	it("reports lsp false as skipped", async () => {
		const root = await tempRoot();
		await config(root, false);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"));
	});

	it("prints path-qualified validation errors before executable findings", async () => {
		const root = await tempRoot();
		await mkdir(join(root, ".pi"));
		const path = join(root, ".pi", "lsp.json");
		await writeFile(path, "{");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining(path));
		expect(log).not.toHaveBeenCalled();
	});

	it("reports no configuration as a distinct error", async () => {
		const root = await tempRoot();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["check", "--project", root])).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/no .*config|no .*configuration/i));
	});
});
