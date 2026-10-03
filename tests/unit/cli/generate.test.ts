import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SourceConfig } from "../../../src/config/types.js";
import { buildEffectiveConfig } from "../../../src/config/index.js";
import {
	buildServerEntry,
	buildUpdatedSource,
	ensureSchemaCompanion,
	planAdditions,
	writeConfig,
} from "../../../src/cli/generate.js";

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-lsp-generate-"));
}

describe("CLI config generation", () => {
	it("builds catalog server entries and reports valid ids for an unknown preset", () => {
		const entry = buildServerEntry("typescript");
		expect(entry.ok).toBe(true);
		if (entry.ok) {
			expect(entry.serverId).toBe("typescript");
			expect(entry.entry).toMatchObject({ command: ["typescript-language-server", "--stdio"], rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"] });
			expect(entry.entry.languageId).toEqual(expect.objectContaining({ ".tsx": "typescriptreact" }));
		}
		const unknown = buildServerEntry("not-a-preset");
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.errors.join(" ")).toMatch(/typescript.*python.*go/s);
	});

	it("classifies new, deeply-equal no-op, and conflicting server definitions", () => {
		const incoming = buildServerEntry("typescript");
		expect(incoming.ok).toBe(true);
		if (!incoming.ok) return;
		const source: SourceConfig = { version: 1, lsp: {
			typescript: structuredClone(incoming.entry),
				python: { command: ["custom-python"], extensions: [".py"], languageId: "python" },
		} };
		const plan = planAdditions({ existingSource: source, presetIds: ["go", "typescript", "python"] });
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			expect(plan.additions.map((item) => item.status)).toEqual(["NEW", "NOOP", "CONFLICT"]);
			const [, , conflict] = plan.additions;
			if (conflict?.status === "CONFLICT") {
				expect(conflict.existing).toEqual(source.lsp !== false ? source.lsp?.python : undefined);
				expect(conflict.incoming).toMatchObject({ command: ["pyright-langserver", "--stdio"] });
			}
		}
	});

	it("preserves custom config fields and only adds NEW entries", () => {
		const existing: SourceConfig = {
			"$schema": "https://example.test/schema.json", version: 1,
			lsp: { custom: { command: ["custom"], extensions: [".x"], languageId: "x", env: { KEEP: "yes" }, settings: { custom: true } } },
			diagnostics: { maxItems: 4 },
		};
		const plan = planAdditions({ existingSource: existing, presetIds: ["go"] });
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			const updated = buildUpdatedSource({ existingSource: existing, additions: plan.additions });
			expect(updated).toMatchObject({ "$schema": existing["$schema"], version: 1, diagnostics: existing.diagnostics });
			if (updated.lsp !== false) {
				expect(updated.lsp?.custom).toEqual(existing.lsp !== false ? existing.lsp?.custom : undefined);
				expect(updated.lsp?.go).toBeDefined();
			}
		}
	});

	it("adds a schema companion only for new configs without a schema preference", () => {
		const initial = ensureSchemaCompanion({ source: { version: 1 } });
		expect(initial.source["$schema"]).toBe("./lsp.schema.json");
		expect(initial.companion).toMatch(/^\{\n  /);
		expect(initial.companion?.endsWith("\n")).toBe(true);
		const custom = ensureSchemaCompanion({ source: { version: 1, "$schema": "custom.json" } });
		expect(custom.source["$schema"]).toBe("custom.json");
		expect(custom.companion).toBeUndefined();
		const existing = ensureSchemaCompanion({ source: { version: 1 }, existingSource: { version: 1, "$schema": "custom-existing.json" } });
		expect(existing.source["$schema"]).toBeUndefined();
		expect(existing.companion).toBeUndefined();
	});

	it("blocks invalid or semantically incomplete sources before writing", async () => {
		const projectRoot = await tempRoot();
		const result = await writeConfig({ projectRoot, source: { version: 1, lsp: { broken: { extensions: [".x"], languageId: "x" } } }, dryRun: false });
		expect(result.ok).toBe(false);
		const directory = join(projectRoot, ".pi");
		await expect(readdir(directory)).rejects.toMatchObject({ code: "ENOENT" });
		if (!result.ok) expect(result.errors.join(" ")).toMatch(/command/i);
	});

	it("dry-run reports the target and changes without filesystem writes", async () => {
		const projectRoot = await tempRoot();
		const result = await writeConfig({ projectRoot, source: { version: 1, lsp: { go: { command: ["gopls"], extensions: [".go"], languageId: "go" } } }, dryRun: true, addedIds: ["go"], noopIds: ["python"] });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.summary).toMatch(/go.*python/);
		await expect(readdir(join(projectRoot, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("cleans up the temporary config when replacing the destination fails", async () => {
		const projectRoot = await tempRoot();
		const directory = join(projectRoot, ".pi");
		await mkdir(directory);
		await mkdir(join(directory, "lsp.json"));
		const result = await writeConfig({ projectRoot, source: { version: 1 }, dryRun: false });
		expect(result.ok).toBe(false);
		expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	it("atomically writes parseable JSON at .pi/lsp.json", async () => {
		const projectRoot = await tempRoot();
		const source: SourceConfig = { version: 1, lsp: { go: { command: ["gopls"], extensions: [".go"], languageId: "go" } } };
		const result = await writeConfig({ projectRoot, source, dryRun: false });
		expect(result.ok).toBe(true);
		const path = join(projectRoot, ".pi", "lsp.json");
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...source, "$schema": "./lsp.schema.json" });
		expect((await readFile(join(projectRoot, ".pi", "lsp.schema.json"), "utf8")).endsWith("\n")).toBe(true);
		const effective = await buildEffectiveConfig({ projectRoot, globalPath: join(projectRoot, "missing-global.json") });
		expect(effective.ok).toBe(true);
	});
});
