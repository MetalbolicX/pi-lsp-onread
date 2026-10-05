# Feature: preflight

Roadmap **T3.3** — tool_call preflight. The final Tier 3 item. T3.1 (prewarm)
and T3.2 (scorecard) are complete; scorecard sits unmerged at
`feature/scorecard` @ `9b4a0c5`.

## Objective

Before an `edit`/`write` tool call executes, check the target file's current
diagnostics. Default mode is **advisory** (roadmap-fixed): the call always
runs, and the post-edit feedback gains one bounded line distinguishing
pre-existing fresh errors. Opt-in mode **block** additionally refuses the call
— only with actionable, current evidence (fresh diagnostics showing
error-severity items) — and never on unknown, stale, missing, or failed
diagnostics. `"off"` disables everything.

## Authority

Roadmap tier 3 item 3 (memory obs 11426): "tool_call preflight default
advisory, opt-in blocking only with actionable current evidence, never block
on unknown/stale diagnostics/server failure". Pi contract (types.d.ts:894-1061,
extensions.md:169-178): `tool_call` handler returns `{ block?: boolean,
reason?: string, terminate?: boolean }`; input mutation is the only other
effect (NOT used); a **throwing handler blocks the tool as a fail-safe**, so
the handler must never throw. Advisory surfacing therefore happens through the
existing `tool_result` combine path.

## Resolved design decisions

1. **Config**: top-level `preflight?: "off" | "advisory" | "block"`, default
   `"advisory"` when absent (roadmap fixes the default; `"off"` is the
   escape). Enum validated (`/preflight: must be one of "off", "advisory",
   "block"`), threaded through the fixed-shape merge like `scorecard`.
2. **Pure check** `src/diagnostics/preflight.ts`: `preflightCheck({store,
   servers, uri, currentVersion})` → outcome ∈ `no-data` (no snapshot) |
   `unknown` (no live version) | `stale` | `clear` (current, zero errors) |
   `errors` (current, ≥1 error-severity item), with `errorCount` and
   `freshness`. Never invents freshness; severity 1 only counts as errors.
3. **Never spawns**: preflight runs only when a runtime session already
   exists (`sessionPromise` set). No session yet ⇒ no data ⇒ no advisory, no
   block. It never creates sessions, starts servers, or opens documents.
4. **Advisory mode** (default): at `tool_call` (edit/write with string
   `input.path`, resolved against `ctx.cwd`), compute the check for matched
   servers and stash bounded data keyed by resolved path. The existing
   `tool_result` edit wrapper appends ONE bounded line when fresh errors
   pre-existed (e.g. "note: 2 error(s) pre-existed before this edit"). Stash
   entries are consumed on use and the map is size-capped.
5. **Block mode** (opt-in): same check; return `{ block: true, reason }` ONLY
   for outcome `errors` with `errorCount > 0`. Reason is bounded and
   actionable (path, count, up to 3 truncated messages). `no-data` /
   `unknown` / `stale` / server failure ⇒ never block (fail-open). Reads and
   non-edit tools are never touched; input is never mutated.
6. **Handler never throws**: the whole handler body is fail-safe; any error
   logs via `logError` and returns `undefined` (a thrown handler would block
   the edit — unacceptable).
7. **No per-call user confirmation** (`ctx.ui.confirm` not used): blocking is
   a config decision, not a runtime prompt. No `terminate` hints.

## Tasks

### F1 — Config surface: top-level preflight enum (test-first)
- [x] RED observed: preflight dropped by merge; invalid values accepted
- [x] GREEN: schema enum `off|advisory|block`; types on all three config
      interfaces; `ConfigLayer` + `mergeConfig` threading (absent stays
      absent ⇒ advisory at consumption); validate enum check
      (`/preflight: must be one of "off", "advisory", "block"`); layering
      + absent-default regressions
- Route: delegated (gentle-ai-worker).

