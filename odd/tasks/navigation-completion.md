# Feature: navigation-completion

Next roadmap slice after `gap-closure`: three verified-absent navigation
capabilities (grep counts = 0 in `src/`) — `textDocument/implementation`,
`textDocument/typeDefinition`, and call hierarchy.

## Objective

Complete the read-only navigation family: two one-shot jump requests
(implementation, typeDefinition) as thin extensions of the existing
definition core, plus a new two-phase `lsp_call_hierarchy` tool
(prepare → incoming/outgoing). All capability-gated, bounded, read-only;
null results are valid empties; nothing is ever applied or executed.

## Authority

User "continue" after gap-closure close; capability-absence verified by
grep (implementation: 0, typeDefinition: 0, callHierarchy: 0 hits in
`src/`). Design follows the proven navigation-tools pattern.

## Resolved design decisions

1. **Implementation / typeDefinition = thin kinds, not new contracts.**
   `runNavigation(kind, ...)` (src/pi/lsp-navigation-tools.ts:74) is already
   kind-parameterized; extend `NavigationKind` with `"typeDefinition"` and
   `"implementation"`, add session methods `implementation()`/`typeDefinition()`
   mirroring `definition()` (session.ts:324), add two thin registrations
   (`lsp_implementation`, `lsp_type_definition` — same `{path, line,
   character}` params), wire in extension.ts beside the existing
   registrations. `formatLocations` reused unchanged. Gates:
   `capabilities().implementationProvider` / `typeDefinitionProvider` truthy.
2. **Call hierarchy = one new tool, two-phase.**
   Session: `prepareCallHierarchy()` (gate `callHierarchyProvider` truthy;
   null ⇒ ok empty items) and `callHierarchyCalls(direction, item)` (request
   `callHierarchy/incomingCalls|outgoingCalls`; direction-literal typed).
   Tool `lsp_call_hierarchy {path, line, character, mode?, item?}`:
   - `prepare` (default): numbered items per server — name, kind name,
     truncated detail, `file:line:char` from selectionRange, plus an
     explicit footer instructing to pass an item back verbatim as `item`
     with `mode: incoming|outgoing`.
   - `incoming`/`outgoing`: requires an object `item` (else an error line
     naming the remedy — prepare first); per-server sections; each call
     line names from/to with positions from ranges; bounded counts.
   - No `item` trust assumptions: the item is echoed back to the server
     only (read-only request, server-validated).
3. **Fixture**: implementation/typeDefinition handlers ride the existing
   `FAKE_NAVIGATION` flag (same Locations shape; distinct target files so
   tests can assert each); call hierarchy gets its own `FAKE_CALL_HIERARCHY`
   flag (prepare + both directions + capability advertisement) so
   supported/unsupported paths are independently testable.
4. **Bounds/footers** follow the navigation-tools conventions:
   `MAX_OUTPUT_CHARS`, 5s timeout cap, per-server sections, failure +
   unsupported naming, coverage footer, line-structure assertions.
5. **Symbol-kind names** reuse the existing kind rendering if exported
   (src/symbols/format.ts or navigation/format.ts); otherwise a local map
   (worker picks the smaller diff, notes the choice).

## Tasks

### N1 — Implementation + typeDefinition (test-first)
- [x] RED observed: 16 focused failures (`implementation()`/`typeDefinition()`
      absent, fixture handlers absent)
- [x] GREEN: shared `navigationLocations` helper (capability gate, null ⇒
      ok empty, Location|Array|LocationLink normalization, 1000 cap,
      never-throws) behind `implementation()`/`typeDefinition()`;
      `NavigationKind` extended; `lsp_implementation` +
      `lsp_type_definition` thin registrations (shared `definitionParams`);
      extension wiring; fixture handlers under FAKE_NAVIGATION with
      distinct target files; tests
- Route: delegated (gentle-ai-worker), commit `21ccad6` (with N2 — shared
  files made per-task splits dishonest; one coherent behavior unit).

### N2 — Call hierarchy (test-first)
- [x] RED observed: no prepare/calls path (missing registration + session
      method)
- [x] GREEN: `prepareCallHierarchy` + `callHierarchyCalls` (direction-literal,
      gated `callHierarchyProvider`, 1000 cap, never-throws);
      `lsp_call_hierarchy` tool — mode validation, missing-item remedy line
      BEFORE activation, prepare listing (index/name/kind/detail/file:line:char)
      + verbatim-item footer, incoming/outgoing sections, footer-preserving
      char truncation, `symbolKindName` local map (no exported helper
      existed), FAKE_CALL_HIERARCHY fixture flag with handlers
- [x] Tests: `tests/unit/pi/lsp-call-hierarchy.test.ts` (prepare, both
      directions, remedy, unsupported, bounds, line structure)
- Route: delegated (gentle-ai-worker), commit `21ccad6`.

### N3 — Docs + closure (parent)
- [x] Parent integration fixes: misplaced JSDoc relocated;
      **count-cap honesty marker added** (`… N more entries omitted (cap 100)`)
      — the worker's >100 slice dropped silently against project norm
- [x] README: definition/references bullet extended with
      `lsp_implementation`/`lsp_type_definition`; new Call hierarchy bullet
      (modes, item contract, bounds, never-executes)
- [x] Battery (gentle-ai-verify): 478 tests / 48 files (+25), lint 0,
      typecheck clean, build clean, `git diff --check` clean,
      mutation-clean
- [x] Work units: `21ccad6` (behavior), `7d9c141` (README)
- Route: parent.

## Non-goals

- Selection range / document highlight / code lens / type hierarchy
  (separate future slices); real-server smoke (needs explicit auth);
  changing existing tool contracts (`lsp_definition`/`lsp_references`
  behavior untouched).

## Constraints

- Baseline: `feature/gap-closure` @ `b7ce976`; 453 tests / 47 files green.
- Branch `feature/navigation-completion` stacked on `feature/gap-closure`
  (chain pattern; slice review base = `b7ce976`).
- Test-first per task (RED observed before GREEN); record evidence below.
- Workers never commit; parent reviews hunks, verifies via
  `gentle-ai-verify`, and commits.
- ~400 authored lines advisory; honest reporting if exceeded.
- Push deferred (user preference); merge/push remain user decisions.

## Progress log

- 2026-10-07: authorized ("continue"). Evidence gathered: runNavigation(kind)
  :74 already parameterized; definition :324; references :437;
  formatLocations export; fixture navigation gate :169/:181; nav tool tests
  8 its. Branch created; N1+N2 delegated as one sequential worker task
  (surfaces overlap, so not parallel).
- 2026-10-07: worker returned full-battery green (478/48) with per-task RED
  evidence and 371 authored lines. Parent spot-check: session helper
  mirrors definition normalization; call-hierarchy tool remedies/routing/
  truncation verified; two parent fixes (JSDoc, count-cap marker) + README.
  Independent battery 5/5 green. Honest deviation: slice totals +484/−12
  over 9 files (plan doc included) — above the ~400 advisory, recorded.

## Review record

- (pending)
