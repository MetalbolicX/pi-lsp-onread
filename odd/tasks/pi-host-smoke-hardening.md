# Feature: pi-host-smoke-hardening

**Executed.** Plan authored and approved before implementation;
Strengthen
what the real-Pi-host smoke actually proves: trusted server usability,
cold read activation, and production shutdown. First of three planned
slices; surfaces are disjoint from
[Rust investigation](rust-compatibility-investigation.md) (default order,
parallel only by explicit decision); outcomes land in
[ledger closure](ledger-followup-closure.md).

## Baseline and evidence

Planning baseline: synchronized `main` at
`ede820fc5c560f3d58521f41f0213e4d3ed97f80`. Planning branch:
`feature/ledger-followup-plans`. Historical evidence:
[pi-host-smoke](pi-host-smoke.md). The gap bullets below are the
pre-implementation findings; each was fixed and verified in this slice
(Log L1–L3).

- S4's trusted half accepts the generic string `coverage:`; that alone
  does not prove positive coverage or successful server diagnostics.
- S4 initializes the trusted session before S3 reads. S3 therefore
  does not isolate cold read activation; its read result is only logged.
- S5 checks raw `AgentSession.dispose()` does not throw and that a
  process count is a number. Neither proves production shutdown cleanup.
- R3-001 is an approved, non-blocking reliability advisory at the
  historical location `pi-host.smoke.test.ts:372`. Original descriptive
  prose was not recovered. These gaps are current-source findings,
  not reconstructed reviewer instructions. Do not reopen its receipt.

## Work units and reasons

| Unit | Action | Why | Exit evidence |
|---|---|---|---|
| H0 | Read the installed SDK's lifecycle implementation and complete relevant SDK/extension docs; identify the supported production shutdown path and a read-only way to track fixture-owned server processes. Record BOTH SDK versions in play — the repo devDependency the smoke actually runs (resolved 1.1.x at plan time) and the installed Pi host (1.2.0 at plan time) — and confirm which lifecycle the recorded session_shutdown gap describes. | Raw session disposal is not production shutdown; avoid inventing an API or mistaking unrelated gopls instances for leaks. The smoke exercises the devDependency, not the installed host: hardening against a skewed lifecycle would target the wrong behavior. | Both exact versions with resolution evidence, API/source references, lifecycle sequence, and ownership strategy recorded; a devDependency bump is a separately authorized dependency change, not in-scope; unsupported access is an explicit blocker. |
| H1 | Tighten S4: retain the untrusted no-spawn assertion; require successful, positive server coverage and the deliberate diagnostic after CLI trust grant in a fresh session. | Generic coverage text can pass without a usable server. | Observed failing negative control, then passing real trust transition; bounded polling handles initialization lag. |
| H2 | Give S3 a separate fresh trusted session with no preceding diagnostics call. Assert successful built-in read and prove activation before any explicit diagnostics request. Remove the hidden S4-before-S3 coupling: every scenario owns its setup or asserts its ordering requirement explicitly. | The current warmed session cannot establish that read triggers activation; the present requireSessionB()-style coupling breaks silently under reordering or shuffle. | No fixture server before read; evidence of read-triggered activation without a diagnostics trigger; then fresh deliberate-error output; no scenario implicitly depends on another's execution order. |
| H3 | Exercise H0's production shutdown path and enforce bounded exit of fixture-owned children. Keep raw SDK dispose as a separately labeled observation if useful. | The current vacuous count assertion cannot catch lifecycle regressions. | Shutdown event/disposal evidence plus owned-process exit within a deadline; cleanup works on partial setup/test failure. |
| H4 | Run the complete battery and document changed guarantees and remaining limitations. | Stronger assertions must not weaken isolation, read latency, or the other smoke suites. | Commands, exit codes, observations, and review disposition recorded. |

## Acceptance and test-first contract

- [x] Bare tests do not spawn servers, mutate HOME, or require credentials.
- [x] CLI-authored config/trust, built bundle, scripted no-network model,
      isolated storage, and all 18 registered tools remain covered.
- [x] S4 proves both refusal and real trusted usability, not text alone.
- [x] S3 proves cold read-triggered activation independently of S4.
- [x] No scenario silently depends on another's execution order:
      explicit per-scenario setup or an explicit ordering assertion.
- [x] H0 selects an observable supported seam; if activation cannot be
      distinguished without private SDK APIs, pause rather than weaken
      the claim or change product source silently.
- [x] Production shutdown exits owned children with a bounded wait;
      unrelated processes are never killed. A failed shutdown fails S5.
- [x] Exact-name global process counts are supplementary observations,
      not the ownership oracle. Cleanup is idempotent and runs on failure.
- [x] HOME and scripted credential environment are restored after failure.