### F2 — Pure preflight check (test-first)
- [x] RED observed: module absent
- [x] GREEN: `preflightCheck` — five outcomes with precedence errors >
      stale > unknown > no-data > clear; errorCount severity-1 only and
      only from current servers; per-server currentVersion (undefined OR
      null-version snapshot ⇒ unknown); `preflightMessages` ≤3 × 120 chars
- [x] Tests: each outcome, severity filtering, multi-server aggregation
- Route: delegated (gentle-ai-worker).

### F3 — Extension wiring: tool_call + advisory line + block (test-first)
- [x] RED observed: no `tool_call` handler; no advisory line
- [x] GREEN: handler fail-safe (try/catch → logError → undefined; never
      throws), never spawns (sessionPromise gate), edit/write + string path
      + matched-servers gates, pooled-client version lookup, block ONLY on
      current errors with ≤600-char actionable reason, advisory stash
      (size-capped 100, consumed at edit tool_result with ONE bounded
      note), off short-circuits, input never mutated
- [x] **Parent-found defect (RED→GREEN)**: a failed edit left its stashed
      note in place; a later successful edit of the same path after the
      diagnostics cleared would attach the stale note and falsely claim
      pre-existing errors. Fix: refresh-or-clear the note on EVERY matched
      edit/write tool_call. Regression test observes the false claim fail,
      then pass
- [x] Checks: 447 tests / 47 files passing; lint 0; typecheck clean; build
      clean; `git diff --check` clean (gentle-ai-verify, mutation-clean)
- Route: delegated (gentle-ai-worker) + parent fix

### F4 — README
- [x] "Edit preflight" section: modes, default advisory, fail-open
      guarantees, bounded reasons
- Route: parent (docs).

## Non-goals

- Per-call user confirmation prompts; severity thresholds beyond errors;
  blocking reads; mutating tool inputs; integration with the scorecard
  entry; server spawn-on-preflight; changes to activation/store semantics.

## Constraints

- Baseline: `feature/scorecard` @ `9b4a0c5` (main @ `20bf3b6`); 430 tests /
  45 files green. Branch `feature/preflight` stacked on `feature/scorecard`
  (chain pattern; slice review base = `9b4a0c5`).
- Test-first per task (RED observed before GREEN); record evidence below.
- Per-task work-unit commit (Conventional Commit), identity recorded here;
  ~400 authored changed lines advisory.
- Workers never commit; parent reviews hunks, verifies via `gentle-ai-verify`,
  and commits.
- RDD: slice review at close with explicit committed base
  (`9b4a0c5c55636db3d06f3c56d4794598a5a56829` full SHA).
- Merge/push/PR remain user decisions.

## Progress log

- 2026-10-05: authorized (user "continue"). Pi tool_call contract verified
  from types.d.ts (toolCallId; `{block, reason, terminate}`; throwing
  handler blocks fail-safe). Design locked. Branch created. F1–F3 delegated.
- 2026-10-05: F1–F3 complete via one worker task (446 tests reported);
  parent spot-check found the stale-note truthfulness defect and fixed it
  RED→GREEN inline (447 tests final). Work units: 05a8d83 (config), eb8d74d
  (pure check), 4f1c317 (wiring + regression), abff916 (README, parent).

## Review record

- Slice review APPROVED — lineage `review-f7c98ab618b61d61`, medium tier
  (`configuration_change` on `schema/lsp.schema.json`), review-reliability
  lens, 12 paths / 459 lines, correction budget 200, base
  `9b4a0c5c55636db3d06f3c56d4794598a5a56829` (committedOnly). Reviewer
  forecast (1 host-relay run) acknowledged; approved on the last admitted
  event; acknowledgement burned (consumed revision `sha256:15b39668…`).
  One NON-BLOCKING informational advisory: R3-001 reliability WARNING at
  `src/extension.ts:102-104` (preflightNotes stash-cap eviction with
  non-null assertion; advisory-ledger item for later work — does not
  reopen this review). Delivery: ordinary repository policy.
