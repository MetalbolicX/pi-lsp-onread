import type { Freshness, Snapshot } from "./types.js";

export class DiagnosticsStore {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly baselines = new Map<string, Snapshot>();

  record(snapshot: Snapshot): void {
    const key = this.key(snapshot.serverId, snapshot.uri);
    const previous = this.snapshots.get(key);
    if (
      previous?.version !== null &&
      previous?.version !== undefined &&
      (snapshot.version === null || snapshot.version < previous.version)
    )
      return;
    if (previous !== undefined) this.baselines.set(key, previous);
    this.snapshots.set(key, snapshot);
  }

  /**
   * Record a pull-origin snapshot. An EMPTY pull report is authoritative only when there is no
   * snapshot yet or the latest snapshot is also pull-origin: a server's pull view can omit the
   * results its push path delivers (rust-analyzer's flycheck diagnostics), so an empty pull must
   * never erase a push snapshot. Non-empty pulls always record. Returns whether the report was
   * stored or the existing snapshot was preserved.
   */
  recordPull(snapshot: Snapshot): "recorded" | "preserved" {
    const key = this.key(snapshot.serverId, snapshot.uri);
    const previous = this.snapshots.get(key);
    if (snapshot.items.length === 0 && previous !== undefined && previous.origin !== "pull")
      return "preserved";
    this.record({ ...snapshot, origin: "pull" });
    return "recorded";
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
