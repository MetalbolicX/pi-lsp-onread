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

	it("layers lifecycle settings global then project without inventing omitted defaults", () => {
		const config = mergeConfig(defaults, {
			lsp: { ts: { initializeTimeoutMs: 12000, requestTimeoutMs: 8000, retryCooldownMs: 30000, maxConsecutiveStartFailures: 5 } },
		}, {
			lsp: { ts: { initializeTimeoutMs: 9000, retryCooldownMs: 0 } },
		});
		expect(config.lsp).toMatchObject({ ts: {
			initializeTimeoutMs: 9000, requestTimeoutMs: 8000,
			retryCooldownMs: 0, maxConsecutiveStartFailures: 5,
		} });
		const omitted = mergeConfig(defaults, { lsp: { ts: {} } });
		if (omitted.lsp === false) throw new Error("Expected server map");
		for (const field of ["initializeTimeoutMs", "requestTimeoutMs", "retryCooldownMs", "maxConsecutiveStartFailures"]) {
			expect(field in omitted.lsp.ts!).toBe(false);
		}
	});

	it("layers scorecard and keeps omitted scorecard off", () => {
		expect(mergeConfig(defaults, { scorecard: true }, { scorecard: false }).scorecard).toBe(false);
		expect(mergeConfig(defaults, {}, { scorecard: true }).scorecard).toBe(true);
		expect(mergeConfig(defaults).scorecard).toBeUndefined();
	});

	it("layers preflight without injecting an absent default", () => {
		expect(mergeConfig(defaults, { preflight: "block" }, { preflight: "advisory" }).preflight).toBe("advisory");
		expect(mergeConfig(defaults, { preflight: "block" }, { preflight: "off" }).preflight).toBe("off");
		expect(mergeConfig(defaults).preflight).toBeUndefined();
	});

	it("layers prewarm and keeps omitted prewarm off", () => {
		const config = mergeConfig(defaults, { lsp: { ts: { prewarm: true } } }, { lsp: { ts: { prewarm: false } } });
		expect(config.lsp).toMatchObject({ ts: { prewarm: false } });
		const omitted = mergeConfig(defaults, { lsp: { ts: {} } });
		if (omitted.lsp === false) throw new Error("Expected server map");
		expect("prewarm" in omitted.lsp.ts!).toBe(false);
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
