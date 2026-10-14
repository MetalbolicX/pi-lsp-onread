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
