import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutable } from "../../../src/cli/executables.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-executables-"));
}

describe("static executable discovery", () => {
	it("finds an executable bare command by scanning PATH", async () => {
		const root = await tempRoot();
		const bin = join(root, "bin");
		await mkdir(bin);
		const executable = join(bin, "gopls");
		await writeFile(executable, "#!/bin/sh\n");
		await chmod(executable, 0o755);
		expect(await findExecutable("gopls", root, bin)).toBe(executable);
	});

	it("ignores non-executable files in PATH", async () => {
		const root = await tempRoot();
		const bin = join(root, "bin");
		await mkdir(bin);
		await writeFile(join(bin, "gopls"), "not executable");
		expect(await findExecutable("gopls", root, bin)).toBeUndefined();
	});

	it("resolves path-bearing commands against the project root", async () => {
		const root = await tempRoot();
		const bin = join(root, "tools");
		await mkdir(bin);
		const executable = join(bin, "server");
		await writeFile(executable, "server");
		await chmod(executable, 0o755);
		expect(await findExecutable("./tools/server", root, "")).toBe(executable);
	});
});
