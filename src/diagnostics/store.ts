import type { Freshness, Snapshot } from "./types.js";

export class DiagnosticsStore {
	private readonly snapshots = new Map<string, Snapshot>();

	record(snapshot: Snapshot): void {
		this.snapshots.set(this.key(snapshot.serverId, snapshot.uri), snapshot);
	}

	get(serverId: string, uri: string): Snapshot | undefined {
		return this.snapshots.get(this.key(serverId, uri));
	}

	has(serverId: string, uri: string): boolean {
		return this.snapshots.has(this.key(serverId, uri));
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
