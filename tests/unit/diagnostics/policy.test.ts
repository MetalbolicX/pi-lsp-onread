import { describe, expect, it } from "vitest";
import { apply } from "../../../src/diagnostics/policy.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

const makeSnapshot = (serverId: string, severity: number, line: number, message: string): Snapshot => ({
	serverId,
	uri: "file:///a.ts",
	version: 1,
	receivedAt: 1,
	items: [{ range: { start: { line, character: 0 }, end: { line, character: 1 } }, severity, message }],
});

const policy = { severities: ["error", "warning", "information", "hint"] as const, maxItems: 10, maxChars: 1000 };

describe("diagnostics policy", () => {
	it("filters severity and applies global item and character caps across servers", () => {
		const filtered = apply({
			snapshots: [
				{ serverId: "a", currentVersion: 1, snapshot: makeSnapshot("a", 1, 2, "first") },
				{ serverId: "b", currentVersion: 1, snapshot: makeSnapshot("b", 2, 0, "warning") },
			],
			policy: { ...policy, severities: ["error"], maxItems: 10 },
		});
		expect(filtered.items.map((item) => item.message)).toEqual(["first"]);

		const capped = apply({
			snapshots: [
				{ serverId: "a", currentVersion: 1, snapshot: makeSnapshot("a", 1, 2, "first") },
				{ serverId: "b", currentVersion: 1, snapshot: makeSnapshot("b", 1, 0, "second") },
			],
			policy: { ...policy, maxItems: 1, maxChars: 60 },
		});
		expect(capped.items.map((item) => item.message)).toEqual(["second"]);
		expect(capped.dropped.items).toBe(1);
		expect(capped.dropped.characters).toBeGreaterThan(0);
		expect(capped.truncationMarker).toContain("+1 more items truncated");

		const characterCapped = apply({
			snapshots: [{ serverId: "a", currentVersion: 1, snapshot: makeSnapshot("a", 1, 0, "a very long diagnostic message") }],
			policy: { ...policy, maxChars: 40 },
		});
		expect(characterCapped.items).toEqual([]);
		expect(characterCapped.dropped.items).toBe(1);
		expect(characterCapped.truncationMarker).toContain("+1 more items truncated");
	});
});
