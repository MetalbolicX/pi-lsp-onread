import { describe, expect, it } from "vitest";
import { DiagnosticsStore, freshnessOf } from "../../../src/diagnostics/store.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

const snapshot = (version: number | null, message: string): Snapshot => ({
	serverId: "ts",
	uri: "file:///a.ts",
	version,
	receivedAt: 1,
	items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message }],
});

describe("diagnostics store", () => {
	it("keeps the latest snapshot per server and URI", () => {
		const store = new DiagnosticsStore();
		store.record(snapshot(1, "old"));
		store.record(snapshot(2, "new"));
		expect(store.get("ts", "file:///a.ts")?.items[0]?.message).toBe("new");
		expect(store.has("ts", "file:///a.ts")).toBe(true);
		expect(store.has("other", "file:///a.ts")).toBe(false);
	});

	it("classifies current, stale, and unknown versions", () => {
		expect(freshnessOf(snapshot(4, ""), 4)).toBe("current");
		expect(freshnessOf(snapshot(3, ""), 4)).toBe("stale");
		expect(freshnessOf(snapshot(null, ""), 4)).toBe("unknown");
	});
});
