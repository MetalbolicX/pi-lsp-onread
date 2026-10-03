import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/main.js";

async function emptyPath(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-install-"));
}

async function pathWithPi(): Promise<string> {
	const pathEnv = await emptyPath();
	const pi = join(pathEnv, "pi");
	await writeFile(pi, "");
	await chmod(pi, 0o755);
	return pathEnv;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("install command", () => {
	it("dry-run prints the exact command without spawning", async () => {
		const pathEnv = await pathWithPi();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const runner = vi.fn();
		await expect(main(["install", "--dry-run"], { pathEnv, piRunner: runner })).resolves.toBe(0);
		expect(log).toHaveBeenCalledWith("pi install npm:pi-lsp-onread");
		expect(runner).not.toHaveBeenCalled();
	});

	it("reports missing pi clearly and exits 1", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(main(["install"], { pathEnv: await emptyPath() })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/pi.*(install|PATH)|(install|PATH).*pi/i));
	});

	it("runs personal registration without extra flags", async () => {
		const pathEnv = await pathWithPi();
		const runner = vi.fn().mockResolvedValue({ code: 0, stdout: "registered", stderr: "" });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["install"], { pathEnv, piRunner: runner })).resolves.toBe(0);
		expect(runner).toHaveBeenCalledWith(["install", "npm:pi-lsp-onread"]);
		expect(log).toHaveBeenCalledWith("registered");
	});

	it("appends --local for project scope", async () => {
		const pathEnv = await pathWithPi();
		const runner = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
		await expect(main(["install", "--local"], { pathEnv, piRunner: runner })).resolves.toBe(0);
		expect(runner).toHaveBeenCalledWith(["install", "npm:pi-lsp-onread", "--local"]);
	});

	it("relays runner stderr and exits 1 on a nonzero status", async () => {
		const pathEnv = await pathWithPi();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const runner = vi.fn().mockResolvedValue({ code: 2, stdout: "pi output", stderr: "pi detail" });
		await expect(main(["install"], { pathEnv, piRunner: runner })).resolves.toBe(1);
		expect(log).toHaveBeenCalledWith("pi output");
		expect(error).toHaveBeenCalledWith("pi detail");
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/install.*failed|failed.*install/i));
	});

	it("returns 1 and reports a spawn error", async () => {
		const pathEnv = await pathWithPi();
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const runner = vi.fn().mockRejectedValue(new Error("spawn denied"));
		await expect(main(["install"], { pathEnv, piRunner: runner })).resolves.toBe(1);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("spawn denied"));
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/install.*failed|failed.*install/i));
	});
});
