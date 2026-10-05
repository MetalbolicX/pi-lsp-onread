import { describe, expect, it } from "vitest";
import { computeScorecard } from "../../../src/diagnostics/scorecard.js";
import { DiagnosticsStore } from "../../../src/diagnostics/store.js";
import type { DiagnosticItem, Snapshot } from "../../../src/diagnostics/types.js";

const item = (severity: number, message = `severity-${severity}`): DiagnosticItem => ({
	severity,
	message,
	range: { start: { line: severity, character: 0 }, end: { line: severity, character: 1 } },
});
const snapshot = (version: number | null, items: DiagnosticItem[]): Snapshot => ({
	serverId: "ts", uri: "file:///a.ts", version, receivedAt: 0, items,
});
const document = { serverId: "ts", uri: "file:///a.ts", currentVersion: 2 };

function storeWith(current: Snapshot, baseline?: Snapshot): DiagnosticsStore {
	const store = new DiagnosticsStore();
	if (baseline) store.record(baseline);
	store.record(current);
	return store;
}

describe("computeScorecard", () => {
	it("counts diagnostics across severities and reports a current delta", () => {
		const store = storeWith(snapshot(2, [item(1), item(2), item(2), item(3), item(4)]), snapshot(1, [item(1)]));
		const result = computeScorecard({ store, documents: [document], policy: { maxItems: 10, maxChars: 4000 } });
		expect(result.documents[0]).toMatchObject({
			counts: { error: 1, warning: 2, information: 1, hint: 1 },
			baseline: true, freshness: "current",
			delta: { newlyObserved: 4, resolved: 0, unchangedCount: 1 },
		});
	});

	it("does not make delta claims for stale snapshots", () => {
		const result = computeScorecard({
			store: storeWith(snapshot(1, [item(1)]), snapshot(0, [])), documents: [document],
			policy: { maxItems: 10, maxChars: 4000 },
		});
		expect(result.documents[0]).toMatchObject({ freshness: "stale", baseline: true });
		expect(result.documents[0]).not.toHaveProperty("delta");
	});

	it("labels null or unavailable current versions unknown", () => {
		const result = computeScorecard({
			store: storeWith(snapshot(null, [item(1)]), snapshot(null, [])),
			documents: [{ ...document, currentVersion: undefined }], policy: { maxItems: 10, maxChars: 4000 },
		});
		expect(result.documents[0]).toMatchObject({ freshness: "unknown", baseline: true });
		expect(result.documents[0]).not.toHaveProperty("delta");
	});

	it("bounds documents with maxItems and maxChars and adds a truncation marker", () => {
		const store = new DiagnosticsStore();
		for (const uri of ["file:///a.ts", "file:///b.ts", "file:///c.ts"]) store.record({ ...snapshot(1, [item(1, "x".repeat(80))]), uri });
		const result = computeScorecard({
			store, documents: ["a.ts", "b.ts", "c.ts"].map((name) => ({ ...document, uri: `file:///${name}` })),
			policy: { maxItems: 2, maxChars: 250 },
		});
		expect(result.documents.length).toBeLessThanOrEqual(2);
		expect(result.truncationMarker).toMatch(/truncated/);
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(250);
	});

	it("reports counts only without a baseline and returns empty input as empty", () => {
		const result = computeScorecard({
			store: storeWith(snapshot(2, [item(1)])), documents: [document],
			policy: { maxItems: 10, maxChars: 4000 },
		});
		expect(result.documents[0]).toMatchObject({ baseline: false, freshness: "current", counts: { error: 1 } });
		expect(result.documents[0]).not.toHaveProperty("delta");
		expect(computeScorecard({ store: new DiagnosticsStore(), documents: [], policy: { maxItems: 10, maxChars: 4000 } })).toEqual({ documents: [] });
	});
});
