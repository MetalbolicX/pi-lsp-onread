import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRoot } from "../../../src/workspace/roots.js";

async function makeProject(): Promise<string> {
	return mkdtemp(join(tmpdir(), "workspace-roots-"));
}

async function makeFile(filePath: string): Promise<void> {
	await mkdir(join(filePath, ".."), { recursive: true });
	await writeFile(filePath, "");
}

describe("workspace root resolution", () => {
	it("chooses the nearest directory containing any marker", async () => {
		const projectRoot = await makeProject();
		const fartherRoot = join(projectRoot, "packages");
		const nearerRoot = join(fartherRoot, "app");
		const filePath = join(nearerRoot, "src", "index.ts");
		await makeFile(filePath);
		await writeFile(join(fartherRoot, "package.json"), "{}");
		await writeFile(join(nearerRoot, "workspace.marker"), "");

		expect(await resolveRoot({ filePath, markers: ["package.json", "workspace.marker"], projectRoot })).toBe(nearerRoot);
	});

	it("does not use markers above the project boundary", async () => {
		const parent = await makeProject();
		const projectRoot = join(parent, "project");
		const filePath = join(projectRoot, "src", "index.ts");
		await makeFile(filePath);
		await writeFile(join(parent, "outside.marker"), "");

		expect(await resolveRoot({ filePath, markers: ["outside.marker"], projectRoot })).toBe(projectRoot);
	});

	it("returns projectRoot when the file is outside the project boundary", async () => {
		const parent = await makeProject();
		const projectRoot = join(parent, "project");
		const outsideFile = join(parent, "outside", "index.ts");
		await makeFile(outsideFile);
		await writeFile(join(parent, "outside", "outside.marker"), "");

		expect(await resolveRoot({ filePath: outsideFile, markers: ["outside.marker"], projectRoot })).toBe(projectRoot);
	});

	it("falls back to projectRoot when no marker exists", async () => {
		const projectRoot = await makeProject();
		const filePath = join(projectRoot, "src", "index.ts");
		await makeFile(filePath);

		expect(await resolveRoot({ filePath, markers: ["missing.marker"], projectRoot })).toBe(projectRoot);
	});
});
