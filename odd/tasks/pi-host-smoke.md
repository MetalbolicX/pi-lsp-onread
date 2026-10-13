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
| T1 | Spike: scripted-model interface on SDK 1.1.0 — one scripted tool call through a real session (temp agentDir, in-memory manager) | inline (`/tmp` probe) | scripted call executes a registered tool; Model shape documented in Log | **done** — run 9 SPIKE-OK (9 runs; recipe in L2) |
| T2 | Harness: `tests/smoke/pi-host.smoke.test.ts` + fixture + `smoke:pi-host` script; env-gated, isolated HOME/agentDir | worker | bare `pnpm test` skips it; `smoke:pi-host` reaches S1 | **done** — worker (one pass with T3); 5/5 stable ×3 |
| T3 | Scenarios S1–S5 wired and green; layer-1 smokes unaffected | worker (sequential — same files as T2) | `smoke:pi-host` 5/5; gopls 8/8; rust 8/8; bare suite unchanged | **done** — same worker pass; parent battery verified all |
| T4 | Closure: full battery, README (`smoke:pi-host` mention), assess + review per RDD | inline + native | all green; slice review burned | **done** — battery green; README updated; assess recorded below; review per RDD |

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

- L2 (T1 spike, 9 runs, final SPIKE-OK): the scripted no-network session
  recipe on SDK 1.1.0 —
  1. `DefaultResourceLoader({ cwd, agentDir: <temp>, extensionFactories,
     additionalExtensionPaths: [<abs dist/extension.js>] })`;
  2. `await resourceLoader.reload()` BEFORE session creation (extension
     factories load and their tools register only on an explicit reload);
  3. own the model path: `ModelRuntime.create({ authPath, modelsPath }`
     under temp) + `modelRuntime.registerProvider("scripted", { apiKey:
     "$PI_HOST_SMOKE_KEY", api: "pi-host-smoke", models: [{ … baseUrl
     required … }], streamSimple })` — a STANDALONE loader can never route
     `registerProvider` into the session's runtime (runs 2–5), and the
     session's pre-flight (`hasConfiguredAuth`) passes only via this owned-
     runtime legacy registration with an env-interpolated apiKey;
  4. `createAgentSession({ resourceLoader, sessionManager:
     SessionManager.inMemory(), model, modelRuntime })` then
     `await session.bindExtensions({})` (session_start lifecycle);
  5. the scripted `streamSimple` pushes `AssistantMessageEvent`s
     synchronously (start → toolcall_* → done(toolUse), then start →
     text_* → done(stop)); credential shape `{ type: "api_key" }`.
  Validation gates learned: provider-level `api` and model-level
  `baseUrl` are required for custom models. Evidence:
  `SPIKE RESULT: requests=2 finalText="SPIKE-DONE"
  marker="hit at …"` → SPIKE-OK.
- L3 (T2+T3 worker pass, commit `046248e`): harness + scenarios in one
  pass — 5/5 stable ×3 runs (~5–7 s). Honest deviations recorded by the
  worker: the CLI preset id is `go` (not `gopls` — my task text was
  wrong; config server id is `go`); `createAgentSession` REQUIRES
  `cwd: projectRoot` (without it ctx.cwd defaults to process.cwd() and
  project `.pi/lsp.json` is silently missed — symptom "No language
  servers match this file."); pi-ai resolved by scanning
  node_modules/.pnpm (same resolution as the spike, avoids
  oxlint's no-require-imports); S4's trusted half + S3 run on a SECOND
  host session created after `trust add` (the extension caches its
  trust result at RuntimeSession.create — a fresh loader+session is
  required to observe newly granted trust). Verbatim key observes:
  S1 `tools in extension map = 18` (errors: []); S2 all 18 lsp_*
  active; S4 untrusted → `Trust this project root with: pi-lsp-onread
  trust add …` with gopls 0/0, then CLI trust add → `coverage: 1
  server(s)`; S3 `go: fresh: current` + `compiler: undefined:
  undefinedHelper`; S5 dispose resolves. RECORDED FINDING (S5, harness
  artifact class): one gopls server + its telemetry child survive
  `session.dispose()` because the raw AgentSession path never emits
  `session_shutdown` (production AgentSessionRuntime does); both exit
  once the vitest worker's stdio closes — no lasting leak (parent
  battery: 0 gopls / 0 rust-analyzer processes after the full run).
  Parent battery on final content: pi-host 5/5, bare 506/49 + 3
  skipped (52 files), lint/tsc/format clean, gopls 8/8,
  rust-analyzer 8/8.

## Review record

- Post-implementation assess (committed range, base
  `c79d1003e49e6944e43565951da0abaf40fae1af`): **medium risk**
  (`configuration_change`: package.json), 5 paths / 679 lines,
  **reviewDue: false (`under_budget`)** — writer self-verification
  stands (worker verbatim outcomes ×3 runs + parent spot-check + full
  battery: pi-host 5/5, both layer-1 smokes 8/8, bare suite unchanged,
  lint/tsc/format clean, zero orphan servers). No native review started
  per entry rule; if a later reminder claims this target, the tight
  base above applies.
