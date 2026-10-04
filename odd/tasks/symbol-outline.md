# Feature: symbol-outline (roadmap T1.5a)

## Intent

Give the model an on-demand, read-only **document outline** for a file via a new `lsp_symbols` tool: bounded, kind-labeled, honest about coverage and staleness.

Roadmap T1.5 covers "workspace/document symbols". The agreed ~400 authored-line review budget splits it into two chained slices:

- **T1.5a (this feature): document symbols** — `textDocument/documentSymbol`.
- **T1.5b (follow-up feature): workspace symbol search** — `workspace/symbol` with an anchor path for trust/server selection (design decided: anchor file reuses activate()'s trust + server-match semantics).

## Design boundaries (inherited, binding)

- Non-blocking; read-only tool annotations; capability-gated with explicit `unsupported` outcome (never a fake empty success).
- Never imply completeness or freshness: bounded output with explicit truncation wording; "server's current view, may lag recent edits" framing, no "clean/complete" claims.
- Output caps: `MAX_OUTPUT_CHARS = 8_000` (same as lsp_diagnostics), symbol-count and depth caps in the formatter.
- No config/schema changes; server selection reuses `activate()` trust + match machinery exactly like `lsp_diagnostics`.
- Strict TDD for S2–S4 (observed RED → GREEN); S1 fixture/test-intra verified structurally; S5 docs verified by read-back.

## Tasks

- [x] S0 — Branch `feature/symbol-outline` stacked on `feature/cross-file-awareness`.
- [x] S1 — Fixture `FAKE_DOCUMENT_SYMBOLS=1` (advertise `documentSymbolProvider`, answer `textDocument/documentSymbol` with realistic nested `DocumentSymbol[]`, honor `FAKE_HANG_METHOD`) + helper flag `documentSymbols` in runtime-test-helpers. Test infra: structural verification + runtime suite green.
- [x] S2 — `RuntimeSession.documentSymbols(serverId, uri, timeoutMs, client?)` → `unsupported | failed | ok` (raw bounded array), capability-gated on `documentSymbolProvider`; malformed (non-array) response → `failed`. Strict TDD.
- [x] S3 — `src/symbols/format.ts`: flatten nested DocumentSymbols depth-capped, kind labels, line ranges, count/char caps with explicit truncation lines, non-empty guarantee. Strict TDD.
- [x] S4 — `lsp_symbols` tool (params `{ path }`, readOnly annotations) + registration in `src/extension.ts`; mirrors lsp_diagnostics gating (untrusted/no-match/inactive), per-server unsupported/failure lines, bounded output, honest coverage/staleness footer. Strict TDD.
- [x] S5 — README: `lsp_symbols` section (inline).
- [x] S6 — Close: full suite, lint, typecheck, build; feature doc closure + native review (RDD).

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| S1 | `33dcc72` | test(fixture): add document-symbols mode to fake LSP server |
| S2 | `67bf5e1` | feat(runtime): add document symbol requests |
| S3 | `3dd25ae` | feat(symbols): add bounded document symbol formatting (incl. kind-0 label fix, observed RED → GREEN) |
| S4 | `dd3b000` | feat(tools): add lsp_symbols document outline tool |
| S5 | `a2a8c12` | docs: document lsp_symbols tool |
| S6 | `f3aaaea` | docs: record symbol-outline closure evidence |

Review-record commit: follows as `docs: record symbol-outline review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (S6)

- `pnpm test`: 30 files / 234 tests passed (verified by gentle-ai-verify at HEAD a2a8c12).
- `pnpm lint`: 0 errors. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 641.58 kB, cli.js 301.15 kB).
- TDD: S2 (8 tests RED → GREEN), S3 (RED = module absent at import, then 11 tests GREEN + kind-0 fix RED → GREEN), S4 (6 tests RED → GREEN). S1 structural (fixture + helper, suite green).

## Review record

- ASSESS (committed range, base `6473a63`, committedOnly): medium risk, executable change (`src/extension.ts`), 11 paths / 582 lines, reviewDue = `slice_budget_reached`; plan = writerSelfVerification (no separate verifier required). First ASSESS without baseRef failed `no pending changes` — rerun with explicit baseRef is the documented continuation.
- One stale consent binding (`ec97e822…`, expired; no lineage), second START created lineage `review-392a360d4fc180e4` (medium, review-reliability), host resolved consent directly.
- Native review: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational findings (separate later work):
  - R3-001 — `src/runtime/activation.ts:166` (WARNING)
  - R3-002 — `src/runtime/activation.ts:207` (WARNING)

## Route evidence

- Branch: `feature/symbol-outline` stacked on `feature/cross-file-awareness` (chain strategy cached from user).
- Delegation: per-task `gentle-ai-worker` for multi-file writes with exact `## Allowed edit surfaces`; parent commits each work unit; workers never commit.
- Verification commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
