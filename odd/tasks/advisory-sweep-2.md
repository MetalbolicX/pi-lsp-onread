# Feature: advisory-sweep-2

Retires both open informational advisory-ledger items in one small slice.

## Objective

1. **`src/pi/lsp-navigation-tools.ts:260`** — malformed call-hierarchy
   `from`/`to` sub-objects currently fall back to `{}` silently and render
   `(unnamed)`; name them as malformed instead (honest omission, never a
   fabricated name).
2. **`src/pi/lsp-inlay-hints-tool.ts:74`** — tooltip resolves run
   sequentially (up to 20 × timeout worst case); run them concurrently
   (bounded by the existing `MAX_RESOLVE_ATTEMPTS = 20`) so worst-case
   latency is one timeout, with per-hint failure isolation unchanged.

## Authority

Both findings are non-blocking advisories recorded in prior review
receipts (`review-f7c98ab618b61d61` → inlay:74; `review-55f391f3f0cd90d6`
→ nav:260) and carried in the ledger. User: "Do the advisory sweep and
merge".

## Resolved design decisions

1. **Malformed hierarchy entries**: when `call.from` / `call.to` is not a
   record, render `(malformed source)` / `(malformed target)` in the call
   line instead of `(unnamed)` — same for prepare-mode items whose own
   fields are structurally unreadable beyond the existing `isRecord(raw)`
   guard. No silent `{}`-derived names. The pre-existing non-record
   top-level guard (`… unreadable hierarchy entry omitted`) stays.
2. **Fixture**: `FAKE_MALFORMED_HIERARCHY=1` makes the
   callHierarchy/incomingCalls handler return one entry with a non-object
   `from` (and one with a non-object `to`) so both renderings are
   testable; well-formed behavior unchanged when the flag is off.
3. **Concurrent resolves**: replace the sequential `for … await` with a
   bounded concurrent batch (`Promise.all` over at most
   `MAX_RESOLVE_ATTEMPTS` hints); a failed resolve still keeps the original
   label; total attempts cap unchanged. DETERMINISTIC test preferred: a
   deferred-promise session mock (via `createSession`) asserting all
   resolves START before any COMPLETES — this fails against sequential
   code (genuine RED). A fixture-delay timing assertion is acceptable only
   if the deterministic route proves impractical (report honestly).
4. **No README change**: user-visible contracts (caps, footers,
   "resolved when supported") are unchanged; this is internal honesty +
   latency hardening.

## Tasks

### S1 — Malformed hierarchy naming (test-first)
- [x] RED observed verbatim: expected `(malformed source) → target — ? → …`,
      observed `(unnamed) → target — :1:1 → …`
- [x] GREEN: `fromIsRecord`/`toIsRecord` computed once; markers
      `(malformed source)`/`(malformed target)` with `?` positional
      fallbacks (arrow line structure preserved); top-level
      `… unreadable hierarchy entry omitted` guard and prepare-mode
      rendering untouched; fixture `FAKE_MALFORMED_HIERARCHY` adds one
      non-object `from` and one non-object `to` to incomingCalls only
- [x] Focused: 15/15 navigation tests
- Route: delegated (gentle-ai-worker), commit `bbbd85f`.

### S2 — Concurrent inlay tooltip resolves (test-first)
- [x] RED observed verbatim: expected three resolves started before any
      completed; observed one (sequential) — deterministic deferred-promise
      session mock as designed
- [x] GREEN: `Promise.all` over `map` — `resolveAttempts` increments
      synchronously before each await (cap of 20 exact), per-hint try/catch
      keeps failure isolation, array order preserved (reverse-completion
      test asserted), non-eligible hints untouched
- [x] Focused: 9/9 inlay tests incl. cap/failure regression
- Route: delegated (gentle-ai-worker), commit `559ed3f`.

### S3 — Verification + merge (parent)
- [x] Battery run TWICE for the worker-reported transient (prewarm test):
      489/49 green on BOTH runs, unreproduced — recorded honestly (2 runs
      bound but cannot disprove a load-dependent flake); lint, typecheck,
      build, `git diff --check` all clean; mutation-clean
- [x] Work units: `bbbd85f` (S1), `559ed3f` (S2)
- [ ] Closure + slice review + record; ff-merge chain; post-merge battery
- Route: parent.

## Non-goals

- New capabilities; latency budgets beyond one-timeout worst case;
  concurrency beyond the 20-attempt cap; README rewrites; deleting branches
  (not requested this cycle).

## Constraints

- Baseline: `feature/capabilities-completion` @ `39a0cdb`; 487 tests /
  49 files green. Branch `feature/advisory-sweep-2` stacked on it
  (slice review base = `39a0cdb`).
- Test-first per task (RED observed before GREEN).
- Single sequential worker (fixture file shared by S1 and S2).
- ~150 authored lines advisory.
- Push remains deferred (origin/main = `3ddfae4`).

## Progress log

- 2026-10-07: authorized ("Do the advisory sweep and merge"). Design locked;
  branch created; S1+S2 delegated as one sequential worker task.
- 2026-10-07: both tasks GREEN with verbatim REDs (genuine: sequential-start
  observation proves S2). Parent spot-check: S1 markers + `?` fallbacks
  structurally sound, guards untouched; S2 cap increments synchronously
  pre-await (cap exact at 20), Promise.all ordering + isolation verified.
  Battery twice: 489/49 both runs; transient prewarm failure unreproduced
  (recorded as unproven). Commits bbbd85f + 559ed3f.

## Review record

- Slice review APPROVED — lineage `review-a262bbc063fe40f2`, medium tier
  (`executable_change` on `src/pi/lsp-inlay-hints-tool.ts`),
  review-reliability lens, 6 paths / 178 lines, correction budget 89, base
  `39a0cdbd696e569b46fae41e77fb994e0419abe3` (committedOnly). Reviewer
  forecast (1 host-relay run) acknowledged; approved on the last admitted
  event with **ZERO findings — both ledger items retired, none added**;
  acknowledgement burned (consumed revision `sha256:77b5c132…`).
  Delivery: ordinary repository policy.
