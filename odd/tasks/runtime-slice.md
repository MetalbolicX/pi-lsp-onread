# Feature: runtime-slice

## Objective

The vertical slice: successful matching source read → match servers → trust
gate → start/reuse pooled server (background) → cached diagnostics attached
to the agent's tool results with honest freshness. Edit/write requests
bounded fresh feedback (user-confirmed this session: wait ≤5s total budget,
then attach whatever exists). Extension registers real Pi hooks.

## Authority

- Decisions: reads warm up in background, never wait, attach cached
  diagnostics with explicit freshness (current/version-known | stale |
  unknown); pending indicator on first use; silence never implies clean
  compilation. Edits/writes: wait ≤5s (schema defaults confirmed).
- Trust: exact-match allowlist (feat/trust-gate); untrusted roots never
  spawn; denial uses untrustedGuidance() verbatim.
- Pooling: serverId + canonical root; coalesced startup; session-owned and
  disposed. No process spawning in the extension factory (lazy on first
  activation event).
- Diagnostics policy from effective config: severities [error] default,
  maxItems 10, maxChars 4000 — caps global across matched servers for the
  file. Push (publishDiagnostics) first; pull only if server capability
  negotiates it.

## Tasks

### T1 — LSP client + transport + document sync (test-first) [done]
- [x] RED observed; GREEN: src/lsp/{transport,client,documents}.ts +
      tests/fixtures/fake-lsp-server.mjs; createProtocolConnection via
      vscode-languageserver-protocol/node; full-text sync documented as v1
      choice; settings via workspace/didChangeConfiguration; coalesced init;
      typed ENOENT; bounded dispose with SIGTERM→SIGKILL
- [x] Checks: typecheck, lint, test (97 passing), build
src/lsp/{client,transport,documents}.ts: spawn via args array (never shell),
createProtocolConnection over child stdio (vscode-languageserver-protocol
already a dependency — read its node_modules types; NO new deps), initialize
with config initializationOptions/settings + capabilities, initialized,
didOpen/didChange with integer versions, publishDiagnostics subscription,
graceful shutdown/exit + dispose; connection errors surface as typed
results, never crashes. tests/fixtures/fake-lsp-server.mjs controllable fake
(JSON-RPC over stdio: publishes diagnostics for opened docs, configurable
delay/version) + tests/unit/lsp/. Route: delegated.

### T2 — Diagnostics store + policy + format (test-first) [done]
- [x] RED observed; GREEN: src/diagnostics/{types,store,policy,format}.ts —
      latest-wins snapshots, freshness current/stale/unknown (+pending via
      absence), global severity filter + maxItems/maxChars caps with dropped
      counts, deterministic read/edit formatting, never claims clean compile
- [x] Checks: typecheck, lint, test (104 passing), build
src/diagnostics/{types,store,policy,format}.ts: snapshots keyed
(serverId, uri) with doc version at publication; freshness = current
(version-known match) | stale | unknown; pending state; policy severity
filter + global maxItems/maxChars; format renders agent-facing block with
freshness labels and pending indicator, never "clean compilation" claims.
Pure. Route: delegated.

### T3 — Runtime session + activation (test-first) [done]
- [x] RED observed; GREEN: src/runtime/{session,activation}.ts — pooled lazy
      clients keyed serverId::canonicalRoot, canonical-root trust gate BEFORE
      any client creation (untrusted → guidance, pool untouched), read path
      never waits (pending on first use), edit path bounded single waitMs
      budget across servers matching current doc version (versionless
      publications → unknown freshness), per-server failure lines without
      aborting siblings, injectable client/fs/clock seams, dispose kills all
- [x] Checks: typecheck, lint, test (114 passing), build
src/runtime/{session,activation}.ts: session owns effective config, trust
store, pool (serverId+root), diagnostics store; activate(filePath, event):
resolve root (workspace/roots), match (workspace/match), authorize
(runtime/authorization — untrusted: guidance result, NO spawn), ensure
pooled server lazily with coalescing, sync document, then read path =
attach cached nonblocking (pending if none) / edit path = bounded wait for
fresh publication matching current version within waitMs, then attach.
dispose() kills children. Tests with fake server fixture. Route: delegated.

### T4 — Pi hooks + results + extension wiring (test-first) [done]
- [x] SDK explored: async tool_result transform + session_shutdown supported
- [x] GREEN: src/pi/{hooks,results}.ts + real src/extension.ts factory —
      read results nonblocking (cached at handler time + background warmup),
      edit/write await activation (bounded by waitMs), lazy session on first
      event (no spawn in factory), disposal on session_shutdown, failures
      never break the tool call; README extension section
- [x] Checks: typecheck, lint, test (119 passing), build
src/pi/{hooks,results}.ts + src/extension.ts: worker MUST read installed Pi
SDK docs (docs/extensions.md under the pi-coding-agent package) and types,
use the exact supported event/tool_result augmentation API, and STOP with a
report if tool_result augmentation is not supported. Register read/edit/
write result augmentation; augment with formatted diagnostics (read: cached;
edit/write: waited); lazy session creation — NO spawn in factory; disposal
on session end. README extension section. Route: delegated.

## Non-goals

- CLI changes; pull-diagnostics-only servers; per-server overrides beyond
  schema; config reload watching; ReScript build prompts; telemetry.

## Constraints

- No new dependencies. Strict NodeNext; oxlint clean; English artifacts.
- src/lsp, src/diagnostics, src/runtime never import Pi SDK or src/pi.
- Fake server tests must not hit network or real language servers.
- Branch feat/runtime-slice (off feat/trust-gate). Push/PR/merge: user.

## Verification evidence

(Baseline 615c783: 92 tests / 17 files green. Record per task.)

## Delivery

- Cached feature-branch-chain. RDD on: assess per commit (boundary 615c783),
  native review at slice close.

## Progress log

- 2026-10-02: user confirmed edit behavior (wait ≤5s); feature opened before
  first write; branch feat/runtime-slice from 615c783; T1–T4 defined.
