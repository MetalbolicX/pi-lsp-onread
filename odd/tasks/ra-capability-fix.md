# Feature: ra-capability-fix

Closes findings **F5** (empty code lenses) and **F8** (null code
actions) — both reclassified by
[rust-compatibility-investigation](rust-compatibility-investigation.md)
as client-side capability gaps. The extension's LSP client declares a
minimal capability set; rust-analyzer gates Run/Debug lenses on
`experimental.commands.commands` and returns `null` code actions without
`textDocument.codeAction.codeActionLiteralSupport`. Advertising both
closes the findings in one coherent product change.

## Change

`src/lsp/client.ts` initialize capabilities gain:

- `textDocument.codeAction.codeActionLiteralSupport` with a standard
  `codeActionKind.valueSet` (quickfix + refactor families + source
  kinds);
- `experimental.commands.commands`
  = `["rust-analyzer.runSingle", "rust-analyzer.debugSingle"]`.

Exactly the capability set probe B verified against rust-analyzer 1.95.0
(lens rendered; assists returned at rustc-error positions). gopls is
spec-lenient and unaffected (verified by battery).

## RED → GREEN contract

1. RED: extend the `custom/initializeCapabilities` echo test
   (`tests/unit/lsp/client.test.ts:226`) to require the new fields —
   observe the focused run fail before touching product code.
2. GREEN: implement the capabilities block; focused run passes.
3. Flip verification: the gated rust smoke tightens automatically —
   S5's code-action listing at the unused-import position now reaches
   the previewable path (preview + "preview only"), and S6's `code_lens`
   probe falls to its `nonTrivial: /L\d+:C\d+ "/` assertion (a real
   lens). Stale F5/F8 finding comments in the smoke are retired in the
   same change. No assertion is weakened; no `allowEmptyFinding` escape
   is removed (it stays as honest regression detection).

## Boundaries

- Only `src/lsp/client.ts`, `tests/unit/lsp/client.test.ts`, and
  `tests/smoke/rust-analyzer.smoke.test.ts` (comment retirement + no
  structural assertion change). Plan doc for evidence.
- F9 untouched. hardening-ledger F5/F8 disposition reconciliation stays
  with the ledger-followup-closure slice.
- Rollback: revert the single product hunk + test expectations.

## Verification

Focused unit run; `RUST_ANALYZER_SMOKE=1` (S5 preview path + S6 lens
nonTrivial assert); `GOPLS_SMOKE=1`; `pnpm smoke:pi-host`; bare
`pnpm test`; lint/typecheck/build/format. Battery recorded in the Log;
assess + review per RDD.

## Log

- L1 (RED): the new `custom/initializeCapabilities` unit assertion
  failed against the old capability set — focused run `1 failed |
  16 passed (17)`, the new test the only failure.
- L2 (GREEN): capabilities implemented in `src/lsp/client.ts`; focused
  run **17/17**.
- L3 (flip verification, gated rust smoke 8/8 both before and after the
  comment retirement): S5's code-action listing at the unused-import
  position reached the **previewable preview path** (`S5 code action 1
  preview:` — previously "unreachable on this server"); S6 `code_lens:
  ok (advertised=true)` — the `nonTrivial: /L\d+:C\d+ "/` assertion
  matched a real rendered Run lens (previously the F5 FINDING branch).
  Stale F5/F8 finding comments retired; the honest empty-result guards
  stay as regression detection.
- L4 (battery on final content): bare `pnpm test` **509** passed /
  21 skipped (+1 new test); lint/typecheck/build clean; `format:check`
  caught a biome nit in `client.ts` — auto-fixed, re-verified OK;
  gopls smoke 8/8; rust-analyzer smoke 8/8; `smoke:pi-host` 5/5;
  0 orphan processes. Commits: `3ebce14` (feat) + this closure record.

## Status

Complete pending assess/review per RDD. Findings F5 and F8 are closed
by the capability advertisement; F9 stays recorded (unchanged);
hardening-ledger disposition reconciliation remains with the
ledger-followup-closure slice.

## Review record

- Post-implementation assess (committed range, base
  `d8067db280251c6480e8646b1a45351658985576`): **medium risk**
  (`executable_change`: `src/lsp/client.ts`), 4 paths / 154 lines,
  **reviewDue: false (`under_budget`)** — writer self-verification
  stands (RED observed verbatim → GREEN 17/17; flip verification 8/8
  ×2 with S5 preview path + S6 lens nonTrivial matched; full battery
  509 bare + all three smokes + 0 orphans). No native review started
  per entry rule; if a later reminder claims this target, the tight
  base above applies. Commits: `3ebce14` (feat) + `a4b3743` (evidence).
