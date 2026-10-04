# Feature: graceful-degradation

## Objective

Bound total foreground feedback for edit/write tool results with one shared
deadline that covers cold server startup, return truthful cached/pending
diagnostics when the deadline expires, harden failure handling against dead
connections and shutdown races, and expose the existing timeout/retry
constants as optional per-server configuration — preserving every current
default. No redesign of the approved retry policy.

## Authority (recorded from the plan-only session, 2026-10-03)

- **Foreground/background split**: reads stay immediate cached returns;
  edit/write enforce ONE shared `diagnostics.waitMs` deadline across all
  matched servers, INCLUDING cold startup (initialize). Today
  `src/runtime/activation.ts` awaits `ensure()` before the bounded
  publication wait, so an edit can exceed the advertised budget. On expiry
  the underlying Pi tool result still succeeds, with cached diagnostics and
  an explicit pending/unavailable label; startup continues in background so
  a later result benefits from the warm-up. Silence never implies clean.
- **Failure handling**: retries stay demand-driven (60s cooldown, disable
  after 3 consecutive failed starts — terminal; approved request-timeout
  policy unchanged). One request timeout abandons that request only — never
  proof the server died, never a replay of mutating requests, never a kill.
  Dead transports (child exit / connection close after readiness) evict
  their pooled client with an honest failure line; the next activation
  respawns under existing cooldown rules. Concurrent activation coalesces:
  one startup attempt, one failure count per pool key. Late or
  generation-mismatched diagnostics never render as current. Shutdown
  refuses new activation and disposes clients that finish starting late.
- **Config exposure (per-server, layered)**: `initializeTimeoutMs` 15000,
  `requestTimeoutMs` 10000, `retryCooldownMs` 60000,
  `maxConsecutiveStartFailures` 3. Project overrides global; omitted values
  keep defaults; invalid values are rejected, never silently corrected.
- README's "push and pull diagnostics are supported" wording is corrected to
  match reality (push-only in v1) during T3; pull negotiation is a non-goal.

## Tasks

### T1 — Shared foreground deadline + truthful fallback (test-first) [done]
- [x] RED observed: cold initialize awaited 15,048 ms against a 1,500 ms
      limit (activation ignored waitMs during startup)
- [x] GREEN: one deadline per activation = `startedAt + waitMs` covering
      startup AND publication wait across all matched servers; expiry
      attaches cached diagnostics with pending/unavailable labels; startup
      continues in background; per-server ensure loop respects the
      remaining budget; reads unchanged (immediate `await work`)
- [x] Tests: cold start exceeding `waitMs` returns in budget with pending
      label; mixed ready/cold servers; truthful labels; reads unchanged
- [x] Checks: typecheck, lint, test (132 passing / 26 files), build
- Route: delegated (gentle-ai-worker).
- Commit: `a5deaa8` — feat(runtime): bound edit feedback with a shared
  startup deadline (+102/−55 activation.ts, +40 tests; 2 files)
- Assess: medium (executable_change), writerProfile large (runtime);
  writer self-verification stands, no separate verifier; reviewDue false
  (under budget) → native review deferred to slice close. Review note for
  close: potential unhandled rejection if activation work rejects after a
  deadline win (current paths return outcomes; T2 covers failure
  accounting).

### T2 — Lifecycle reliability: dead transports, races, shutdown (test-first) [done]
- [x] Probe: protocol connection emits `onClose` after clean child exit;
      close can precede the child `exit` event (observed exit code 0).
      Recorded in client.ts + probe test
- [x] RED/GREEN: post-ready clean exit left client `ready` before; now
      close/exit → `failed` state (first failure wins), failure listeners,
      pool eviction + disposal, honest line, respawn under existing
      cooldown/three-strike rules; one crash = one consecutive failure
      (WeakSet dedup)
- [x] RED/GREEN: `dispose()` idempotent, awaits `pendingClients`, late
      factory results disposed + refused without counting; activation after
      dispose refused
