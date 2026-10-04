# Feature: workspace-symbol-search (roadmap T1.5b)

## Intent

Complete roadmap T1.5: an on-demand, read-only **workspace symbol search** via a new `lsp_workspace_symbols` tool — `workspace/symbol` queries, bounded, honest about index freshness and coverage.

Split from `symbol-outline` (T1.5a, document symbols) to stay within the agreed ~400 authored-line review budget.

## Design decisions (settled before implementation)

- **Anchor-path gating**: params `{ path, query }` both required. `path` is an anchor file that routes through `activate()` exactly like `lsp_diagnostics`/`lsp_symbols` — it decides trust and which servers are queried (per LSP, `workspace/symbol` results span the workspace regardless of the anchor; the anchor only scopes trust + server selection). This reuses established machinery instead of inventing a directory-trust path.
- **Session layer**: `RuntimeSession.workspaceSymbols(serverId, query, timeoutMs, suppliedClient?)` → `{ outcome: "unsupported" | "failed" | "ok", symbols: unknown[] }`, capability-gated on truthy `workspaceSymbolProvider`, non-array response → `failed` (R3-001 contract), raw cap 1000 entries, never mutates state, never throws.
- **Formatter**: `formatWorkspaceSymbols(symbols, maxChars)` in `src/symbols/format.ts` — flat `WorkspaceSymbol`/`SymbolInformation` entries (`name`, optional `kind`, `location.uri` + optional `location.range`); file URIs render as repo-relative-ish paths (decode + strip `file://`); missing range → `(location unknown)`; same entry/char caps + omission lines as the document formatter (shared helpers where natural).
- **Tool**: `lsp_workspace_symbols` (readOnly annotations), per-server unsupported/failure lines, per-server sections, query echo, footer naming: results reflect each server's **current index** and may lag recent edits; only servers matching the anchor file were queried; workspace completeness never claimed. Empty → server-reported no-match message naming the query.
- Query trimmed; empty after trim → validation message. No config/schema changes.

## Boundaries (binding)

Non-blocking; never auto-apply; never imply completeness or freshness; explicit `unsupported`/`failed` outcomes; strict TDD for W2–W4 (observed RED → GREEN); W1 structural; W5 docs read-back.

## Tasks

- [x] W0 — Branch `feature/workspace-symbol-search` stacked on `feature/symbol-outline`.
- [x] W1 — Fixture `FAKE_WORKSPACE_SYMBOLS=1` (advertise `workspaceSymbolProvider`, answer `workspace/symbol` deterministically: flatten fixture symbols across open documents, filter case-insensitively on `params.query`, honor `FAKE_HANG_METHOD`) + helper flag `workspaceSymbols`. Structural verification + suite green.
- [x] W2 — `RuntimeSession.workspaceSymbols(...)`. Strict TDD.
- [x] W3 — `formatWorkspaceSymbols` (+ shared helpers) in `src/symbols/format.ts`. Strict TDD.
- [x] W4 — `lsp_workspace_symbols` tool + registration in `src/extension.ts`. Strict TDD.
- [x] W5 — README bullet (inline).
- [x] W6 — Close: full suite, lint, typecheck, build; closure docs; native review (RDD); review record.

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| W1 | `78fedbc` | test(fixture): add workspace-symbols mode to fake LSP server |
| W2 | `00e77b3` | feat(runtime): add workspace symbol requests |
| W3 | `4f2b015` | feat(symbols): add bounded workspace symbol formatting |
| W4 | `97506cc` | feat(tools): add lsp_workspace_symbols tool |
| W5 | `20aea5e` | docs: document lsp_workspace_symbols tool |
| W6 | `c4abc43` | docs: record workspace-symbol-search closure evidence |

Review-record commit: follows as `docs: record workspace-symbol-search review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (W6)

- `pnpm test`: 31 files / 260 tests passed (verified by gentle-ai-verify at HEAD 20aea5e).
- `pnpm lint`: exit 0 clean. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 648.26 kB, cli.js 301.15 kB).
- TDD: W2 (9 tests RED → GREEN), W4 (8 tests RED → GREEN). W3: worker errored after writing files — RED evidence recovered honestly by restoring the pre-change formatter while keeping the new tests: 9 tests failed (import of missing `formatWorkspaceSymbols`), implementation restored → 252 GREEN; chronology was recovered, not originally observed. W1 structural (fixture + helper, suite green).

## Review record

- ASSESS (committed range, base `21a14fb`, committedOnly): medium risk, executable change (`src/extension.ts`), 11 paths / 495 lines, reviewDue = `slice_budget_reached`; plan = writerSelfVerification (no separate verifier required; full independent verification battery had already run).
- First START created lineage `review-3193eaef5d555ca8` directly (no stale consent binding this time), host resolved consent; medium tier, review-reliability lens.
- Native review: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational finding (separate later work):
  - R3-001 — `src/runtime/session.ts:215` (WARNING)

## Route evidence

- Branch: `feature/workspace-symbol-search` stacked on `feature/symbol-outline` (chain strategy cached from user).
- Delegation: per-task `gentle-ai-worker` for multi-file writes with exact `## Allowed edit surfaces`; parent commits each work unit; workers never commit.
- Verification: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (full battery via `gentle-ai-verify` at close).
