# Feature: diagnostic-deltas (T1.1)

## Authority

- User: "Lets start implementing and use strict TDD" (after roadmap approving first slice: diagnostic baselines/deltas).
- Roadmap proposal: Engram observation 11426 (`odd/ai-facing-lsp-roadmap/proposal`).
- Scope locked to T1.1: baselines + deltas on the edit path. No pull diagnostics, no new tools, no config knobs in this feature.

## Goal

After an edit/write, the attached diagnostics report what **changed since the previous snapshot** — newly observed, resolved, and unchanged remaining — instead of repeating the full unchanged list every time. Read path stays unchanged.

## Design decisions (settled)

- **Baseline**: the previous accepted snapshot for the same `(serverId, uri)`, retained by the store when a newer snapshot is recorded.
- **Matching**: two items match when `severity`, `code`, `range` (line+character), and `message` are equal. Unmatched in current ⇒ newly observed; unmatched in baseline ⇒ resolved; matched ⇒ unchanged.
- **Wording is non-causal**: "newly observed since previous snapshot", "resolved since previous snapshot" — never "introduced/caused by this edit". Freshness labels (stale/pending/unknown) keep their existing meaning.
- **Edit output shape**: summary line (`N newly observed, M resolved, K unchanged`), full items for newly observed, one-line briefs for resolved, count only for unchanged. Existing policy caps (`maxItems`/`maxChars`) apply to the rendered output.
- **Fallback**: no baseline (first snapshot for that server+uri) ⇒ current full-list behavior, labeled as first observation.
- **Stale baseline or stale current**: delta is still computed from the freshest available vs. retained baseline; existing freshness lines already state staleness. No silence-is-clean claims anywhere.

## Non-goals

- Pull diagnostics, cross-file deltas, on-demand tools, symbols (later tiers).
- Any config/schema changes.
- Changing the read path, trust gating, or wait budget.

## Tasks

Strict TDD is mandatory for T1–T4: observe RED (failing test) before implementation, GREEN with the minimum change, then REFACTOR with checks green. Runner: `pnpm test` (vitest); focus with `pnpm vitest run <file>`.

| ID | Task | Route | Checks | Status |
| --- | --- | --- | --- | --- |
| T1 | Store retains previous snapshot as baseline on overwrite | delegated: gentle-ai-worker | RED/GREEN on `tests/unit/diagnostics/store.test.ts` | done |
| T2 | Delta computation module (newly observed / resolved / unchanged) | delegated: gentle-ai-worker | RED/GREEN on new `tests/unit/diagnostics/delta.test.ts` | done |
| T3 | Delta-aware `formatForEdit` with non-causal wording + caps | delegated: gentle-ai-worker | RED/GREEN on `tests/unit/diagnostics/format.test.ts` | done |
| T4 | Activation wires delta into edit/write path; read path unchanged; no-baseline fallback | delegated: gentle-ai-worker | RED/GREEN on `tests/unit/runtime/activation.test.ts` | pending |
| T5 | README diagnostics section documents delta output | inline (single mechanical file) | structural readback | pending |
| T6 | Full-suite close: test/lint/typecheck/build + assess | inline + verifier per RDD tier | all green | pending |

## Verification commands

- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

## Delivery strategy

`ask-on-risk` (default). Forecast: ~300 authored changed lines across T1–T5 incl. tests — under the ~400-line budget; single feature branch `feature/diagnostic-deltas`.

## Commit log (work-unit commits, evidence)

| Task | Commit | Notes |
| --- | --- | --- |
| T1 | 8abb578 | 6 tests RED→GREEN; focused 8/8; typecheck clean; parent spot check green |
| T2 | 5895e8b | 13 tests RED→GREEN; focused 13/13; typecheck clean; parent spot check green |
| T3 | 6105a9a | 7 tests RED→GREEN; focused 7/7; typecheck clean; parent spot check green |

## Route evidence

- Multi-file write rule fired for T1–T4 (2+ non-trivial files: src + tests) ⇒ delegated to one writer per task, single-threaded.
- T5 is a one-file mechanical doc edit ⇒ inline direct.
- Parent commits each work unit after worker evidence + spot check (workers do not commit).
