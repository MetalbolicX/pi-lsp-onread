import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets.js";

const NAME_PATTERN = /^(\.[A-Za-z0-9][A-Za-z0-9_.-]*|[A-Za-z][A-Za-z0-9_.-]*)$/;

describe("preset catalog", () => {
	it("ships a substantial catalog", () => {
		expect(PRESETS.length).toBeGreaterThanOrEqual(20);
	});

	it("uses unique preset ids", () => {
		const ids = PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("keeps extensions globally unambiguous", () => {
		const owners = new Map<string, string>();
		for (const preset of PRESETS) {
			for (const ext of preset.extensions) {
				const previous = owners.get(ext);
				expect(previous, `${ext} claimed by ${previous ?? "?"} and ${preset.id}`).toBeUndefined();
				owners.set(ext, preset.id);
			}
		}
	});

	it("has well-formed commands, extension names, and language coverage", () => {
		for (const preset of PRESETS) {
			expect(preset.command.length, preset.id).toBeGreaterThan(0);
			for (const arg of preset.command) {
				expect(arg.length, preset.id).toBeGreaterThan(0);
			}
			expect(preset.extensions.length, preset.id).toBeGreaterThan(0);
			for (const ext of preset.extensions) {
				expect(ext, preset.id).toMatch(NAME_PATTERN);
			}
			const { languageId } = preset;
			const covered = preset.extensions.every(
				(ext) => typeof languageId === "string" || ext in languageId,
			);
			expect(covered, `${preset.id}: languageId map must cover every extension`).toBe(true);
		}
	});
});

describe("bundled JSON schema", () => {
	const schema = JSON.parse(
		readFileSync(new URL("../schema/lsp.schema.json", import.meta.url), "utf8"),
	) as {
		$schema: string;
		additionalProperties: boolean;
		properties: { version: { const: number } };
	};

	it("is Draft 2020-12 and pins contract version 1", () => {
		expect(schema.$schema).toContain("2020-12");
		expect(schema.properties.version.const).toBe(1);
	});

	it("rejects unknown fields at the top level", () => {
		expect(schema.additionalProperties).toBe(false);
	});
});
