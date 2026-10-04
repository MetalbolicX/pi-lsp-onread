import type { DiagnosticItem, Snapshot } from "./types.js";

export interface DiagnosticDelta {
	newlyObserved: DiagnosticItem[];
	resolved: DiagnosticItem[];
	unchangedCount: number;
}

export function computeDelta(baseline: Snapshot, current: Snapshot): DiagnosticDelta {
	if (baseline.serverId !== current.serverId || baseline.uri !== current.uri) {
		throw new Error(
			`Cannot compare snapshots for ${JSON.stringify([baseline.serverId, baseline.uri])} and ${JSON.stringify([current.serverId, current.uri])}`,
		);
	}

	const matchedBaseline = new Array<boolean>(baseline.items.length).fill(false);
	const newlyObserved: DiagnosticItem[] = [];
	let unchangedCount = 0;

	for (const currentItem of current.items) {
		const matchIndex = baseline.items.findIndex((baselineItem, index) =>
			!matchedBaseline[index] && itemsMatch(baselineItem, currentItem));
		if (matchIndex === -1) {
			newlyObserved.push(currentItem);
		} else {
			matchedBaseline[matchIndex] = true;
			unchangedCount++;
		}
	}

	const resolved = baseline.items.filter((_item, index) => !matchedBaseline[index]);
	return { newlyObserved, resolved, unchangedCount };
}

function itemsMatch(left: DiagnosticItem, right: DiagnosticItem): boolean {
	return left.severity === right.severity
		&& left.code === right.code
		&& left.range.start.line === right.range.start.line
		&& left.range.start.character === right.range.start.character
		&& left.range.end.line === right.range.end.line
		&& left.range.end.character === right.range.end.character
		&& left.message === right.message;
}
