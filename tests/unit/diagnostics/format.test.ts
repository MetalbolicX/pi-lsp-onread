import { describe, expect, it } from "vitest";
import { apply } from "../../../src/diagnostics/policy.js";
import { formatForEdit, formatForRead } from "../../../src/diagnostics/format.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

const snapshot: Snapshot = {
	serverId: "ts",
	uri: "file:///workspace/a.ts",
	version: 2,
	receivedAt: 10,
	items: [{ range: { start: { line: 3, character: 4 }, end: { line: 3, character: 5 } }, severity: 1, source: "ts", message: "Unexpected token" }],
};
const policy = { severities: ["error", "warning", "information", "hint"] as const, maxItems: 10, maxChars: 1000 };
const results = apply({
	snapshots: [
		{ serverId: "ts", currentVersion: 2, snapshot },
		{ serverId: "css", currentVersion: 1 },
	],
	policy,
});

describe("diagnostics formatting", () => {
	it("renders pending servers and deterministic freshness-aware diagnostics", () => {
		const output = formatForRead({ uri: snapshot.uri, results });
		expect(output).toContain("a.ts");
		expect(output).toContain("pending — no diagnostics received yet from css");
		expect(output).toContain("error 4:5 ts: Unexpected token");
		expect(output).toContain("fresh: current");
		expect(formatForRead({ uri: snapshot.uri, results })).toBe(output);
	});

	it("does not imply clean compilation when there are no diagnostics", () => {
		const empty = apply({ snapshots: [{ serverId: "ts", currentVersion: 2, snapshot: { ...snapshot, items: [] } }], policy });
		const output = formatForRead({ uri: snapshot.uri, results: empty });
		expect(output).toContain("no diagnostics received");
		expect(output).not.toMatch(/no errors|clean compilation|compiled successfully/i);
	});

	it("includes edit wait outcome", () => {
		const output = formatForEdit({ uri: snapshot.uri, results, waited: true, waitedMs: 125 });
		expect(output).toContain("waited 125ms; freshest available attached");
	});

	it("renders stale age and policy drop counts", () => {
		const stale = apply({
			snapshots: [{ serverId: "ts", currentVersion: 5, snapshot: { ...snapshot, version: 2 } }],
			policy: { ...policy, maxItems: 0 },
		});
		const output = formatForRead({ uri: snapshot.uri, results: stale });
		expect(output).toContain("stale (3 versions behind)");
		expect(output).toContain("Dropped 1 items");
	});
});
