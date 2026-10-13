# Feature: spec-compliance-fixes

Retires the two product defects the real-gopls smoke surfaced (mem
`smoke-findings-f1-f2`, evidence in `odd/tasks/real-server-smoke.md` L5).

## Authority

User: "Apply your suggestions" — F1/F2 fixes were the explicit
recommendation ("fix F1/F2 now (recommended — both are user-visible)");
merge of the reviewed chain follows. R3-001 (smoke-assertion hardening)
stays ledgered as separate later work per its receipt; push stays
deferred.

## Specs

- **F1 — inlay end-line conversion + clamp**
  (`src/pi/lsp-inlay-hints-tool.ts`): the 1-based inclusive
  `startLine`/`endLine` window must convert to a 0-based LSP range
  (`start = startLine - 1`, `end = endLine` as 0-based exclusive — which
  exactly covers the 1-based inclusive end) and clamp `end` to the
  document's line count before sending. Today the value passes through
  raw: ranges at/past the last line — including the default 200-line
  window on short files — are rejected by spec-strict servers (gopls:
  `line number 40 out of range 0-15`). Document length source: the
  same file-read pattern `lsp_code_lens` uses for its bounded window.
- **F2 — call-hierarchy spec-shape rendering**
  (`src/pi/lsp-navigation-tools.ts`): LSP `CallHierarchyIncomingCall` =
  `{ from, fromRanges }` (no `to`); `CallHierarchyOutgoingCall` =
  `{ to, fromRanges }` (no `from`). The renderer must render incoming as
  `caller → prepared item` and outgoing as `prepared item → callee`
  using the echoed `item` for the missing side, keep `(malformed
  source)`/`(malformed target)` markers ONLY for genuinely non-record
  sides, and keep the top-level unreadable-entry guard. The fake fixture
  must be re-shaped to spec (it invented both sides — the conformance
  drift that hid this bug).

## Non-goals

R3-001 smoke-assertion hardening; type-hierarchy rendering (items array,
unaffected); behavior changes beyond spec compliance; push.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| [x] T1 RED→GREEN both fixes + fixture re-shape + smoke expectation sync | F1, F2 | worker (sequential; shared fixture) | `88f0c29` |
| [x] T2 Parent spot-check + battery + gated smoke rerun | F1, F2 | parent | — |
| [x] T3 Commits, closure, assess/review, record | all | parent | `32f84b0` |

## Log

- L1: "Apply your suggestions" — authorized.
- L2 (T1 evidence, worker): RED F1 verbatim — reshaped like-gopls fixture
  rejects raw end=200/end=40: `expected 'failed to retrieve inlay hints
  from f…' not to contain 'failed to retrieve'` (4 failed | 7 passed);
  GREEN 11/11. RED F2 verbatim — spec-shaped incoming rendered
  `alphaPeer → (malformed target) — …:1:1 → ?` (expected `… → alpha`);
  outgoing `(malformed source) → alphaPeer — ? → …:1:1` (5 failed |
  4 passed); GREEN 24/24 incl. untouched
  `lsp-navigation-tools.test.ts` malformed coverage. +5 unit tests
  (494 total / 49 files + smoke skip).
- L3 (T1 deviations, accepted): also clamps 0-based `start` (window
  starting past EOF sends a valid empty range instead of a rejected
  start>end); fixture keeps a stray-non-record `to` malformed probe
  (required by out-of-surface `lsp-navigation-tools.test.ts` coverage);
  "before" real-gopls lines cited from L5 of real-server-smoke (pre-fix
  renderer behavior observed verbatim in unit RED).
- L4 (T2 evidence, parent): hunks verified (F1 = EOF-line clamp via
  `session.fsReadFile` — the 0-based conversion itself pre-existed, the
  missing clamp was the bug; F2 = mode-aware spec rendering with
  stray-field-only markers); independent rerun: `pnpm test` 494 passed |
  8 skipped (49 files + skipped smoke), lint/typecheck clean,
  `GOPLS_SMOKE=1` smoke 8/8 vs real gopls v0.23.0 with corrected truth:
  incoming `main → callee — main.go:5:6 → lib.go:9:6`, outgoing
  `callee → ToUpper — lib.go:9:6 → strings.go:668:6`, boundary endLine 40
  succeeds (no "failed to retrieve", no "out of range").
- L5 (commits): one coherent behavior commit `88f0c29` (fixture shared
  by F1/F2 — established single-commit decision); closure recorded
  here.

## Review record

- Post-implementation assess (committed range, base `46800348f0…`):
  **medium risk** (`executable_change`: src/pi/lsp-inlay-hints-tool.ts),
  8 paths / 324 lines, **reviewDue: false (`under_budget`)** — no native
  review started per entry rule; writer self-verification stands (worker
  GREEN + parent independent reruns: unit 494/49+skip, lint, typecheck,
  gated smoke 8/8 vs real gopls). If a later reminder claims the target,
  the tight base above applies.
- Assess first failed on the recurring `package-local-binary-missing`
  incident; repaired via the recorded playbook
  (`node scripts/install-gentle-ai.mjs`, integrity re-verified) and the
  retry produced the verdict above.
- RDD reminder (target `sha256:376f1854…`) later claimed the slice for
  native review: **APPROVED — ZERO findings** — lineage
  `review-2af5734d51e4918a`, medium (`executable_change`:
  src/pi/lsp-inlay-hints-tool.ts), `review-reliability` lens, 8 paths /
  334 lines, correction budget 167, tight base `46800348f0…`
  (committedOnly; default origin base would exceed budget). Reviewer
  forecast (1 host-relay run) acknowledged; approved on the last
  admitted event; acknowledgement burned (consumed revision
  `sha256:1bdd6677…`). Two submission hiccups honestly noted: a START
  missing `"mode":"ordinary"` (no lineage created; retried complete)
  and one corrupted capture binding (invalid JSON; resubmitted
  byte-for-byte). Delivery: ordinary repository policy.
