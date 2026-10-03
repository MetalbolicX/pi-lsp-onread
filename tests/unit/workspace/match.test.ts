import { describe, expect, it } from "vitest";
import type { EffectiveConfig, EffectiveServerConfig } from "../../../src/config/types.js";
import { matchServers } from "../../../src/workspace/match.js";

const diagnostics = { onRead: "cached" as const, onChange: "wait" as const, waitMs: 1000, severities: ["error" as const] };

function enabledServer(extensions: string[], languageId: string | Record<string, string>): EffectiveServerConfig {
	return { command: ["server"], extensions, languageId, diagnostics };
}

const effectiveConfig: EffectiveConfig = {
	version: 1,
	lsp: {
		typescript: enabledServer([".ts", ".tsx"], { ".ts": "typescript", ".tsx": "typescriptreact" }),
		plain: enabledServer(["js"], "javascript"),
		disabled: { disabled: true, diagnostics },
	},
	diagnostics: { ...diagnostics, maxItems: 10, maxChars: 4000 },
};

describe("workspace server matching", () => {
	it("matches enabled servers by extension and resolves language maps in insertion order", () => {
		expect(matchServers(effectiveConfig, "/workspace/src/component.TSX")).toEqual([
			{ serverId: "typescript", languageId: "typescriptreact" },
		]);
		expect(matchServers(effectiveConfig, "/workspace/src/main.ts")).toEqual([
			{ serverId: "typescript", languageId: "typescript" },
		]);
		expect(matchServers(effectiveConfig, "/workspace/src/main.js")).toEqual([
			{ serverId: "plain", languageId: "javascript" },
		]);
	});

	it("preserves config insertion order when several servers match", () => {
		const config: EffectiveConfig = {
			...effectiveConfig,
			lsp: {
				first: enabledServer([".ts"], "typescript"),
				second: enabledServer(["ts"], "typescript"),
			},
		};

		expect(matchServers(config, "/workspace/file.ts")).toEqual([
			{ serverId: "first", languageId: "typescript" },
			{ serverId: "second", languageId: "typescript" },
		]);
	});

	it("returns no matches when LSP is disabled", () => {
		expect(matchServers({ ...effectiveConfig, lsp: false }, "/workspace/file.ts")).toEqual([]);
	});
});
