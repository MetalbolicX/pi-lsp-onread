# Feature: ledger-followup-closure

**Plan only; closure execution requires a later user go-ahead.** Publish
an accurate final follow-up ledger after
[Pi-host smoke hardening](pi-host-smoke-hardening.md) and
[Rust compatibility investigation](rust-compatibility-investigation.md).
Unresolved server behavior is a valid outcome, not unfinished code to
patch speculatively.

## Work units and reasons

| Unit | Action | Why | Exit evidence |
|---|---|---|---|
| C0 | Collect accepted commits, verification outputs and per-finding dispositions from the two slices. | Do not declare closure from checkboxes or proposed tests. | Evidence references for H0–H4 and R0–R4; missing evidence blocks this unit. |
| C1 | Refresh historical task status and current limitations in the ledger/README. Mark completed hardening T1/T4 correctly and distinguish current contracts from old hypotheses. | Stale `todo` markers contradict recorded completion; historical protocol observations must not become universal claims. | Coherent task table; versions and narrow finding scope preserved; no invented reviewer prose. |
| C2 | Record each outcome as fixed, fixture/config issue, server/version limitation, upstream-report draft, unresolved, or intentionally retained. | Users need to know what is actionable locally versus dependent on external behavior. | One authoritative table with reason, evidence, owner/next action, and condition for revisiting every retained item. |
| C3 | Perform proportionate validation and native assessment/review; report delivery decisions separately. | Planning/docs approval does not imply functional proof or authorization to merge/push. | Checks and receipt/disposition recorded for the exact candidate; no automatic delivery. |

## Final ledger contract

Each row must name the identifier, original observation, current scope,
result, source evidence, and next action. Cover F5, F8, F9, the host-smoke
assertion/lifecycle gaps, and R3-001 without conflating them.

- The original R3-001 review remains approved. Only its structured
  id/lens/location/severity/disposition survived; do not invent its text
  or claim current fixes satisfy an unknown recommendation.
- Raw SDK dispose and production shutdown are different contracts. Keep
  any raw SDK limitation labeled separately from production cleanup.
- Retained F5/F8/F9 items cite tested versions, conditions and a trigger
  for revisiting (e.g. server update or new protocol evidence).
- Upstream issue drafts may be prepared from verified reproducers;
  publication requires user approval, with identifiers linked only after
  an issue actually exists.
- Workspace-edit render-budget readability and stateless code-action
  index selection remain intentionally deferred. They are not proven
  defects and are outside these follow-up slices.

## Recorded process decisions

- **Plans-branch disposition (open user decision):** the three planning
  documents sit on `feature/ledger-followup-plans` (reviewed and burned).
  Merging them to main now, or carrying them into the first implementation
  branch instead, is an explicit user decision; closure assumes neither.
- **Scheduling:** host-smoke hardening and the Rust investigation touch
  disjoint surfaces (`pi-host.*` vs `rust-analyzer.*`). Default remains
  sequential for review focus; parallel execution only on explicit user
  opt-in. Closure depends on both being accepted.
- **CI posture (explicit non-goal):** all three smoke suites are
  environment-gated and never run automatically anywhere. No CI
  scheduling is planned; adding it would be a separately authorized
  slice, not a closure task.

## Branch, surfaces, and verification

Planning baseline: synchronized `main` at
`ede820fc5c560f3d58521f41f0213e4d3ed97f80`. Proposed closure branch:
`feature/ledger-followup-closure`, created only after authorization and
accepted predecessor evidence. Do not assume a merge/stack strategy in
advance; pin the actual reviewed base before creating each implementation
branch. The three plans are currently on `feature/ledger-followup-plans`.

Primary surfaces: this plan, the two predecessor plans,
`odd/tasks/hardening-ledger.md`, `odd/tasks/pi-host-smoke.md`, and README
only where current guarantees/limitations need correction. No new product
behavior, dependency change, or renewed historical review is in scope.

Docs-only closure has no meaningful RED → GREEN: validate references,
task/disposition consistency and diff boundaries instead. Record the full
battery from the exact combined executable tree before claiming all slices
verified: bare `pnpm test`; lint/typecheck/build/format; all three smoke
scripts. A later docs-only commit can reference that evidence without
pretending to run functional tests on its prose. Runtime verification for
the passive doc diff itself is N/A, with this reason recorded.

Keep docs with the behavior/investigation unit when possible; the final
closure commit only reconciles cross-slice status. Forecast diff before
writing and split if necessary. Rollback only removes the new consolidated
record, not predecessor behavior or historical receipts. Native review
outcomes do not authorize merge, branch/worktree deletion, or push.

## Acceptance and status

- [x] All rows have evidence and bounded next actions or a clear
      resolution — 10-row Final disposition ledger in
      `hardening-ledger.md` (F5/F8/F9, raw-dispose, three non-conflated
      R3-001 instances + R4-001, two deferred-by-design items, the
      newly observed prewarm flake).
- [x] Completed historical T1/T4 status agrees with recorded results —
      T1 → `0ff03f9` + subsequent batteries; T4 → L4 battery + burned
      review `review-c527e94ae95b35dd`.
- [x] Unknown advisory prose is explicitly unknown, not reconstructed —
      the old `:372` R3-001 row states prose unrecoverable and declines
      to act on it.
- [x] No unsupported universal claim about RA assists/lenses remains in
      the newly authored current summary; historical evidence is
      retained — historical "server-side" dispositions kept verbatim
      with superseded banners; the table scopes F5/F8 to RA 1.95.0 +
      this client's capability set.
- [x] Verification and delivery status are accurately separated —
      battery receipts below; no merge, push, branch deletion, or issue
      publication occurred.

C0–C3: **executed** on `feature/ledger-followup-closure`, created from
the fully-reviewed stack tip `10af637a20a…` (`feature/ra-capability-fix`)
rather than `main` — the F5/F8 reconciliation requires the
capability-fix content, and the main-merge decision stays with the
user. The plans-branch disposition resolved itself: all three planning
branches are merged into the stack (`git branch --merged HEAD`).
Commits: `6294545` (reconciliation) → `d2e041e` (prewarm flake
disposition) → this closure record.

Battery on the final combined tree (docs diff only; executable content
identical to the reviewed capability-fix tip): gopls smoke **8/8**,
rust-analyzer smoke **8/8**, pi-host smoke **5/5**, **0 orphan**
processes; lint, typecheck, build, `format:check` clean; bare suite
hunted 3× after a first-run flake — **green / 1 failed / green**, then
a focused 10× stress of the flagged file alone (**9 green / 1 failed
in isolation**) identified `prewarm.test.ts:137` as an intrinsic
single-tick timing race, dispositioned in the ledger above rather than
speculatively patched. Consistency checks: all seven cited commit SHAs
resolve, all seven cross-referenced task docs exist, README verified to
need no correction. Runtime verification for the passive docs diff
itself: N/A — the diff contains no executable content; this reason is
recorded per plan.

Delivery decisions (merge, push, deletions, any prewarm-test-fix
slice) remain explicitly with the user. Nothing was published
upstream; no issue identifiers were invented.
