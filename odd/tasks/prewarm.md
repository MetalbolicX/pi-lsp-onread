# Feature: prewarm

Roadmap **T3.1** — the first Tier 3 slice. Tier 2 (nine AI-facing tools) and the
foundation hardening pass are complete and merged to `main`.

## Objective

Optionally start configured LSP servers in the background at Pi `session_start`,
before the first AI tool call, so an explicitly opted-in project skips cold-start
latency on its first `read`/`edit`-driven activation. Default **off**; per-server
opt-in; trust-checked; reuses the existing demand-driven activation machinery
without changing its semantics.

## Authority

Roadmap tier 3 item 1 (memory obs 11426): "explicitly configured trust-checked
prewarm default off after lifecycle validation". The lifecycle precondition is
satisfied (`graceful-degradation`: dead transports, shutdown races, coalescing,
three-strike disable; `hardening-pass`: shared client lookup). User authorized
Tier 3 work ("Start working on T3") on 2026-10-05.

## Resolved design decisions

1. **Kick point**: `pi.on("session_start", ...)` in `src/extension.ts`. Pi's
   extension docs: "Do not start processes ... in the factory"; "Start
   long-lived resources from `session_start`". Fire-and-forget, errors logged
   via `logError`, gated by `disposed`.
2. **Which servers**: every enabled server in the effective config whose
   `prewarm === true`, for the canonicalized `ctx.cwd` root. A server config
   with `prewarm: true` is an explicit user statement of intent for that
   project's config file.
3. **Trust**: canonicalize the root and run the same `authorize` gate as
   `activate()` (`src/runtime/activation.ts:31-35`). Untrusted → no start,
   nothing surfaced (log only). Never bypasses or widens trust.
4. **Reuse, not redesign**: start = `session.getOrCreateClient(serverId,
   canonicalRoot)` + `client.ensure()` + `recordStartFailure/Success` —
   mirroring `activation.ts:58-80`. Cooldown, three-strike, and coalescing
   (pendingClients) come free. `activate()` edit-deadline semantics untouched.
5. **Default off**: absent or `false` `prewarm` spawns nothing (regression
   tested). No config watching / hot reload (non-goal family-wide).
6. **No documents opened**: prewarm performs initialize only; document
   syncing stays demand-driven.
7. **Config surface**: `prewarm?: boolean` beside the four lifecycle ints
   (`ServerConfig`); schema `$defs.server` gains `{type:"boolean"}` (the object
   is `additionalProperties:false`, so schema MUST be extended); merged by the
   generic scalar merge (no merge.ts change); validated as boolean with error
   path `/lsp/<id>/prewarm`, never clamped.

## Tasks

### P1 — Config surface: schema, types, validate, docs (test-first)
- [x] RED observed: valid `prewarm: true` rejected by schema (unknown prop);
      non-boolean values accepted by validation
- [x] GREEN: `schema/lsp.schema.json` `$defs.server` `prewarm` boolean
      (default false); `ServerConfig.prewarm?: boolean`;
      `validateEffectiveConfig` boolean check (error `/lsp/<id>/prewarm`,
      undefined allowed); merge layering + omitted-keeps-off regressions;
      load accepts valid / rejects `"yes"`
- [x] README lifecycle-settings section documents `prewarm` (default `false`)
- [x] Focused config tests 17 passing
- Route: delegated (gentle-ai-worker).

### P2 — Runtime prewarm primitive (test-first)
- [x] RED observed: no prewarm primitive existed
- [x] GREEN: `src/runtime/prewarm.ts` `prewarmServers(session, {canonicalRoot,
      logError})` — effective-config guard (`lsp === false` off), trust gate
      (canonicalizeRoot + authorize), per-server `prewarm === true` filter,
      `disabled` skip, `getOrCreateClient` + `ensure()` +
      `recordStartFailure/Success` per pool key, per-server error isolation
- [x] RED→GREEN tests (`tests/unit/runtime/prewarm.test.ts`): default off
      spawns nothing; untrusted spawns nothing; enabled+trusted starts and
      demand activation coalesces to one factory call; failure counts once +
      cooldown honored; repeated invocation never double-starts
- Route: delegated (gentle-ai-worker).

### P3 — Extension wiring (test-first)
- [x] RED observed: no `session_start` handler existed
- [x] GREEN: `session_start` handler fires `prewarmServers` fire-and-forget
      with `ctx.cwd`, `disposed`-gated before AND after `getSession` (shutdown
      race), errors via `logError` never thrown; `session_shutdown` keeps
      disposing late starts
- [x] Checks: 418 tests / 43 files passing; lint 0; typecheck clean; build
      clean; `git diff --check` clean (independently re-run by
      gentle-ai-verify, mutation check clean)
- Route: delegated (gentle-ai-worker).

## Non-goals

- T3.2 turn-end scorecard; T3.3 tool_call preflight (separate features).
- Config file watching / hot reload; automatic prewarm without explicit
  per-server opt-in; opening documents at session start; pull-diagnostics
  negotiation; changes to trust semantics; changes to activation deadlines.

## Constraints

- Baseline: `main` @ `4e94181`; 409 tests / 42 files green.
- Branch `feature/prewarm` off `main` before the first write (created).
- Test-first per task (RED observed before GREEN); record evidence below.
- Per-task work-unit commit (Conventional Commit), commit identity recorded
  here; ~400 authored changed lines advisory.
- Workers never commit; parent reviews hunks, verifies via `gentle-ai-verify`,
  and makes work-unit commits.
- RDD: assess per work-unit commit; slice review at close with explicit
  committed base range (branch base = `main` @ `4e94181` full SHA).
- Merge/push/PR remain user decisions.

## Progress log

- 2026-10-05: authorized ("Start working on T3"). Design inputs scouted
  (config flow, activation/ensure structure, extension startup, test
  conventions); kick timing resolved against Pi extension docs
  (`session_start`). Branch created. P1 delegated.
- 2026-10-05: P1–P3 complete via one worker task (first delegation rejected
  for a non-canonical allowed-surfaces block; relaunch with proper heading).
  Work units: 05fae56 (config), d62f17b (runtime+wiring), 3d456a5 (README).
  Parent spot checks: prewarm.ts default-off/trust/accounting/isolation;
  extension double disposed-gate; validate boolean path; schema placement.
  Accepted nuance: session_start now creates the RuntimeSession eagerly
  (config load only; no server starts unless `prewarm: true`).

## Review record

- Slice review APPROVED — lineage `review-c9a4b74e890b0a42`, medium tier
  (`configuration_change` on `schema/lsp.schema.json`), review-reliability
  lens, 11 paths / 324 lines, correction budget 162, base
  `4e94181c7150bf7152e1090f7ea1d2e2fe1b98c5` (committedOnly). Reviewer
  forecast (1 host-relay run) acknowledged; approved on the last admitted
  event; acknowledgement burned (consumed revision `sha256:abe7c522…`).
  Delivery: ordinary repository policy.
