import { computeDelta } from "./delta.js";
import { freshnessOf, type DiagnosticsStore } from "./store.js";
import type { DiagnosticItem, Freshness } from "./types.js";

export interface ScorecardDocumentInput {
	serverId: string;
	uri: string;
	currentVersion: number | null | undefined;
}

export interface ScorecardDocument {
	serverId: string;
	uri: string;
	counts: { error: number; warning: number; information: number; hint: number };
	baseline: boolean;
	freshness: Freshness;
	delta?: { newlyObserved: number; resolved: number; unchangedCount: number };
}

export interface Scorecard {
	documents: ScorecardDocument[];
	truncationMarker?: string;
}

export function computeScorecard(input: {
	store: DiagnosticsStore;
	documents: ScorecardDocumentInput[];
	policy: { maxItems: number; maxChars: number };
}): Scorecard {
	const documents: ScorecardDocument[] = [];
	for (const document of input.documents) {
		const snapshot = input.store.get(document.serverId, document.uri);
		if (!snapshot) continue;
		const counts = { error: 0, warning: 0, information: 0, hint: 0 };
		for (const item of snapshot.items) {
			const severity = severityName(item);
			if (severity) counts[severity]++;
		}
		const baselineSnapshot = input.store.baseline(document.serverId, document.uri);
		const freshness: Freshness = document.currentVersion === null || document.currentVersion === undefined
			? "unknown"
			: freshnessOf(snapshot, document.currentVersion);
		const scorecardDocument: ScorecardDocument = {
			serverId: document.serverId,
			uri: document.uri,
			counts,
			baseline: baselineSnapshot !== undefined,
			freshness,
		};
		if (baselineSnapshot && freshness === "current") {
			const delta = computeDelta(baselineSnapshot, snapshot);
			scorecardDocument.delta = {
				newlyObserved: delta.newlyObserved.length,
				resolved: delta.resolved.length,
				unchangedCount: delta.unchangedCount,
			};
		}
		documents.push(scorecardDocument);
	}
	if (documents.length === 0) return { documents: [] };

	const bounded = documents.slice(0, Math.max(0, input.policy.maxItems));
	let omitted = documents.length - bounded.length;
	let result: Scorecard = { documents: bounded };
	if (omitted > 0) result.truncationMarker = marker(omitted);
	while (JSON.stringify(result).length > Math.max(0, input.policy.maxChars) && bounded.length > 0) {
		bounded.pop();
		omitted++;
		result = { documents: bounded, truncationMarker: marker(omitted) };
	}
	if (JSON.stringify(result).length > Math.max(0, input.policy.maxChars)) {
		result = { documents: [], truncationMarker: "…" };
	}
	return result;
}

function severityName(item: DiagnosticItem): keyof ScorecardDocument["counts"] | undefined {
	return ({ 1: "error", 2: "warning", 3: "information", 4: "hint" } as const)[item.severity as 1 | 2 | 3 | 4];
}

function marker(count: number): string {
	return `… ${count} document${count === 1 ? "" : "s"} truncated`;
}
