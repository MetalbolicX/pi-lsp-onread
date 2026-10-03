# Feature: config-foundation

## Objective

Implement the foundation of pi-lsp-onread per the approved folder-structure plan:
behavior-preserving reorganization into feature modules, the configuration
module (load/merge/validate against schema v1), and the workspace module
(paths/roots/match). This is Phase 1–2 of the migration plan; the LSP runtime
vertical slice and CLI generation wiring are later features.

## Authority

- Confirmed decisions (Engram): diagnostics-first scope; successful matching
  reads warm servers in background and attach cached diagnostics with truthful
  freshness (never wait, never imply compilation success from silence); no LSP
  server downloads; self-only Pi registration separate from configuration CLI.
- Committed contract: `schema/lsp.schema.json` (v1, Draft 2020-12) is the
  source-file shape authority, including layered merge semantics and
  diagnostics caps/defaults.
- Draft-but-unapproved policies (trust gate, edit-time wait behavior beyond
  schema defaults) are NOT implemented here; runtime/authorization lands with
  the runtime slice feature.

## Scope

- Task 1: Reorganize `src/` into feature layout (behavior-preserving).
- Task 2: `src/config/` module — types, load, merge, semantic validate,
  effective-config builder. Test-first.
- Task 3: `src/workspace/` module — paths (URI), roots (rootMarkers),
  match (file → servers). Test-first.

## Non-goals

- CLI `init/add/check/install` real implementations (stay honest exit-2 stubs).
- LSP client/transport/pool, diagnostics store, Pi hooks, runtime session.
- Any schema contract change (schema is read-only reference; report gaps).
- Trust/authorization policy.

## Constraints

- Package contract stable: `dist/extension.js` (from `src/extension.ts`),
  `dist/cli.js` (from `src/cli.ts`), `schema/lsp.schema.json` packaged.
- Strict TS NodeNext, oxlint clean, vitest; artifacts in English.
- Import direction: features never import entrypoints; no Pi SDK outside
  `src/pi/` (none needed yet); workspace/config stay Pi-free and LSP-free.

## Checklist

### Task 1 — Reorganize into feature layout (behavior-preserving) [done]
- [x] `src/presets.ts` → `src/presets/catalog.ts`; types split to `src/presets/types.ts`
- [x] CLI dispatch → `src/cli/main.ts` + `src/cli/commands/*`; `src/cli.ts`
      thin entrypoint re-exporting `main` (tests import it) with self-exec guard
- [x] `src/extension.ts`: no preset import existed; no edit needed, behavior unchanged
- [x] Tests moved to `tests/unit/`; tsconfig includes tests + resolveJsonModule (+rootDir)
- [x] Checks: typecheck, lint, test (11 passing), build with stable dist paths
- Route: delegated (gentle-ai-worker; multi-file write trigger). No new RED:
  behavior-preserving refactor; existing tests are the regression net.

### Task 2 — Config module (test-first) [done]
- [x] RED: `tests/unit/config/{load,merge,validate}.test.ts` failed against missing module
- [x] GREEN: `src/config/{types,schema,load,merge,validate,index}.ts`
- [x] ajv 2020-12 (`ajv/dist/2020.js`) validates source files against bundled schema JSON (import attribute)
- [x] Merge semantics: defaults < global < project; recursive objects, replace arrays/scalars; `lsp:false`; `disabled:true` tombstone; diagnostics defaults applied
- [x] Semantic validation on merged config incl. exact-cover languageId maps
- [x] Actionable errors; discriminated results; malformed JSON never crashes
- [x] Checks: typecheck, lint, test (20 passing), build
- Route: delegated (gentle-ai-worker; multi-file write trigger).

### Task 3 — Workspace module (test-first) [done]
- [x] RED: `tests/unit/workspace/{paths,roots,match}.test.ts` failed against missing modules
- [x] GREEN: `src/workspace/{paths,roots,match}.ts` (pure, dependency-free, injectable fs checks)
- [x] paths: URI conversion with percent-encoding + round-trip; canonicalize reused by roots
- [x] roots: nearest-marker within project boundary, no escape above projectRoot, fallback projectRoot
- [x] match: case-insensitive extension match, scalar/map languageId, enabled only, lsp:false → [], insertion order
- [x] Checks: typecheck, lint, test (28 passing), build
- Route: delegated (gentle-ai-worker; multi-file write trigger).

## Verification evidence

(Recorded per task as `<command>: <result>`; baseline all green @ 208cdfe
per odd/tasks/scaffold.md and re-verified at Task 1 start.)

- Task 1 (worker + parent spot check): `pnpm typecheck` exit 0; `pnpm lint`
  exit 0; `pnpm test` exit 0, 11 tests; `pnpm build` exit 0, dist/extension.js
  + dist/cli.js present; parent re-ran `pnpm test` → 11 passing.
- Task 2 (worker + parent spot check): RED observed (config tests failed on
  missing module); `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test`
  exit 0, 20 tests (11 existing + 9 config… 20 total across 5 files);
  `pnpm build` exit 0; parent re-ran `pnpm test` → 20 passing.
- Task 3 (worker + parent spot check): RED observed (workspace tests failed
  on missing modules); `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test`
  exit 0, 28 tests across 8 files; `pnpm build` exit 0; parent re-ran
  `pnpm test` → 28 passing.

## Delivery

- Strategy: ask-on-risk (default)… user selected feature-branch-chain at the
  ~400-line menu (cached). Push/PR/merge remain user decisions.

## Follow-ups

- R3-001 (advisory, non-blocking, from native review): src/workspace/match.ts:23
  — reliability WARNING, informational. Separate later work; never reopens the
  approved review.

## Progress log

- 2026-10-02: feature opened before first write; tasks 1–3 defined.
- 2026-10-02: Task 1 done. Work-unit commit 96ee643 (232 authored lines).
  RDD assess: medium (executable_change src/cli.ts), writer profile large →
  writer self-verification stands, no separate verifier; reviewDue at slice
  close (slice_budget_reached). Boundary: 208cdfe → 96ee643.
- 2026-10-02: Slice crossed ~400 authored lines (232 committed + 445 staged).
  ask-on-risk menu fired once; user selected feature-branch-chain
  (chain_strategy=feature-branch-chain). Cached. PR chain creation remains a
  separate user decision.
- 2026-10-02: Task 2 done. Work-unit commit a64cf3c (461 authored lines).
  RED observed before implementation. RDD assess: medium
  (configuration_change package.json), writer large → writer self-verification
  stands; reviewDue at slice close. Boundary: 96ee643 → a64cf3c.
- 2026-10-02: Task 3 done. Work-unit commit 53054a5 (233 authored lines).
  RED observed. RDD assess: medium, writer large, under per-commit budget.
- 2026-10-02: Slice close. Native ordinary review START (committed range
  208cdfe..53054a5): lineage review-25c86ba831a74976, tier medium, lens
  review-reliability, 33 changed files / 1711 changed lines, correction budget
  200. Reviewer run acknowledged after forecast; outcome APPROVED with one
  non-blocking advisory (R3-001). Acknowledgement executed: authority burned
  (gentle-ai.review-acknowledged/v1). Delivery follows ordinary repository
  policy. Feature complete: T1+T2+T3 all done, all checks green.
