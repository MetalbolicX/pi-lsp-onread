import type { Freshness, Snapshot } from "./types.js";

export class DiagnosticsStore {
	private readonly snapshots = new Map<string, Snapshot>();
	private readonly baselines = new Map<string, Snapshot>();

	record(snapshot: Snapshot): void {
		const key = this.key(snapshot.serverId, snapshot.uri);
		const previous = this.snapshots.get(key);
		if (previous?.version !== null && previous?.version !== undefined
			&& (snapshot.version === null || snapshot.version < previous.version)) return;
		if (previous !== undefined) this.baselines.set(key, previous);
		this.snapshots.set(key, snapshot);
	}

	get(serverId: string, uri: string): Snapshot | undefined {
		return this.snapshots.get(this.key(serverId, uri));
	}

	baseline(serverId: string, uri: string): Snapshot | undefined {
		return this.baselines.get(this.key(serverId, uri));
	}

	has(serverId: string, uri: string): boolean {
		return this.snapshots.has(this.key(serverId, uri));
	}

	entries(): Snapshot[] {
		return [...this.snapshots.values()];
	}

	private key(serverId: string, uri: string): string {
		return JSON.stringify([serverId, uri]);
	}
}

export function freshnessOf(snapshot: Snapshot, currentVersion: number): Freshness {
	if (snapshot.version === null) return "unknown";
	if (snapshot.version === currentVersion) return "current";
	return snapshot.version < currentVersion ? "stale" : "unknown";
}
