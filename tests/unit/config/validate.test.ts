import { describe, expect, it } from "vitest";
import { buildEffectiveConfig } from "../../../src/config/index.js";
import { validateEffectiveConfig } from "../../../src/config/validate.js";

describe("merged configuration validation", () => {
	it("reports missing commands and empty extensions for enabled servers", () => {
		const result = validateEffectiveConfig({ version: 1, lsp: {
			missingCommand: { extensions: [".x"], languageId: "x" },
			emptyExtensions: { command: ["server"], extensions: [], languageId: "x" },
		} });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join(" ")).toMatch(/missingCommand.*command/s);
			expect(result.errors.join(" ")).toMatch(/emptyExtensions.*extensions/s);
		}
	});

	it("reports missing and unknown languageId map keys", () => {
		const result = validateEffectiveConfig({ version: 1, lsp: {
			badMap: { command: ["server"], extensions: [".ts", ".tsx"], languageId: { ".ts": "typescript", ".js": "javascript" } },
		} });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toMatch(/\.tsx.*missing|missing.*\.tsx/i);
		if (!result.ok) expect(result.errors.join(" ")).toMatch(/\.js.*unknown|unknown.*\.js/i);
	});

	it.each([
		["initializeTimeoutMs", -1], ["requestTimeoutMs", 1.5],
		["retryCooldownMs", true], ["maxConsecutiveStartFailures", 0],
	])("rejects invalid %s with server and field in the error", (field, value) => {
		const result = validateEffectiveConfig({ version: 1, lsp: {
			myServer: { command: ["server"], extensions: [".ts"], languageId: "typescript", [field]: value },
		} });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(" ")).toMatch(new RegExp(`myServer.*${field}`));
	});

	it("builds defaults-only configuration when both files are missing", async () => {
		const result = await buildEffectiveConfig({ projectRoot: "/nonexistent-project-root-config-test", globalPath: "/nonexistent-global-config-test.json" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.config.diagnostics).toEqual({
			onRead: "cached", onChange: "wait", waitMs: 5000,
			severities: ["error"], maxItems: 10, maxChars: 4000,
		});
	});
});
