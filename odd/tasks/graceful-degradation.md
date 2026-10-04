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

### T1 — Shared foreground deadline + truthful fallback (test-first) [in progress]
- [ ] RED: edit with a cold server whose initialize exceeds `waitMs`
      currently awaits startup beyond the deadline (awaited `ensure()` in
      `src/runtime/activation.ts` before the bounded publication wait)
- [ ] GREEN: one deadline per activation = `startedAt + waitMs` covering
      startup AND publication wait; expiry attaches cached diagnostics with
      pending/unavailable labels via the existing format paths; startup
      continues in background; the sequential per-server `ensure()` loop
      respects the remaining budget across multiple matched servers
- [ ] Tests: cold start exceeding `waitMs` returns within budget with a
      pending label; mixed servers (one ready, one cold); label
      truthfulness (waited vs pending vs stale); reads unchanged
- [ ] Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- Route: delegated (gentle-ai-worker).

### T2 — Lifecycle reliability: dead transports, races, shutdown (test-first) [pending]
- [ ] Probe and record what the protocol connection emits on clean child
      exit after readiness (new exit-after-ready mode in
      `tests/fixtures/fake-lsp-server.mjs`)
- [ ] RED/GREEN: post-ready child exit / connection close → client failure
      state; pooled client evicted + disposed (reuse `recordStartFailure`);
      honest per-server failure line; next activation respawns under the
      existing cooldown/three-strike rules
- [ ] RED/GREEN: `dispose()` clears/aways `pendingClients`; activation after
      dispose refused; no leak of late-finishing clients
- [ ] RED/GREEN: late or generation-mismatched diagnostics never presented
      as current; concurrent activation counts one attempt/one failure per
      pool key
- [ ] Regression: cooldown suppression, disable-after-3, per-server/root
      isolation unchanged (existing retry-policy tests stay green)
- [ ] Checks: full gate
- Route: delegated.

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
