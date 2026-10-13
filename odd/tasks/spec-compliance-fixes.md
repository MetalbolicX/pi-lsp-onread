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
| T1 RED→GREEN both fixes + fixture re-shape + smoke expectation sync | F1, F2 | worker (sequential; shared fixture) | C1/C2 |
| T2 Parent spot-check + battery + gated smoke rerun | F1, F2 | parent | — |
| T3 Commits, closure, assess/review, record | all | parent | C3+ |

## Log

- L1: "Apply your suggestions" — authorized.

## Review record

- (pending)
