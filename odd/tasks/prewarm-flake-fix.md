# Feature: prewarm-flake-fix

Closes the prewarm `session_start` tick-race recorded in the final
disposition ledger (`hardening-ledger.md`, "prewarm session_start
flake" row): `tests/unit/runtime/prewarm.test.ts:137` asserts
`attempts === 1` after exactly one `setTimeout(0)` tick, but the
extension's `session_start` handler is fire-and-forget
(`src/extension.ts:87-96`, `void (async …)()`), so the spawn lands an
implementation-defined number of ticks later. Under worker contention
the single tick is sometimes not enough. Test-only fix; no product
change.

## Observed defect (RED evidence, verbatim from receipts)

- Closure-battery full-suite 3× hunt: green / **1 failed** / green
  (plus one earlier failure in the first battery rerun).
- Focused 10× stress of the file alone: **9 green / 1 failed in
  isolation** — the race is intrinsic, not load-only.
- Failure signature: `AssertionError: expected +0 to be 1` at
  `prewarm.test.ts:137` (`expect(attempts).toBe(1)`).

An intermittent race admits no deterministic RED on demand; the
observations above are the RED evidence. The fix strengthens the wait
strategy; the assertion itself is unchanged.

## Change

In the `triggers prewarm on session_start using ctx.cwd` test, replace

```ts
await new Promise((resolve) => setTimeout(resolve, 0));
expect(attempts).toBe(1);
```

with an outcome-based bounded poll:

```ts
await vi.waitFor(() => expect(attempts).toBe(1), {
  timeout: 2000,
  interval: 10,
});
```

plus the `vi` import. Same assertion, same expectation — the wait
becomes outcome-based instead of tick-count-based. This is the only
instance of the anti-pattern in the file: the other five tests await
`prewarmServers(...)` directly and have no opaque deferral.

## Boundaries

- Surfaces: `tests/unit/runtime/prewarm.test.ts` (wait strategy), this
  plan, and the `hardening-ledger.md` row amendment (disposition →
  fixed). No `src/` change; no assertion weakening; no other timeouts
  touched.
- Rollback: revert the single test hunk.

## Verification contract

GREEN evidence: focused stress of the file **≥20×, 0 failures** post-fix
(vs 1/10 pre-fix); bare suite 3× all green; lint, typecheck, format
clean. Product code untouched, so no behavior battery beyond the suite
is required.

## Acceptance

- [x] Focused stress ≥20×: **0 failures / 20** (run 18–20 shown
      verbatim: 6 passed each; counter `STRESS FAILURES: 0/20`).
- [x] Bare suite 3×: **all green — 509 passed | 21 skipped (530)**,
      49 files + 3 skipped, three consecutive runs.
- [x] lint (`oxlint`), typecheck (`tsc --noEmit`), format (`biome
      format`, "No fixes applied") all clean.
- [x] Ledger row dispositioned **fixed** with this evidence
      (`hardening-ledger.md`, prewarm session_start flake row).

Status: **complete pending assess/review per RDD.** The defect is
closed at its root: the wait is outcome-based, the assertion
unchanged, and 20× stress + 3× bare suite show no recurrence where the
pre-fix rate was 1/10 isolated and 2/5 full-suite. Commit: `f98f3fe`
(fix) + this closure record.

## Review record

- Post-implementation assess (committed range, base
  `1843c5f38c24084eaaca8ccbc630d1e15aed78d7`, committedOnly):
  **medium risk** (`executable_change`:
  `tests/unit/runtime/prewarm.test.ts`), 3 paths / 93 lines,
  **reviewDue: false (`under_budget`)** — writer self-verification
  stands (focused 6/6 after the edit; stress 0/20; bare 3× 509/530;
  lint/tsc/format clean). No native review started per entry rule; if
  a later reminder claims this target, the tight base above applies.
  Commits: `3fc7cb2` (plan) + `f98f3fe` (fix) + `509ab58`
  (disposition) + this record.
