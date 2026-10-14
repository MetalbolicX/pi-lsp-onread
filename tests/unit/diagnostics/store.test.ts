import { describe, expect, it } from "vitest";
import { DiagnosticsStore, freshnessOf } from "../../../src/diagnostics/store.js";
import type { Snapshot } from "../../../src/diagnostics/types.js";

const snapshot = (version: number | null, message: string): Snapshot => ({
  serverId: "ts",
  uri: "file:///a.ts",
  version,
  receivedAt: 1,
  items: [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 1,
      message,
    },
  ],
});

describe("diagnostics store", () => {
  it("keeps the latest snapshot per server and URI", () => {
    const store = new DiagnosticsStore();
    store.record(snapshot(1, "old"));
    store.record(snapshot(2, "new"));
    expect(store.get("ts", "file:///a.ts")?.items[0]?.message).toBe("new");
    expect(store.has("ts", "file:///a.ts")).toBe(true);
    expect(store.has("other", "file:///a.ts")).toBe(false);
  });

  it("enumerates current snapshots without exposing mutable store state", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(1, "first");
    const second = { ...snapshot(1, "second"), uri: "file:///b.ts" };
    store.record(first);
    store.record(second);

    const entries = store.entries();
    expect(entries).toEqual([first, second]);
    entries.pop();
    expect(store.entries()).toEqual([first, second]);
  });

  it("has no baseline after the first accepted snapshot", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(1, "first");

    store.record(first);

    expect(store.baseline("ts", "file:///a.ts")).toBeUndefined();
  });

  it("retains the previous accepted snapshot as baseline", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(1, "first");
    const second = snapshot(2, "second");

    store.record(first);
    store.record(second);

    expect(store.baseline("ts", "file:///a.ts")).toBe(first);
  });

  it("leaves current and baseline unchanged when an older record is rejected", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(1, "first");
    const current = snapshot(3, "current");

    store.record(first);
    store.record(current);
    store.record(snapshot(2, "rejected"));

    expect(store.get("ts", "file:///a.ts")).toBe(current);
    expect(store.baseline("ts", "file:///a.ts")).toBe(first);
  });

  it("accepts a versioned record after a null-version snapshot and retains it", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(null, "first");
    const second = snapshot(1, "second");

    store.record(first);
    store.record(second);

    expect(store.get("ts", "file:///a.ts")).toBe(second);
    expect(store.baseline("ts", "file:///a.ts")).toBe(first);
  });

  it("keeps baselines independent for each server and URI", () => {
    const store = new DiagnosticsStore();
    const firstA = snapshot(1, "a-first");
    const secondA = snapshot(2, "a-second");
    const firstB = { ...snapshot(1, "b-first"), uri: "file:///b.ts" };
    const secondB = { ...snapshot(2, "b-second"), uri: "file:///b.ts" };
    const firstOtherServer = { ...snapshot(1, "other-server-first"), serverId: "other" };
    const secondOtherServer = { ...snapshot(2, "other-server-second"), serverId: "other" };

    for (const item of [firstA, secondA, firstB, secondB, firstOtherServer, secondOtherServer])
      store.record(item);

    expect(store.baseline("ts", "file:///a.ts")).toBe(firstA);
    expect(store.baseline("ts", "file:///b.ts")).toBe(firstB);
    expect(store.baseline("other", "file:///a.ts")).toBe(firstOtherServer);
  });

  it("advances the baseline to the immediately previous accepted snapshot", () => {
    const store = new DiagnosticsStore();
    const first = snapshot(1, "first");
    const second = snapshot(2, "second");
    const third = snapshot(3, "third");

    store.record(first);
    store.record(second);
    expect(store.baseline("ts", "file:///a.ts")).toBe(first);

    store.record(third);
    expect(store.get("ts", "file:///a.ts")).toBe(third);
    expect(store.baseline("ts", "file:///a.ts")).toBe(second);
  });

  it("classifies current, stale, and unknown versions", () => {
    expect(freshnessOf(snapshot(4, ""), 4)).toBe("current");
    expect(freshnessOf(snapshot(3, ""), 4)).toBe("stale");
    expect(freshnessOf(snapshot(null, ""), 4)).toBe("unknown");
  });

  it("records a non-empty pull over a push snapshot with pull origin", () => {
    const store = new DiagnosticsStore();
    const pushed = { ...snapshot(1, "pushed"), origin: "push" as const };
    store.record(pushed);

    expect(store.recordPull(snapshot(1, "pulled"))).toBe("recorded");
    expect(store.get("ts", "file:///a.ts")?.origin).toBe("pull");
    expect(store.get("ts", "file:///a.ts")?.items[0]?.message).toBe("pulled");
  });

  it("preserves a push snapshot when an empty pull report arrives", () => {
    const store = new DiagnosticsStore();
    const pushed = { ...snapshot(1, "pushed"), origin: "push" as const };
    store.record(pushed);

    expect(store.recordPull({ ...snapshot(1, ""), items: [] })).toBe("preserved");
    expect(store.get("ts", "file:///a.ts")).toBe(pushed);
    expect(store.baseline("ts", "file:///a.ts")).toBeUndefined();
  });

  it("replaces a pull snapshot when an empty pull report arrives", () => {
    const store = new DiagnosticsStore();
    store.recordPull(snapshot(1, "first pull"));

    expect(store.recordPull({ ...snapshot(1, ""), items: [] })).toBe("recorded");
    expect(store.get("ts", "file:///a.ts")?.items).toEqual([]);
  });

  it("records the first empty pull when no snapshot exists yet", () => {
    const store = new DiagnosticsStore();

    expect(store.recordPull({ ...snapshot(1, ""), items: [] })).toBe("recorded");
    expect(store.has("ts", "file:///a.ts")).toBe(true);
    expect(store.get("ts", "file:///a.ts")?.origin).toBe("pull");
  });

  it("documents F9: an empty push at the same version replaces a rustc-bearing push", () => {
    const store = new DiagnosticsStore();
    store.record({
      ...snapshot(1, "E0425: cannot find value `undefined_helper`"),
      origin: "push" as const,
    });
    store.record({ ...snapshot(1, ""), items: [], origin: "push" as const });

    // Last push wins: a native empty clear erases the flycheck items at equal version —
    // the transient loss recorded as finding F9. The error snapshot is retained as baseline.
    expect(store.get("ts", "file:///a.ts")?.items).toHaveLength(0);
    expect(store.baseline("ts", "file:///a.ts")?.items[0]?.message).toBe(
      "E0425: cannot find value `undefined_helper`",
    );
  });

  it("records a version-advanced empty push as a genuine clear", () => {
    const store = new DiagnosticsStore();
    store.record({
      ...snapshot(1, "E0425: cannot find value `undefined_helper`"),
      origin: "push" as const,
    });
    store.record({ ...snapshot(2, ""), items: [], origin: "push" as const });

    expect(store.get("ts", "file:///a.ts")?.version).toBe(2);
    expect(store.get("ts", "file:///a.ts")?.items).toHaveLength(0);
  });
});
