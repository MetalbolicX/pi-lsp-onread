# Feature: finding-fixes

Retires the three product findings the rust-analyzer smoke surfaced
(evidence in `odd/tasks/rust-analyzer-smoke.md` L4). F5 (codeLens
advertised-but-empty) is a rust-analyzer-side interaction and stays a
recorded finding.

## Authority

User: "fix them" — after the smoke close-out listed F3/F4/F6 as the
product-side findings.

## Specs

- **F3 — codeAction context** (`src/runtime/session.ts` codeActions):
  send the LSP-required `context` parameter:
  `{ diagnostics: <current cached diagnostics for (serverId, uri)> }`,
  sourced in raw LSP form (snapments may need to retain raw items —
  servers match quickfixes by context diagnostics, and rust-analyzer
  associates fixes via diagnostic identity/range). Thread
  `context.only` for the organize-imports call path (`source.
  organizeImports`) per LSP. Lenient servers keep working; strict
  servers stop rejecting the request.
- **F4 — pull must not clobber push** (`src/runtime/session.ts`
  pullFresh + store): track snapshot ORIGIN (push vs pull). An EMPTY
  pull "full" report records only when there is no existing snapshot or
  the latest snapshot is pull-origin; it never erases a push snapshot
  (rust-analyzer's pull view omits flycheck results its push delivers —
  probe-verified). Non-empty pulls still record. gopls is unaffected
  (it does not advertise `diagnosticProvider`).
- **F6 — EOF clamp off-by-one** (`src/pi/lsp-inlay-hints-tool.ts`):
  clamp both 0-based lines to `split("\n").length - 1` (the LSP-legal
  EOF line — always `length - 1`), not `length`. gopls tolerated the
  one-past line; rust-analyzer rejects it (probe: `Invalid offset
  LineCol { line: 12, col: 0 } (line index length: 183)`). Keep the
  2000-line window cap; keep start ≤ end after clamping.

## Verification contract

- Strict TDD: per-fix RED via updated fake-fixture validation
  (context presence + strict range mirroring rust-analyzer) and new
  unit assertions; then GREEN.
- BOTH gated smokes rerun on the fixed tree: the rust smoke's
  finding-observation branches for S3/S5/S6-boundary must FLIP to their
  success paths (that is their design); F5 remains a recorded finding.
  The gopls smoke must stay 8/8.
- README wording updated where behavior text changed (diagnostics
  merge semantics; inlay clamp wording).

## Non-goals

F5; merge (user decides); layer-2 smoke; push.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 RED→GREEN F3+F4+F6 (+fixture strictness, +unit tests, README) | F3, F4, F6 | worker | C1 |
| T2 Parent spot-check + battery + BOTH gated smokes (flip check) | all | parent | — |
| T3 Commits, closure, assess | all | parent | C2+ |

## Log

- L1: "fix them" — authorized. Branch stacked on
  `feature/rust-analyzer-smoke` @ `b4f0d99` so the smoke's finding
  branches auto-tighten against the fixes.

## Review record

- (pending)
