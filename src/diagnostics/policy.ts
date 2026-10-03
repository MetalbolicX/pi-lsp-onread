import { freshnessOf } from "./store.js";
import type { DiagnosticItem, DiagnosticSeverity, Policy, PolicyItem, PolicyResults, SnapshotInput } from "./types.js";

const severityNames: Record<number, DiagnosticSeverity> = {
	1: "error",
	2: "warning",
	3: "information",
	4: "hint",
};

export function apply(input: { snapshots: SnapshotInput[]; policy: Policy }): PolicyResults {
	const included = new Set(input.policy.severities);
	const all: PolicyItem[] = [];
	let droppedItems = 0;
	let droppedCharacters = 0;

	for (const entry of input.snapshots) {
		if (!entry.snapshot) continue;
		const freshness = freshnessOf(entry.snapshot, entry.currentVersion);
		for (const item of entry.snapshot.items) {
			if (!included.has(severityNames[item.severity] as DiagnosticSeverity)) {
				droppedItems += 1;
				droppedCharacters += itemLine(item, entry.serverId).length;
				continue;
			}
			all.push({
				...item,
				serverId: entry.serverId,
				freshness,
				versionsBehind: freshness === "stale" && entry.snapshot.version !== null
					? entry.currentVersion - entry.snapshot.version
					: null,
			});
		}
	}

	all.sort((a, b) => a.severity - b.severity
		|| a.range.start.line - b.range.start.line
		|| a.range.start.character - b.range.start.character
		|| a.serverId.localeCompare(b.serverId));

	const items = all.slice(0, Math.max(0, input.policy.maxItems));
	for (const item of all.slice(items.length)) {
		droppedItems += 1;
		droppedCharacters += itemLine(item, item.serverId).length;
	}

	let marker = droppedItems > 0 ? markerFor(droppedItems) : undefined;
	while (items.length > 0 && renderedLength(items) + (marker ? marker.length + 1 : 0) > Math.max(0, input.policy.maxChars)) {
		const removed = items.pop();
		if (!removed) break;
		droppedItems += 1;
		droppedCharacters += itemLine(removed, removed.serverId).length;
		marker = markerFor(droppedItems);
	}

	return {
		snapshots: input.snapshots,
		items,
		dropped: { items: droppedItems, characters: droppedCharacters },
		...(marker ? { truncationMarker: marker } : {}),
	};
}

export function itemLine(item: DiagnosticItem, serverId: string): string {
	const severity = severityNames[item.severity] ?? "unknown";
	const source = item.source ?? serverId;
	return `${severity} ${item.range.start.line + 1}:${item.range.start.character + 1} ${source}: ${item.message}`;
}

function renderedLength(items: PolicyItem[]): number {
	return items.reduce((length, item, index) => length + itemLine(item, item.serverId).length + (index > 0 ? 1 : 0), 0);
}

function markerFor(count: number): string {
	return `+${count} more items truncated`;
}
