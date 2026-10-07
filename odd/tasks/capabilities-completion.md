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
- [ ] RED: no session methods / no tool / no fixture handlers
- [ ] GREEN: 3 session methods (flattened chain cap 20; highlight cap 100
      + marker; lens window + cap 100 + marker), `lsp-editor-tools.ts` with
      three registrations, fixture handlers under FAKE_NAVIGATION /
      FAKE_CODE_LENS, extension wiring, tests
- Route: delegated (gentle-ai-worker).

### C2 — Type hierarchy (test-first)
- [ ] RED: no prepare/directions path
- [ ] GREEN: session methods + `lsp_type_hierarchy` tool (modes, remedy,
      footer, kind map reuse) + FAKE_TYPE_HIERARCHY fixture + tests
- Route: delegated (gentle-ai-worker).

### C3 — Docs + closure (parent)
- [ ] README bullets; battery; work-unit commits; closure; slice review;
      record
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

## Review record

- (pending)
