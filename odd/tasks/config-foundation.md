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

### Task 2 — Config module (test-first) [pending]
- [ ] RED: `tests/unit/config/{load,merge,validate}.test.ts` fail for missing module
- [ ] GREEN: `src/config/{types,schema,load,merge,validate,index}.ts`
- [ ] ajv (2020-12 dialect) validates source files against bundled schema JSON
- [ ] Merge: defaults < global < project; recursive objects, replace
      arrays/scalars; `lsp:false` disables all; `disabled:true` tombstone needs
      no command; diagnostics defaults onRead=cached, onChange=wait, waitMs=
      5000, severities=[error], maxItems=10, maxChars=4000
- [ ] Semantic validation on merged config: enabled servers need nonempty
      command; extensions nonempty; languageId map consistent
- [ ] Actionable errors (file + reason), malformed JSON never crashes
- [ ] Checks: typecheck, lint, test (all pass), build
- Route: delegated (gentle-ai-worker; multi-file write trigger).

### Task 3 — Workspace module (test-first) [pending]
- [ ] RED: `tests/unit/workspace/{paths,roots,match}.test.ts`
- [ ] GREEN: `src/workspace/{paths,roots,match}.ts`
- [ ] paths: file URI conversion with correct percent-encoding
- [ ] roots: nearest ancestor with any rootMarker within project root,
      fallback project root
- [ ] match: extension match + scalar-or-map languageId; enabled servers only
- [ ] Checks: typecheck, lint, test, build
- Route: delegated (gentle-ai-worker; multi-file write trigger).

## Verification evidence

(Recorded per task as `<command>: <result>`; baseline all green @ 208cdfe
per odd/tasks/scaffold.md and re-verified at Task 1 start.)

- Task 1 (worker + parent spot check): `pnpm typecheck` exit 0; `pnpm lint`
  exit 0; `pnpm test` exit 0, 11 tests; `pnpm build` exit 0, dist/extension.js
  + dist/cli.js present; parent re-ran `pnpm test` → 11 passing.

## Delivery

- Strategy: ask-on-risk (default). Forecast ≈ 950 authored lines (T1 ~150,
  T2 ~500, T3 ~300) → oversized-delivery menu fires once before the commit
  that crosses ~400 accumulated authored lines.
- Work-unit commit per task on `feat/scaffold`; push/PR/merge stay with user.
- RDD: on. Assess after each work-unit commit (first boundary 208cdfe);
  record tier + outcome per task.

## Progress log

- 2026-10-02: feature opened before first write; tasks 1–3 defined.
