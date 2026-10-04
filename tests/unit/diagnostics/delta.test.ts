import { describe, expect, it } from "vitest";
import { computeDelta } from "../../../src/diagnostics/delta.js";
import type { DiagnosticItem, Snapshot } from "../../../src/diagnostics/types.js";

const item = (message: string, overrides: Partial<DiagnosticItem> = {}): DiagnosticItem => ({
	range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
	severity: 1,
	code: "E1",
	message,
	...overrides,
});

const snapshot = (items: DiagnosticItem[], overrides: Partial<Snapshot> = {}): Snapshot => ({
	serverId: "ts",
	uri: "file:///a.ts",
	version: 1,
	receivedAt: 1,
	items,
	...overrides,
});

describe("computeDelta", () => {
	it("counts all items as unchanged for identical snapshots", () => {
		const diagnostics = [item("first"), item("second")];
		expect(computeDelta(snapshot(diagnostics), snapshot(diagnostics))).toEqual({
			newlyObserved: [], resolved: [], unchangedCount: 2,
		});
	});

	it("reports removed items as resolved", () => {
		const removed = item("removed");
		expect(computeDelta(snapshot([removed]), snapshot([]))).toEqual({
			newlyObserved: [], resolved: [removed], unchangedCount: 0,
		});
	});

	it("reports added items as newly observed", () => {
		const added = item("added");
		expect(computeDelta(snapshot([]), snapshot([added]))).toEqual({
			newlyObserved: [added], resolved: [], unchangedCount: 0,
		});
	});

	it.each([
		["message", { message: "changed" }],
		["range", { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } } }],
		["severity", { severity: 2 }],
		["code", { code: "E2" }],
	] as const)("treats a changed %s as resolved and newly observed", (_field, change) => {
		const previous = item("original");
		const changed = { ...previous, ...change };
		expect(computeDelta(snapshot([previous]), snapshot([changed]))).toEqual({
			newlyObserved: [changed], resolved: [previous], unchangedCount: 0,
		});
	});

	it("matches duplicate identical items greedily and counts matched pairs", () => {
		const duplicate = item("duplicate");
		const distinct = item("distinct");
		const result = computeDelta(snapshot([duplicate, distinct, duplicate]), snapshot([duplicate, duplicate]));
		expect(result).toEqual({ newlyObserved: [], resolved: [distinct], unchangedCount: 2 });
	});

	it("preserves current order for new items and baseline order for resolved items", () => {
		const baselineFirst = item("old first");
		const baselineSecond = item("old second");
		const currentFirst = item("new first");
		const currentSecond = item("new second");
		expect(computeDelta(snapshot([baselineFirst, baselineSecond]), snapshot([currentFirst, currentSecond]))).toEqual({
			newlyObserved: [currentFirst, currentSecond],
			resolved: [baselineFirst, baselineSecond],
			unchangedCount: 0,
		});
	});

	it("rejects different server IDs and names both keys", () => {
		expect(() => computeDelta(snapshot([]), snapshot([], { serverId: "rust" })))
			.toThrow(/ts.*file:\/\/\/a\.ts.*rust.*file:\/\/\/a\.ts/);
	});

	it("rejects different URIs and names both keys", () => {
		expect(() => computeDelta(snapshot([]), snapshot([], { uri: "file:\/\/\/b\.ts" })))
			.toThrow(/ts.*file:\/\/\/a\.ts.*ts.*file:\/\/\/b\.ts/);
	});

	it("returns zero counts for empty snapshots", () => {
		expect(computeDelta(snapshot([]), snapshot([]))).toEqual({
			newlyObserved: [], resolved: [], unchangedCount: 0,
		});
	});

	it("reports all current items when the baseline is empty", () => {
		const current = [item("first"), item("second")];
		expect(computeDelta(snapshot([]), snapshot(current))).toEqual({
			newlyObserved: current, resolved: [], unchangedCount: 0,
		});
	});
});
