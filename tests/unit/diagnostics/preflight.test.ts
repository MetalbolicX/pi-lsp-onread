import { describe, expect, it } from "vitest";
import { preflightCheck, preflightMessages } from "../../../src/diagnostics/preflight.js";
import { DiagnosticsStore } from "../../../src/diagnostics/store.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

const uri = "file:///project/a.ts";
function storeWith(...snapshots: Snapshot[]) {
	const store = new DiagnosticsStore();
	for (const snapshot of snapshots) store.record(snapshot);
	return store;
}
function snapshot(serverId: string, version: number | null, items: Snapshot["items"] = []): Snapshot {
	return { serverId, uri, version, receivedAt: 0, items };
}
const error = (message: string, severity = 1) => ({
	range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity, message,
});

describe("diagnostics preflight", () => {
	it("distinguishes no data, unknown version, stale, clear, and current errors", () => {
		const none = preflightCheck({ store: storeWith(), servers: ["ts"], uri, currentVersion: 1 });
		expect(none).toMatchObject({ outcome: "no-data", errorCount: 0 });
		const unknown = preflightCheck({ store: storeWith(snapshot("ts", null)), servers: ["ts"], uri, currentVersion: 1 });
		expect(unknown).toMatchObject({ outcome: "unknown", freshness: "unknown" });
		const stale = preflightCheck({ store: storeWith(snapshot("ts", 0, [error("old")])) , servers: ["ts"], uri, currentVersion: 1 });
		expect(stale).toMatchObject({ outcome: "stale", freshness: "stale", errorCount: 0 });
		const clear = preflightCheck({ store: storeWith(snapshot("ts", 1, [error("warning", 2)])), servers: ["ts"], uri, currentVersion: 1 });
		expect(clear).toMatchObject({ outcome: "clear", freshness: "current", errorCount: 0 });
		const errors = preflightCheck({ store: storeWith(snapshot("ts", 1, [error("bad")])), servers: ["ts"], uri, currentVersion: 1 });
		expect(errors).toMatchObject({ outcome: "errors", freshness: "current", errorCount: 1 });
	});

	it("aggregates servers fail-open while retaining current actionable errors", () => {
		const mixed = preflightCheck({ store: storeWith(snapshot("ts", 1, [error("bad")]), snapshot("other", 0)), servers: ["ts", "other"], uri, currentVersion: 1 });
		expect(mixed).toMatchObject({ outcome: "errors", freshness: "current", errorCount: 1 });
		const unknown = preflightCheck({ store: storeWith(snapshot("ts", 1), snapshot("other", 1)), servers: [{ serverId: "ts", currentVersion: 1 }, { serverId: "other" }], uri });
		expect(unknown).toMatchObject({ outcome: "unknown", freshness: "unknown", errorCount: 0 });
		const noData = preflightCheck({ store: storeWith(), servers: ["ts", "other"], uri, currentVersion: 1 });
		expect(noData.outcome).toBe("no-data");
	});

	it("extracts at most three error messages bounded to 120 characters", () => {
		const result = preflightCheck({ store: storeWith(snapshot("ts", 1, [error("x".repeat(160)), error("two"), error("three"), error("four"), error("warning", 2)])), servers: ["ts"], uri, currentVersion: 1 });
		expect(preflightMessages(result)).toHaveLength(3);
		expect(preflightMessages(result)[0]).toHaveLength(120);
		expect(preflightMessages(result)).not.toContain("warning");
	});
});
