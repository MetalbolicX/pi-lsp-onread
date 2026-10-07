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
- [x] Guarded evict-before-set (`size >= CAP` → `keys().next()` with
      `!oldest.done` guard → delete → insert); no non-null assertion remains
- [x] Cap-eviction regression test (oldest evicted, newest retained, cap
      held, refresh safe) — passed pre-fix AND post-fix (honest
      behavior-preservation evidence; no fabricated RED)
- Route: parallel subagent A (gentle-ai-worker), commit `de87520`.

### B — Inlay tooltip resolve (test-first)
- [x] RED observed verbatim: `TypeError: session.resolveInlayHint is not a
      function`; label-only lines with `tooltips not resolved` footer
      (3 focused failures)
- [x] GREEN: `RuntimeSession.resolveInlayHint` (strict `resolveProvider ===
      true` gate mirroring resolveCodeAction; ok/unsupported/failed;
      malformed response ⇒ failed); fixture `FAKE_INLAY_HINT_RESOLVE`
      capability + handler (default unchanged ⇒ existing behavior intact);
      tool resolves with MAX_RESOLVE_ATTEMPTS 20, failed resolve keeps the
      label, conditional footer (both variants line-structure asserted);
      tooltip flatten (string / MarkupContent / MarkedString forms →
      120-char single line); README updated
- [x] Focused GREEN: 103 tests across the three inlay/session files
- Route: parallel subagent B (gentle-ai-worker), commits `a9e0e1f`
  (runtime) + `1547be4` (tooling).

### C — Integration (parent)
- [x] Parallel-contract spot checks: both hunks reviewed (eviction guard,
      resolve gate, fixture opt-in, footer variants, README accuracy)
- [x] Integration fix: TS2532 in worker B's test (optional `env` piercing)
      — one-line object-assignment fix (typecheck excluded from parallel
      contract by design; integration owns it)
- [x] Full battery once (gentle-ai-verify): 453 tests / 47 files (+6),
      lint 0, typecheck clean, build clean, `git diff --check` clean,
      mutation-clean
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
- 2026-10-05: BOTH workers returned green on their focused suites with the
  sibling-blind contract held (neither ran full suite/typecheck/build).
  A: structural fix + guard test (10/10 pre-and-post). B: RED→GREEN with
  verbatim evidence (103 focused). Parent spot-checks passed; ONE
  integration defect (TS2532 optional env) fixed by parent; full battery
  453/47 all green. Work units: de87520 (A), a9e0e1f + 1547be4 (B), this
  closure.

## Review record

- Slice review APPROVED — lineage `review-1b6459b71c923e08`, medium tier
  (`executable_change` on `src/extension.ts`), review-reliability lens,
  11 paths / 299 lines, correction budget 150, base
  `3ddfae4f8fd0290389556661c7ff08243d75d4bd` (committedOnly). One stale
  consent binding (expired, no lineage) recovered with a fresh
  idempotency key. Reviewer forecast (1 host-relay run) acknowledged;
  approved on the last admitted event; acknowledgement burned (consumed
  revision `sha256:7297fb0d…`). One NON-BLOCKING informational advisory:
  R3-001 reliability WARNING at `src/pi/lsp-inlay-hints-tool.ts:74`
  (sequential per-hint resolve awaits — latency fan-out note; ledger item).
  **The previous ledger item `extension.ts:102-104` is RETIRED by task A
  of this very slice.** Delivery: ordinary repository policy.
