# Feature: capabilities-completion

The final capability slice: four verified-absent LSP requests (grep counts = 0
for both requests and providers) — selection range, document highlight, code
lens, and type hierarchy. User: "continue capabilities".

## Objective

Complete the read-only tool surface (14 → 18 tools): three one-shot
"editor" queries in a new `src/pi/lsp-editor-tools.ts`, plus a two-phase
`lsp_type_hierarchy` mirroring the proven `lsp_call_hierarchy` contract.
All capability-gated, bounded with explicit omission markers, read-only;
code-lens commands are displayed, never executed or resolved.

## Authority

User "continue capabilities" (2026-10-07); absence verified by grep across
`src/` for all four requests and their capability keys. Patterns reuse the
approved navigation/inlay/call-hierarchy precedents.

## Resolved design decisions

1. **Three one-shot tools in a NEW file** `src/pi/lsp-editor-tools.ts`
   (nav-tools is already ~350 lines; keep files focused):
   - `lsp_selection_range {path, line, character}` — `textDocument/selectionRange`;
     session flattens the parent chain innermost→outermost with a depth cap
     (20 nodes); output is a numbered chain (innermost first) with bounds;
     footer states the chain is server-provided nesting, not a judgment.
   - `lsp_document_highlight {path, line, character}` — occurrences in the
     current file with kind (`text|read|write`), cap 100 **with explicit
     omission marker** (count-cap lesson from gap-closure).
   - `lsp_code_lens {path, startLine?, endLine?}` — default 200-line window
     clamped to 2000 (inlay pattern, inlay tool :46-48); lines show
     `file position + command title` (or `(no title)` when the server
     omitted it), cap 100 + omission marker; **commands never executed,
     `codeLens/resolve` never called** (footer states titles may be
     unresolved).
2. **Type hierarchy = mirror of call hierarchy** in
   `src/pi/lsp-navigation-tools.ts`: session `prepareTypeHierarchy()` +
   `typeHierarchyDirections(direction: "supertypes"|"subtypes", item)`
   (gate `typeHierarchyProvider`; 1000 cap; never-throws); tool
   `lsp_type_hierarchy {path, line, character, mode?, item?}` — modes
   `prepare` (default) / `supertypes` / `subtypes`, missing-item remedy line
   before activation, verbatim-item footer, reuses private `symbolKindName`
   (:283) and `itemPosition`, same caps/markers.
3. **Gates**: `selectionRangeProvider`, `documentHighlightProvider`,
   `codeLensProvider`, `typeHierarchyProvider` — truthy check (object forms
   pass; absent ⇒ `unsupported`, named in output).
4. **Fixture**: `FAKE_NAVIGATION` gains selection-range and
   document-highlight handlers + capability advertisements (same
   position-query family; existing off-flag unsupported tests keep
   passing); NEW `FAKE_CODE_LENS` (capability + lens handler with one titled
   and one command-less lens) and NEW `FAKE_TYPE_HIERARCHY` (capability +
   prepare/supertypes/subtypes handlers) for independent gating tests.
5. **Bounds/footers** follow house style: `MAX_OUTPUT_CHARS`, per-server
   sections, failures/unsupported named, coverage footer, line-structure
   assertions, 5s timeout cap, read-only annotations.
6. **README** (parent): extend/add bullets for all four tools.

## Tasks

### C1 — Editor one-shots: selection range, highlight, code lens (test-first)
- [x] RED observed: 5 focused failures (session methods missing, editor
      tools unregistered)
- [x] GREEN: 3 session methods — `selectionRange` (iterative parent-chain
      flatten, `depth < 20` bound ⇒ cycle-safe, integer-validated ranges,
      malformed links skipped), `documentHighlight` (cap 100), `codeLens`
      (range-intersection filter then cap 100); all gated truthy, null ⇒ ok
      empty, never-throws; new `src/pi/lsp-editor-tools.ts` shared
      `runEditor(mode)` core with count-cap omission markers, footer-
      preserving truncation, lens "never executed / titles may be
      unresolved" footer; fixture: selection/highlight under FAKE_NAVIGATION,
      NEW FAKE_CODE_LENS (titled + command-less + out-of-range lens)
