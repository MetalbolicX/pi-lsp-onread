import { describe, expect, it } from "vitest";
import { apply } from "../../../src/diagnostics/policy.js";
import { formatForEdit, formatForRead } from "../../../src/diagnostics/format.js";
import type { PolicyItem, Snapshot } from "../../../src/diagnostics/types.js";

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

	it("renders delta summary, full newly observed items, and brief resolved items in order", () => {
		const newlyObserved: PolicyItem[] = [{
			range: { start: { line: 7, character: 1 }, end: { line: 7, character: 2 } },
			severity: 2,
			source: "ts",
			message: "New issue",
			serverId: "ts",
			freshness: "current",
			versionsBehind: null,
		}];
		const resolved: PolicyItem[] = [{
			range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
			severity: 1,
			message: "Resolved issue",
			serverId: "ts",
			freshness: "current",
			versionsBehind: null,
		}];
		const output = formatForEdit({
			uri: snapshot.uri,
			results,
			waited: true,
			waitedMs: 125,
			delta: { serverId: "ts", newlyObserved, resolved, unchangedCount: 4 },
		});
		const lines = output.split("\n");
		expect(lines).toContain("Delta since previous snapshot: 1 newly observed, 1 resolved, 4 unchanged.");
		expect(lines).toContain("Newly observed since previous snapshot:");
		expect(lines).toContain("warning 8:2 ts: New issue");
		expect(lines).toContain("Resolved since previous snapshot:");
		expect(lines).toContain("- Resolved issue");
		expect(lines.indexOf("ts: fresh: current")).toBeLessThan(lines.indexOf("Delta since previous snapshot: 1 newly observed, 1 resolved, 4 unchanged."));
		expect(lines.indexOf("Delta since previous snapshot: 1 newly observed, 1 resolved, 4 unchanged.")).toBeLessThan(lines.indexOf("Newly observed since previous snapshot:"));
		expect(lines.indexOf("Newly observed since previous snapshot:")).toBeLessThan(lines.indexOf("warning 8:2 ts: New issue"));
		expect(lines.indexOf("warning 8:2 ts: New issue")).toBeLessThan(lines.indexOf("Resolved since previous snapshot:"));
		expect(lines.indexOf("- Resolved issue")).toBeLessThan(lines.indexOf("waited 125ms; freshest available attached"));
		expect(output).toContain("since previous snapshot");
		expect(output).not.toContain("introduced by this edit");
	});

	it("truncates resolved messages to 120 characters including the ellipsis", () => {
		const message = "x".repeat(130);
		const resolved: PolicyItem[] = [{
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			severity: 1,
			message,
			serverId: "ts",
			freshness: "current",
			versionsBehind: null,
		}];
		const output = formatForEdit({ uri: snapshot.uri, results, waited: false, waitedMs: 0,
			delta: { serverId: "ts", newlyObserved: [], resolved, unchangedCount: 0 } });
		expect(output).toContain(`- ${"x".repeat(119)}…`);
		expect(output).not.toContain(`- ${message}`);
	});

	it("keeps delta-free edit output byte-identical and renders zero-delta summaries", () => {
		const withoutDelta = formatForEdit({ uri: snapshot.uri, results, waited: true, waitedMs: 125 });
		expect(withoutDelta).toBe([
			"Diagnostics for a.ts:",
			"ts: fresh: current",
			"pending — no diagnostics received yet from css",
			"error 4:5 ts: Unexpected token",
			"waited 125ms; freshest available attached",
		].join("\n"));
		const output = formatForEdit({ uri: snapshot.uri, results, waited: false, waitedMs: 0,
			delta: { serverId: "ts", newlyObserved: [], resolved: [], unchangedCount: 3 } });
		expect(output).toContain("Delta since previous snapshot: 0 newly observed, 0 resolved, 3 unchanged.");
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
