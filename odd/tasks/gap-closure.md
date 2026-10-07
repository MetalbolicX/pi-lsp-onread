# Feature: gap-closure

Closes the two open items from completed work: the advisory-ledger finding and
the T2.3 inlay-hints tooltip gap. User explicitly authorized **parallel
subagents** for this feature (2026-10-05).

## Objective

1. **Advisory ledger** — retire the informational R3-001 finding at
   `src/extension.ts:102-104` (preflightNotes stash-cap eviction using a
   non-null assertion on `keys().next().value!`) by restructuring to
   evict-before-set with an explicit done-guard, preserving behavior exactly.
2. **T2.3 leftover** — resolve inlay-hint tooltips via `inlayHint/resolve`
   when (and only when) the server advertises `resolveProvider`, bounding
   resolve fan-out and failures, updating the footer so it no longer claims
   "tooltips not resolved" once resolution is active.

## Authority

Advisory from preflight review lineage `review-f7c98ab618b61d61`
(informational, non-blocking, ledger item). T2.3 limitation recorded at
implementation ("Inlay is label-only (no tooltip resolve)") and visible in
the tool footer. User instruction: "Execute parallel sub agents to implement
the gaps and the t2.3".

## Resolved design decisions

1. **Parallel writers, disjoint surfaces.** Task A owns only
   `src/extension.ts` + `tests/unit/pi/preflight-hook.test.ts`; Task B owns
   session/inlay/fixture/README surfaces. Neither may touch the other's
   files. During the parallel phase each worker runs ONLY its own focused
   test files — no full suite, no typecheck/build (the sibling's WIP would
   poison results). Parent runs the single full battery after both return.
2. **Advisory fix is behavior-preserving.** Eviction becomes: at capacity,
   read `keys().next()` and delete only when `!done`, THEN insert (same
   survivors as today: newest kept, oldest evicted, cap 100). Not a
   behavior change ⇒ regression test guards the cap semantics honestly
   (no fabricated RED).
3. **Resolve gating** mirrors `resolveCodeAction` (session.ts:285-290):
   `inlayHintProvider` must be an object with `resolveProvider === true`;
   otherwise outcome `unsupported` and the tool keeps today's wording.
4. **Bounded resolution**: resolve attempts capped (hints per range,
   MAX_RESOLVE), one failed resolve never aborts the batch (hint keeps its
   label), per-resolve timeout under the existing 5s/10s conventions.
5. **Tooltips flatten to text** (MarkedString | MarkupContent | string →
   bounded single-line, truncated with the established 120-char style);
   line-structure assertions mandatory for the changed footer/lines.
6. **Fixture** gains env-gated `inlayHint/resolve` support beside its
   existing inlay flags (worker locates exact naming).

## Tasks

### A — Advisory ledger retirement (structural + guard test)
- [ ] Guarded eviction without non-null assertion; cap-eviction regression
      test (oldest evicted, newest retained, cap held)
- Route: parallel subagent A (gentle-ai-worker).

### B — Inlay tooltip resolve (test-first)
- [ ] RED: resolve unsupported today (no session method / fixture handler)
- [ ] GREEN: `RuntimeSession.resolveInlayHint` (gated, ok/unsupported/failed);
      fixture resolve handler; tool resolves bounded hints and appends
      tooltip text; conditional footer; README updated
- [ ] Line-structure assertions for changed output lines
- Route: parallel subagent B (gentle-ai-worker).

### C — Integration (parent)
- [ ] Full battery once (gentle-ai-verify), work-unit commits, closure,
      slice review, record
- Route: parent.

## Non-goals

- Call/type hierarchy, implementation/typeDefinition, selection range
  (next roadmap slice candidates); real-server smoke (separate, needs
  explicit authorization); anything beyond the two named gaps.

## Constraints

- Baseline: `main` @ `3ddfae4`; 447 tests / 47 files green.
- Branch `feature/gap-closure` off `main` before first write.
- Workers never commit/stage; parent reviews hunks, verifies, commits.
- RDD: slice review at close with explicit committed base
  (`3ddfae4` full SHA resolved at review time).
- Push remains deferred (user: "Push later. Maintain locally.").

## Progress log

- 2026-10-05: authorized parallel implementation; evidence gathered
  (resolveCodeAction precedent :285-290; inlayHints :399-402; tool footer
  :68, budgets :8-80). Branch created; both workers launched in parallel
  with disjoint surfaces.

## Review record

- (pending)
