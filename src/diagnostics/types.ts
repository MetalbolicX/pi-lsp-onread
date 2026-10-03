export interface Position {
	line: number;
	character: number;
}

export interface DiagnosticRange {
	start: Position;
	end: Position;
}

export interface DiagnosticItem {
	range: DiagnosticRange;
	severity: number;
	code?: number | string;
	source?: string;
	message: string;
}

export interface Snapshot {
	serverId: string;
	uri: string;
	version: number | null;
	items: DiagnosticItem[];
	receivedAt: number;
}

export type Freshness = "current" | "stale" | "unknown";

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface SnapshotInput {
	serverId: string;
	currentVersion: number;
	snapshot?: Snapshot;
}

export interface Policy {
	severities: readonly DiagnosticSeverity[];
	maxItems: number;
	maxChars: number;
}

export interface PolicyItem extends DiagnosticItem {
	serverId: string;
	freshness: Freshness;
	versionsBehind: number | null;
}

export interface DroppedCounts {
	items: number;
	characters: number;
}

export interface PolicyResults {
	snapshots: SnapshotInput[];
	items: PolicyItem[];
	dropped: DroppedCounts;
	truncationMarker?: string;
}
