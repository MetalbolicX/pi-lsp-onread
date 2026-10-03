import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../../src/config/merge.js";

const defaults = {};

describe("configuration merging", () => {
	it("applies defaults, global, then project precedence with recursive objects and replacements", () => {
		const config = mergeConfig(defaults, {
			lsp: { ts: { command: ["global"], extensions: [".ts"], languageId: "typescript", initialization: { a: 1, b: 2 } } },
			diagnostics: { severities: ["error", "warning"] },
		}, {
			lsp: { ts: { command: ["project"], initialization: { a: 3 } } },
			diagnostics: { severities: ["warning"] },
		});

		expect(config.diagnostics).toEqual({
			onRead: "cached", onChange: "wait", waitMs: 5000,
			severities: ["warning"], maxItems: 10, maxChars: 4000,
		});
		expect(config.lsp).toEqual({ ts: {
			command: ["project"], extensions: [".ts"], languageId: "typescript",
			initialization: { a: 3, b: 2 },
			diagnostics: { onRead: "cached", onChange: "wait", waitMs: 5000, severities: ["warning"] },
		} });
	});

	it("keeps disabled servers as tombstones without requiring commands", () => {
		const config = mergeConfig(defaults, { lsp: { ts: { command: ["ts"], extensions: [".ts"], languageId: "typescript" } } }, { lsp: { ts: { disabled: true } } });
		expect(config.lsp).toMatchObject({ ts: { disabled: true } });
	});

	it("lets lsp false in any layer disable every server", () => {
		expect(mergeConfig(defaults, { lsp: { ts: {} } }, { lsp: false }).lsp).toBe(false);
		expect(mergeConfig(defaults, { lsp: false }, { lsp: { ts: {} } }).lsp).toBe(false);
	});
});
