# Feature: hardening-ledger

Retires the post-finding-fixes hardening ledger (user-approved full
scope, audit-first, one slice with work-unit commits): the two
rust-analyzer interaction findings that have a product-side fix path
(F9 push-stream clobbering, F8 rustc-context code actions), both
smoke-harness R3-001 advisories, a definitive F5 codeLens
classification, and an audit of the older per-slice advisory tail.
Evidence: `odd/tasks/finding-fixes.md` (L4 F8/F9), `odd/tasks/
rust-analyzer-smoke.md` (L4 F5, review record R3-001),
`odd/tasks/real-server-smoke.md` (review record R3-001).

## Design decisions (settled before implementation)

- **F9 merge key = diagnostic `source`** — the store keeps per-(server,
  uri) push *slots* keyed by the push report's dominant `source` field
  (rust-analyzer native vs rustc/flycheck) and replaces only the same
  slot; pull-preservation semantics from finding-fixes are unchanged.
  A union view is materialized at read time with `version = max(slot
  versions)` so freshness rules keep working; baselines keep recording
  the previous union so delta semantics are unchanged. **Step 1 is a
  discriminant spike**: confirm via rawItems (unit fixture + one RA
  observe) exactly which `source` values arrive on each stream before
  the key is finalized. If no stable discriminant exists, record that
  honestly and F9 stays a finding (no speculative merge).
- **F8 rides F9** — `session.codeActions` already builds context from
  the current snapshot's rawItems; once the snapshot is the merged
  union, rust-analyzer's assist engine sees its native items again.
  Work = verification on real RA (S5 may flip to real previews; the
  harness auto-tightens by design) plus any ordering/dedup the union
  view needs. If RA still returns nothing for a native-bearing
  context, F8 is re-classified server-side and stays recorded.
- **One standalone RA probe covers F5 + the F8 hypothesis** — framed
  LSP probe in /tmp on a temp fixture: (a) codeLens with the exact
  settings our client sends AND with corrected settings keys — wrong
  keys means a client-side fix; empty under both means server-side
  (documented finding); (b) codeActions with a native-only context —
  validates the F8 hypothesis before the store work lands.
- **Bin defaults flip to PATH resolution** — `?? "rust-analyzer"` /
  `?? "gopls"` (both verified resolvable on PATH here at the exact
  smoke-tested versions: rust-analyzer 1.95.0, gopls v0.23.0); env
  overrides stay. Fixes the rust R3-001 and the identical unflagged
  gopls hardcode symmetrically.
- **S5 wording-brittleness fix = shared markers, not looser strings** —
  gopls S5 asserts against the renderer's actual marker constants
  (imported from the tool layer where they exist; add exports if
  missing) instead of inline prose substrings; structural regexes
  stay. The wording contract stays enforced — drift now fails loudly
  at the single definition point instead of silently at N literals.
- **Audit-first** — the seed list below comes from receipts; each item
  is classified against current source as stale/fixed/live (receipt
  line numbers are historical; several families were already retired:
  navigation-completion R3-001 by advisory-sweep-2 S1,
  inlay-hints-tool.ts:74 by S2, extension.ts:102-104 by gap-closure,
  session.ts:209 by b3776b7, activation.ts:81 by 76dc220). Live items
  with a deterministic RED→GREEN path get fixed in-slice at the
  advisory-cleanup bar; the rest are left with reasons; the
  authoritative final ledger lands in this doc.

## Tasks

| # | Work | Route | Verification | Status |
|---|------|-------|--------------|--------|
| T0 | Advisory-tail audit: classify seed list, fix trivially-live items | inline (reads) + worker if fixes span files | fixed/stale/live table below; unit green | todo |
| T1 | Smoke hygiene: PATH-default bins (both tests), gopls S5 shared-marker assertions | worker | both gated smokes 8/8; bare test spawns nothing | todo |
| T2 | F9 store merge + F8 context verification (one coherent product commit; shared store/session/fixture surfaces) | worker (RED→GREEN) | unit: interleaved two-source pushes preserve both; rust smoke S3 delta always-assertable (auto-tighten) or F9 honestly stays recorded; S5 flip on RA asserted; gopls 8/8 | todo |
| T3 | F5 probe + disposition | inline (probe) + docs | probe evidence verbatim in Log; client-side fix or documented server-side finding | todo |
| T4 | Closure: full battery, README wording where behavior text changed, assess + review per RDD | inline + native | all green; slice review burned | todo |

## Audit seed list (from receipts; line numbers historical)

- session.ts family: R3-001 :215 (workspace-symbol era), :358
  (hover-inlay), :395 (formatting-preview) — pull/parse validation era;
  much reworked by finding-fixes.
- preview/workspace-edit.ts: R3-001 :70-74, R3-002 :219
  (edit-preview-engine).
- lsp-organize-imports-tool.ts:58 (organize-imports-preview).
- lsp-code-actions-tool.ts:105 (code-action-tool; context rework in
  finding-fixes may have retired it).
- lsp-navigation-tools.ts:89 (navigation-tools).
- diagnostics/format.ts:52-53 family (on-demand-diagnostics,
  diagnostic-deltas, cross-file-awareness).
- runtime/activation.ts family: :100-113, :162, :166, :207
  (timer/cleanup class; advisory-cleanup verified :100-113 present).
- RETIRED (verify, don't re-fix): navigation-tools.ts:260 (sweep-2
  S1), inlay-hints-tool.ts:74 (sweep-2 S2), extension.ts:102-104
  (gap-closure), session.ts:209 (b3776b7), activation.ts:81 (76dc220),
  the 13-item CLI batch (advisory-cleanup).

## Verification commands

- `pnpm test` (bare — both smokes skip, no servers spawn)
- `GOPLS_SMOKE=1 pnpm vitest run tests/smoke`
- `RUST_ANALYZER_SMOKE=1 pnpm vitest run tests/smoke/rust-analyzer.smoke.test.ts`
- `pnpm lint && pnpm typecheck && pnpm build && pnpm format:check`

## Non-goals

Layer-2 Pi-host smoke; push; recorded non-goals (config hot-reload,
half-open session recovery, incremental document sync, subtree trust,
`codeLens/resolve`, `typeHierarchy/resolve`); changing
rust-analyzer-side behavior for F5; merging this slice (user decides).

## Log

- L1 (plan): scope settled with user — full ledger scope (F9 + F8 +
  both smoke advisories + F5 probe), audit-first with trivial-live
  fixes in-slice, one branch `feature/hardening-ledger` with
  work-unit commits. PATH resolution verified for both servers
  (`gopls` v0.23.0, `rust-analyzer` 1.95.0) before committing to the
  bin-default flip.

## Review record

- (pending implementation)