- [x] RED/GREEN: store rejects older/unversioned publications replacing a
      versioned snapshot; concurrent cold-start coalescing regression-tested
- [x] Regression: cooldown suppression, disable-after-3, success reset,
      per-server/root isolation green; request-timeout semantics unchanged
- [x] T1 review note resolved: `Promise.race` keeps handlers on background
      work — late rejection observed; no catch needed
- [x] Checks: typecheck, lint, test (139 passing / 26 files), build
- Route: delegated (gentle-ai-worker).
- Commit: `0e3f439` — feat(runtime): detect dead transports and harden
  session lifecycle (8 files, +180/−21)
- Assess: medium, writerProfile large (runtime), self-verification stands;
  reviewDue TRUE (slice_budget_reached, 531 lines over main) → slice-close
  native review due before T3; native continuation: `gentle-ai review
  status --cwd=<repo> --contract=gentle-ai.review-integration/v2
  --next-transition=true --base-ref=main --committed-only=true`

### T3 — Config exposure: schema, merge, validate, wiring, docs (test-first) [pending]
- [ ] `schema/lsp.schema.json`: optional per-server lifecycle integers with
      min/max bounds (`additionalProperties` discipline preserved)
- [ ] `src/config/{types,merge}.ts`: fields + global→project→per-server
      precedence; defaults preserved when omitted
- [ ] `src/config/validate.ts`: reject invalid values (error, never clamp)
- [ ] `src/runtime/session.ts` `defaultClientFactory` forwards configured
      values into `ClientOptions` / session retry options
- [ ] README + bundled schema copy updated; push/pull wording corrected to
      push-only v1
- [ ] Tests: merge precedence matrix, defaults, invalid-value rejection,
      bundled-schema fixtures
- [ ] Checks: full gate
- Route: delegated.

## Non-goals

- Pull-diagnostics negotiation (`textDocument/diagnostic`) — later feature.
- Half-open / automatic recovery after session disable — separate product
  decision only if users ask.
- Config file watching / hot reload; incremental document sync; subtree
  trust; new runtime dependencies; trust semantics changes.
- Killing a server because one request timed out.

## Constraints

- Baseline: `main` @ ea22950; 130 tests / 26 files green.
- Branch `feat/graceful-degradation` off main before the first write.
- Test-first per task (RED observed before GREEN); record evidence below.
- Per-task work-unit commit (Conventional Commit) with commit identity
  recorded here; ~400 authored changed lines per task is an advisory
  heuristic only, never a forced split.
- Delivery strategy: ask-on-risk (forecast ~450–650 authored lines total).
- RDD: assess per work-unit commit; native review at close per the mirrored
  contract.
- Merge/push/PR remain user decisions.

## Progress log

- 2026-10-03: user requested actionable steps before implementing; this
  document records them. Implementation not yet started — awaits explicit
  go. No source writes.
- 2026-10-03: implementation authorized ("Lets execute the tasks"). Branch
  `feat/graceful-degradation` created off `main` @ ea22950. Unrelated
  dependency-range refresh already present in the worktree committed as a
  separate chore (with `.codegraph/` gitignored); feature plan committed as
  docs. T1 delegated to `gentle-ai-worker` (background).
- 2026-10-03: T1 complete — a5deaa8. RED observed (15,048 ms vs 1,500 ms
  limit), GREEN with 132 tests / 26 files; parent spot check re-ran the
  full suite and reviewed the diff. Assess medium/large-writer →
  self-verification stands; review deferred to slice close (running count
  102 authored lines incl. housekeeping). T2 delegated.
- 2026-10-04: T2 complete — 0e3f439. RED observed for dead-transport,
  shutdown-race, and stale-publication gaps; 139 tests / 26 files; parent
  spot check re-ran suite + reviewed session/client/store diffs. Assess
  medium/large-writer → self-verification stands; reviewDue true
  (slice_budget_reached, 531 lines) → delivery menu + slice-close review
  before T3.