- Route: delegated (gentle-ai-worker), commit `48d7903` (with C2 — shared
  session/fixture/extension files; one coherent behavior unit).

### C2 — Type hierarchy (test-first)
- [x] RED observed: 3 focused failures (prepare/directions + tool missing)
- [x] GREEN: `prepareTypeHierarchy` + `typeHierarchyDirections` (gate
      `typeHierarchyProvider`, 1000 cap, direction-literal);
      `runCallHierarchy` generalized with `flavor: "call"|"type"` — exclusive
      dispatch verified by parent (mode whitelist per flavor, noun/footer/
      remedy parameterized, item rendering correct for BOTH shapes);
      FAKE_TYPE_HIERARCHY fixture; tests extended
- Route: delegated (gentle-ai-worker), commit `48d7903`.

### C3 — Docs + closure (parent)
- [x] README: four new bullets (type hierarchy, selection range, document
      highlight, code lens) after the call-hierarchy entry
- [x] Battery (gentle-ai-verify): 487 tests / 49 files (+9), lint 0,
      typecheck clean, build clean, `git diff --check` clean,
      mutation-clean
- [x] Work units: `48d7903` (behavior), `d9f6a03` (README)
- Route: parent.

## Non-goals

- `codeLens/resolve` and `typeHierarchy/resolve` (command execution and
  resolve remain out; lens titles are displayed as returned); real-server
  smoke (needs explicit auth); changing existing tools; push (deferred).

## Constraints

- Baseline: `main` @ `6c8f201`; 478 tests / 48 files green. Branch
  `feature/capabilities-completion` off `main` (prior branches merged —
  fresh base keeps review scope small).
- Test-first per task (RED observed before GREEN); record evidence below.
- Workers never commit; parent reviews hunks, verifies via
  `gentle-ai-verify`, commits. Single sequential worker (session/fixture/
  extension surfaces overlap C1 and C2 — parallelism would collide).
- ~400 authored lines advisory — this slice is EXPECTED to exceed it;
  honest totals recorded (a ~521-line slice reviewed cleanly last cycle).
- RDD: slice review with explicit committed base
  (`6c8f2013c3e0729b66aaacc39d9dea553f797764`).

## Progress log

- 2026-10-07: authorized ("continue capabilities"). Absence verified
  (10/10 grep targets = 0). Evidence: symbolKindName nav-tools:283 private;
  inlay window :46-48; format tests 11 its. Branch created; C1+C2
  delegated as one sequential worker task.
- 2026-10-07: worker returned full-battery green (487/49) with per-task RED
  evidence and 515 authored lines (+/−21 on shared files). Parent spot-
  checks: shared hierarchy-flow dispatch exclusive and correct for both
  shapes; selection flatten cycle-safe (`depth < 20`); count-cap markers
  present in both new modules; fixture flags gated; README four bullets.
  Independent battery 5/5 green. Honest deviation: ~536 changed lines vs
  ~400 advisory — recorded (precedent 521-line slice reviewed fine).

## Review record

- Slice review APPROVED — lineage `review-e3943a1feb0ea7b1`, medium tier
  (`executable_change` on `src/extension.ts`), review-reliability lens,
  10 paths / 672 lines, correction budget 200, base
  `6c8f2013c3e0729b66aaacc39d9dea553f797764` (committedOnly). One stale
  consent binding (expired, no lineage) recovered with a fresh
  idempotency key. Reviewer forecast (1 host-relay run) acknowledged;
  approved on the last admitted event with **ZERO findings**;
  acknowledgement burned (consumed revision `sha256:33207073…`).
  Delivery: ordinary repository policy.
