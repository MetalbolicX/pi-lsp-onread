# Feature: scorecard

Roadmap **T3.2** — turn-end observational diagnostic scorecard. T3.1 (prewarm)
is merged to `main`.

## Objective

When explicitly enabled, append one bounded, observational scorecard entry at
the end of an agent turn summarizing diagnostic state for documents the turn
edited — severity counts, freshness-gated deltas against each document's
baseline, honest caps. Default **off** (user decision 2026-10-05: opt-in with
`"scorecard": true`). The entry is display-only session data: never sent to
model context, never triggers another run.

## Authority

Roadmap tier 3 item 2 (memory obs 11426): "non-looping turn-end observational
diagnostic scorecard dependent on baseline freshness". Pi extension docs:
`agent_settled` is final and notification-only; `pi.appendEntry()` persists
non-context session data; entry renderers display custom stored content in the
transcript. User chose default **Off** when config omits the flag.

## Resolved design decisions

1. **Default off**: top-level `scorecard?: boolean` (omitted/false ⇒ no
   scorecard ever). Threaded through `SourceConfig`, `ConfigLayer`
   (`Pick<SourceConfig,"lsp"|"diagnostics">` — merge is fixed-shape and MUST
   thread the key), `mergeConfig` return, schema top level, and
   `validateEffectiveConfig` boolean check.
2. **Event**: `pi.on("agent_settled", ...)` only — final, notification-only.
   The handler returns `undefined`; no continuation, no `ctx` mutation,
   nothing fed to the model. Non-looping by construction.
3. **Surface**: `pi.appendEntry({customType:"lsp-scorecard", data})` with a
   `registerEntryRenderer` registered at factory time (guarded by
   `typeof pi.registerEntryRenderer === "function"` for test fakes).
4. **Turn activity**: extension-closure recorder collecting `(serverId, uri)`
   pairs from edit/write activations (reads excluded — scorecard reports
   diagnostic consequences of the turn's writes). Cleared after each emitted
   scorecard. `disposed` gate everywhere.
5. **Scorecard computation** (pure module, store is a reader): per document —
   severity counts computed from snapshot items; baseline presence;
   `freshnessOf(snapshot, currentVersion)`; when baseline exists AND freshness
   is `current`, `computeDelta(baseline, current)` delta summary
   (`newlyObserved`, `resolved`, `unchangedCount`); `stale`/`unknown`
   freshness ⇒ label honestly, NO delta claims. Bounded with policy-style
   caps (`maxItems`, `maxChars`) and truncation markers.
6. **Freshness truth**: `currentVersion` read from live pooled clients; absent
   or pooled-out client ⇒ `unknown`. Never claim fresh on the baseline alone.
7. **No semantic changes**: store/delta/activation untouched; scorecard only
   reads. Empty turn (no edit activity) ⇒ no entry.

## Tasks

### S1 — Config surface: top-level scorecard flag (test-first)
- [ ] RED: scorecard key dropped by merge today; non-boolean accepted today
- [ ] GREEN: schema top-level `scorecard` boolean; `SourceConfig.scorecard?`;
      `ConfigLayer` + `mergeConfig` threading; validate boolean check
      (`/scorecard: must be a boolean`); merge layering + omitted-keeps-off
      regressions; load accepts true / rejects `"yes"`
- Route: delegated (gentle-ai-worker).

### S2 — Pure scorecard module (test-first)
- [ ] RED: module absent
- [ ] GREEN: `src/diagnostics/scorecard.ts` `computeScorecard(...)` per design:
      severity counts; baseline presence; freshness gating; delta only when
      current; honest stale/unknown labels; caps + truncation markers;
      empty-input ⇒ empty result
- [ ] Tests: counts correct across severities; stale baseline ⇒ no delta
      claims; unknown version ⇒ unknown; caps truncate with marker; baseline
      absent ⇒ counts only
- Route: delegated (gentle-ai-worker).

### S3 — Turn recorder + agent_settled hook + renderer (test-first)
- [ ] RED: no `agent_settled` handler; no entry appended
- [ ] GREEN: extension closure records edit/write-activated pairs (reads
      excluded); `agent_settled` computes via S2 and `appendEntry`s once;
      returns `undefined`; disabled when flag off/absent; `disposed` gates;
      recorder cleared after emit; renderer registered (typeof-guarded)
- [ ] Hook tests with a local fake Pi API (on/appendEntry/
      registerEntryRenderer captures): registered once; appends exactly one
      entry per settle with edit activity; nothing when disabled, disposed,
      or no edit activity; returns undefined
- [ ] Checks: typecheck, lint, full suite, build, `git diff --check`
- Route: delegated (gentle-ai-worker).

### S4 — README
- [ ] Document `scorecard` (default false) in the diagnostics section.
- Route: parent (docs).

## Non-goals

- T3.3 tool_call preflight (separate feature).
- Model-visible summaries or continuations of any kind; per-turn snapshot
  history beyond the store's existing baseline; config watching; scorecard
  persistence across sessions; changes to store/delta/activation semantics.

## Constraints

- Baseline: `main` @ `20bf3b6`; 418 tests / 43 files green.
- Branch `feature/scorecard` off `main` before the first write.
- Test-first per task (RED observed before GREEN); record evidence below.
- Per-task work-unit commit (Conventional Commit), identity recorded here;
  ~400 authored changed lines advisory.
- Workers never commit; parent reviews hunks, verifies via `gentle-ai-verify`,
  and commits.
- RDD: slice review at close with explicit committed base
  (`20bf3b62e7012ce3a324051ef311385ad6ec7845` full SHA).
- Merge/push/PR remain user decisions.

## Progress log

- 2026-10-05: authorized (user "continue" after T3.1 merge; default-Off
  confirmed via question). Design inputs scouted; mechanism locked
  (`agent_settled` + `appendEntry` + renderer). Branch created. S1–S3
  delegated.

## Review record

- (pending)
