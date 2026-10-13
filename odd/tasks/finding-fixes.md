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
| [x] T1 RED→GREEN F3+F4+F6 (+fixture strictness, +unit tests, README) — extended in-slice with F7 | F3, F4, F6, F7 | worker + parent | `36410c3` |
| [x] T2 Parent spot-check + battery + BOTH gated smokes (flip check) | all | parent | — |
| [x] T3 Commits, closure, assess | all | parent | `36410c3`, `f1c26fd` |

## Log

- L1: "fix them" — authorized. Branch stacked on
  `feature/rust-analyzer-smoke` @ `b4f0d99` so the smoke's finding
  branches auto-tighten against the fixes.
- L2 (T1 evidence, worker pass 1): F3 — session.codeActions now sends
  the LSP-required `context` (`diagnostics` from the current snapshot in
  raw form — snapshots carry `rawItems`; `only` threaded for organize
  imports). F4 — snapshot `origin` tracking (`push`/`pull`) +
  `DiagnosticsStore.recordPull`: an EMPTY pull preserves any non-pull
  snapshot; applied to pullWorkspace too (consistency; no smoke path
  affected). F6 — clamp to `split("\n").length - 1` with
  `endLine0 >= startLine0` guard. Fixture now validates context and
  strict ranges like rust-analyzer. Verbatim REDs in the worker
  handoff; +10 unit tests (504).
- L3 (T1 evidence, worker pass 2 — F7, added in-slice): the rust smoke
  could not converge because the runtime never sent `textDocument/
  didSave`, so rust-analyzer's `checkOnSave` flycheck never re-ran after
  edits (probe-verified: push v1 error, pulls v2..17 empty-preserved, no
  re-publication). Activation fires after real Pi edit/write results,
  so didSave-after-didChange is truthful. Implemented: client advertises
  `synchronization.didSave`, DocumentTracker sends didSave with the
  synced text. RED verbatim (capability + notification assertions).
  **S3 flipped**: surfaced 5.9s, delta converged 9.1s (that run).
- L4 (T1 evidence, parent finishing — two proven rust-analyzer
  interaction truths recorded as findings, harness asserts them
  honestly):
  - **F8** (S5): F3 FLIPPED the request acceptance (no more "failed to
    retrieve"), but rust-analyzer offers no code actions for
    rustc-sourced context diagnostics (its assist keys off native
    diagnostics, which the flycheck push overwrote) — S5 branch now
    records F8 and skips the preview on this server; gopls S5 previews
    still verify the preview engine.
  - **F9** (S3 delta): RA interleaves fast native pushes with slow
    flycheck pushes and the store keeps the LAST push — so the fix
    baseline can be native-only and never contain the flycheck error.
    S3 now asserts the honest contract: error surfaces fresh AND the fix
    converges to an error-free current state (r6: 230ms), asserting the
    delta-resolved form whenever the baseline held the error (proven
    reachable in the F7 run). The old warm-up double-edit is removed
    (it raced flycheck's async check).
  - Fixture gained inlay-provocative code (`let total = 1 + 2`,
    multi-arg `pair` call; RA omits single-arg param hints) so S6's
    non-trivial inlay assertions are satisfiable on a real server.
- L5 (T2 evidence): parent spot-check of product hunks (context+only;
  recordPull preservation; truthful didSave after didChange, order
  preserved). Final content battery: bare `pnpm test` **506 passed |
  16 skipped** (51 files, both smokes skipped); lint/typecheck/format
  green; **gopls smoke 8/8**; **rust-analyzer smoke 8/8** (r6 + rerun
  post-format; final observe set: S3 converged current-form/F9, S5
  F3-flipped/F8, S6 hints non-trivial + **F6 boundary success path**,
  F5 codeLens finding remains — RA-side).
- L6 (deviations, honest): worker left a `/tmp/ra-smoke-backup.ts`
  during its inlay experiment (parent removed it); temporary env-gated
  probes were added and reverted (grep-verified); the worker's first
  S5-fix attempt legitimately landed as an authorized smoke edit
  (bounded diagnostics wait before listing, mirroring editors).

## Review record

- Post-implementation assess (committed range, base `a6e29aa8af8…`):
  **medium risk** (`executable_change`: src/diagnostics/store.ts), 18
  paths / 546 lines, **reviewDue: false (`under_budget`)** — no native
  review started per entry rule; writer self-verification stands
  (worker RED→GREEN both passes + parent spot-check + independent final
  battery: bare 506/49+skip, lint/tsc/format green, gopls 8/8,
  rust-analyzer 8/8 with the flip outcomes recorded in L5). If a later
  reminder claims the target, the tight base above applies.
- RDD reminder (target `sha256:a6382624…`) later claimed the slice:
  **APPROVED — ZERO findings, no advisories** — lineage
  `review-0b20afd031d3bf49`, medium (`executable_change`:
  src/diagnostics/store.ts), `review-reliability` lens, 18 paths / 555
  lines, correction budget 200, tight base `a6e29aa8af8…`
  (committedOnly). Reviewer forecast (1 host-relay run) acknowledged;
  approved on the last admitted event; acknowledgement burned (consumed
  revision `sha256:d1cb156a…`). Delivery: ordinary repository policy.
