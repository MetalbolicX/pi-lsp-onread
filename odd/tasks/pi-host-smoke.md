# Feature: pi-host-smoke

Layer-2 real-Pi-host smoke: load the BUILT bundle (`dist/extension.js`)
into a REAL Pi SDK host and drive it end-to-end with a scripted
no-network model. Closes the gap between layer-1 (fake Pi API +
injected config + RuntimeSession direct) and production (real extension
runtime, real `.pi/lsp.json` discovery, real tool pipeline, real trust
store).

Scope settled with user: **lean 5 scenarios**, **config authored by the
real CLI**, branch **stacked on `feature/hardening-ledger` @ `c79d100`**
(merge order: hardening-ledger → pi-host-smoke).

## Design decisions (settled before implementation)

- **Real host via SDK 1.1.0** (already a devDependency; exports
  verified against the installed typings): `createAgentSession` +
  `DefaultResourceLoader({ cwd: projectRoot, agentDir: <temp>,
  additionalExtensionPaths: [<absolute dist/extension.js>] })` +
  `SessionManager.inMemory()` — the same file-based extension loading
  path pi itself uses (`additionalExtensionPaths` at
  `core/resource-loader.d.ts:75`).
- **Scripted model, zero network** — T1 spike settles the exact Model
  interface shape on 1.1.0: the scripted model returns canned assistant
  messages (`tool_use: read` → `tool_use: lsp_diagnostics` → final
  text). Fallback if the interface differs: custom provider through
  `ModelRuntime`. No real API keys or credentials are touched
  (credential/model storage lives under the temp agentDir).
- **Isolation** — temp `HOME` (set in `beforeAll` of the gated suite)
  isolates BOTH the extension's `homedir()`-derived trust store and
  global config (`~/.pi/agent/lsp.trust.json`, `lsp.json`) AND the
  SDK's default agent dir; the explicit temp `agentDir` +
  `SessionManager.inMemory()` are belt-and-suspenders. The whole suite
  is gated on `PI_HOST_SMOKE=1` so bare `pnpm test` never mutates HOME
  or spawns anything.
- **Config via the real CLI** — `node dist/cli.js add gopls --project
  <tmp> --yes` writes `.pi/lsp.json` (+ schema companion); the
  extension consumes it through real `buildEffectiveConfig` discovery.
  gopls only: the host is the subject under test; per-server behavior
  is layer-1's job.
- **Script** — `"smoke:pi-host": "pnpm build && PI_HOST_SMOKE=1 vitest
  run tests/smoke/pi-host.smoke.test.ts"` (build-first guarantees the
  bundle exists and matches the source tree).
- **Scenarios (lean 5)**:
  - **S1 bundle load** — the built extension loads in the real host;
    `session_start` fires; no load errors.
  - **S2 registration** — all 18 tool names are active on the real
    session; read-only annotations where inspectable.
  - **S3 read-activation end-to-end** — scripted model calls
    `read(src/main.go)` (extension's `tool_call` hook activates gopls
    on the real read), then `lsp_diagnostics` — the deliberate error
    surfaces (fresh/current form); `tool_result` hook path exercised.
  - **S4 trust gate** — untrusted root: `lsp_diagnostics` returns
    untrusted guidance (no server spawn); then `dist/cli.js trust add`
    records the root; the next scripted call succeeds.
  - **S5 dispose** — `session.dispose()` completes cleanly; best-effort
    orphan-server check with honest tolerance.
- **Conventions inherited** — temp-dir fixtures, stdlib-only Go fixture
  source (mirrors layer-1's `go-smoke-fixture.ts` shapes), verbatim
  finding recording, generous timeouts (SDK init 60–90 s; test timeout
  180 s), observes captured with `--silent=false`.

## Tasks

| # | Work | Route | Verification | Status |
|---|------|-------|--------------|--------|
| T1 | Spike: scripted-model interface on SDK 1.1.0 — one scripted tool call through a real session (temp agentDir, in-memory manager) | inline (`/tmp` probe) | scripted call executes a registered tool; Model shape documented in Log | todo |
| T2 | Harness: `tests/smoke/pi-host.smoke.test.ts` + fixture + `smoke:pi-host` script; env-gated, isolated HOME/agentDir | worker | bare `pnpm test` skips it; `smoke:pi-host` reaches S1 | todo |
| T3 | Scenarios S1–S5 wired and green; layer-1 smokes unaffected | worker (sequential — same files as T2) | `smoke:pi-host` 5/5; gopls 8/8; rust 8/8; bare suite unchanged | todo |
| T4 | Closure: full battery, README (`smoke:pi-host` mention), assess + review per RDD | inline + native | all green; slice review burned | todo |

## Verification commands

- `pnpm build`
- `PI_HOST_SMOKE=1 pnpm vitest run tests/smoke/pi-host.smoke.test.ts --silent=false`
- `pnpm test` (bare — new suite skipped, no HOME mutation, nothing spawns)
- `pnpm smoke:gopls` / `pnpm smoke:rust-analyzer` (layer-1 unaffected)
- `pnpm lint && pnpm typecheck && pnpm format:check`

## Non-goals

rust-analyzer in layer-2 (extended option declined); real LLM or
network calls; unit-testing SDK internals; merging (user decides);
extension `src/` changes — if the host smoke exposes a real product
defect, it is recorded as a finding first and fixed in a follow-up
slice (finding-fixes pattern), not silently inside this one.

## Log

- L1 (plan): scope settled with user — lean 5 scenarios, real-CLI
  config authorship, stacked on `feature/hardening-ledger` @ `c79d100`.
  SDK 1.1.0 capability verified in-repo (createAgentSession,
  DefaultResourceLoader + `additionalExtensionPaths`, getAgentDir,
  SessionManager.inMemory all present in the installed typings). The
  scripted-Model interface is the one open unknown → T1 spike with a
  ModelRuntime fallback.

## Review record

- (pending implementation)