For deterministic behavior changes, observe RED → GREEN with meaningful
negative cases (zero coverage, read failure/no activation, missing shutdown
cleanup). Choose the precise fault-injection seam in H0; do not claim a
failing old test proves a contract it never asserted. Passive lifecycle
research has no meaningful RED; record source evidence instead. Do not
intentionally leak real children to manufacture RED.

## Boundaries, commits, and verification

Proposed implementation branch: `feature/pi-host-smoke-hardening`, created
only after authorization from the then-current reviewed base. H1–H3 share
smoke/fixture surfaces and run sequentially. Primary edit surfaces:
`tests/smoke/pi-host.smoke.test.ts`, `tests/smoke/pi-host-fixture.ts`;
README and this plan only for accompanying evidence/guarantees. No `src/`,
SDK dependency, or script changes without a scoped follow-up decision.

Commit by independently working behavior, tests alongside it; combine
units if their lifecycle scaffolding cannot safely stand alone. Forecast
authored diff before writing; split coherent slices near the 400-line
review budget, never weaken tests to fit. Rollback removes only the new
host-smoke contracts/scaffolding, leaving the shipped extension unchanged.

Future verification: `pnpm smoke:pi-host` (build-first), `pnpm test`,
`pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm smoke:gopls`, and `pnpm smoke:rust-analyzer`. Record actual outcomes;
follow applicable native assessment/review requirements at each candidate.
No merge, push, or new native review is authorized by this plan.

## Status

H0–H4: **complete** on `feature/pi-host-smoke-hardening` — `886c415`
harness contracts (H1–H3, +301/−90) plus this closure record. Execution
evidence in the Log below. The Rust investigation is next; its existing
recorded findings are not prerequisites for the now-fixed local smoke
contracts.

## Log

- L1 (H0 discovery): devDependency resolved **1.1.0 exact** (repo
  declares `^1.1.0`); global Pi host **1.2.0** (pnpm hash `2bf4a-…`;
  the plan-time `1067-…` path hash was stale — corrected).
  `session_shutdown` emission is **identical in both versions**:
  `AgentSessionRuntime.dispose()` emits `{reason:"quit"}` before
  `session.dispose()` (1.1.0 `agent-session-runtime.js:298`), while raw
  `AgentSession.dispose()` emits nothing (1.1.0
  `agent-session.js:992-1013`; 1.2.0 `:996`) — the recorded S5 gap is
  version-independent; no dependency bump needed. Production path is
  fully public (package root `index.d.ts:20`):
  `createAgentSessionServices` → `createAgentSessionFromServices` →
  `new AgentSessionRuntime(session, services, factory)`. gopls spawns as
  exactly `["gopls"]` with `cwd = projectRoot` (`transport.ts:26-31`),
  no env marker → ownership oracle = read-only `/proc/<pid>/cwd`
  realpath compare against the fixture root. Extension teardown chain:
  `pi.on("session_shutdown")` (`src/extension.ts:231-244`) →
  `RuntimeSession.dispose()` → SIGTERM→500ms→SIGKILL
  (`transport.ts:48-67`).
- L2 (H1–H3, one worker pass, `886c415`): **H2 real RED** captured
  pre-restructure — S3's new pre-read assertion on the old warmed
  sessionB failed: `expected [ 186663 ] to have a length of +0 but got
  1` (S4 had already activated gopls). GREEN after: fresh session sees
  0 owned pre-read → read success → owned ≥ 1 → `undefinedHelper` +
  `fresh: current`. **H1** strengthened-contract / passed-pre-change
  (honest; the pre-change S4 output — `pending — no diagnostics received
  yet from go` + `coverage: 1 server(s) checked` — is the exact
  zero-coverage pass the old contract accepted). **H3**
  strengthened-contract / passed-pre-change: production shutdown passed
  first green (`S5 owned gopls after runtime.dispose() = <none>`).
  Justified deviation: ALL host sessions build through the production
  runtime path, not only S5 — the cwd-scoped oracle and S5's `owned == 0`
  assertion require every scenario to reap its own children (a raw
  session would leak an owned gopls past its scenario). S4 pre-trusted
  skip verified under 2 `--sequence.shuffle` runs. Worker validation:
  5/5 ×3 + 5/5 ×2 shuffle; bare suite skipped cleanly; lint/tsc/format
  clean.
- L3 (H4, parent battery on `886c415`): bare `pnpm test` 506 passed /
  21 skipped (52 files); lint, typecheck, build, `format:check` clean;
  gopls smoke 8/8; rust-analyzer smoke 8/8; `smoke:pi-host` 5/5
  (build-first); 0 orphan gopls / rust-analyzer processes; tree clean.
  README unchanged — its `smoke:pi-host` command reference (line 95) is
  still accurate.
