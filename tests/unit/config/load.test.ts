import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { validateSourceConfig } from "../../../src/config/schema.js";

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-lsp-config-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("configuration loading", () => {
	it("reports missing files as skipped", async () => {
		const result = await loadConfig(join(await makeDirectory(), "missing.json"));
		expect(result).toEqual({ status: "skipped" });
	});

	it("reports malformed JSON with the file path and parse problem", async () => {
		const directory = await makeDirectory();
		const path = join(directory, "broken.json");
		await writeFile(path, "{ invalid", "utf8");

		const result = await loadConfig(path);
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors.join(" ")).toContain(path);
			expect(result.errors.join(" ")).toMatch(/json|parse|position|property/i);
		}
	});

	it("validates source shape while allowing partial server overrides", () => {
		expect(validateSourceConfig({ version: 1, lsp: { ts: { disabled: true } } }).ok).toBe(true);
		const result = validateSourceConfig({ version: 1, unexpected: true });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toMatch(/unexpected|additional propert/i);
	});
});
