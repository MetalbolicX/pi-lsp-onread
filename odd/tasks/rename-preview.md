# Feature: rename-preview (roadmap T2.4)

## Scope

- Engine: `validateWorkspaceEdit` gains **overlap validation** — per file, edits whose ranges overlap are rejected with `overlapping text edits in {path}`. Adjacent ranges (touching, not overlapping) stay valid; identical-position zero-length inserts stay valid. Benefits both `lsp_code_actions` previews and the new rename preview.
- Runtime: `RuntimeSession.prepareRename()` and `RuntimeSession.rename()` with capability gates — `renameProvider` truthy (boolean or object) enables rename; prepare requires the object form `{ prepareProvider: true }`, otherwise prepare reports unsupported while rename remains available.
- Tool: `lsp_rename` — `{path, line, character, newName?, mode?}` (positions 1-based UTF-16). Mode `prepare` (default readiness check: placeholder + range, "not advertised" named explicitly) and mode `preview` (requires non-empty `newName`; `textDocument/rename` → engine-validated, bounded multi-file preview). Per-server sections, footers, nothing ever applied.

Non-goals: applying edits, workspace/applyEdit round-trips, `workspace/rename` operations, executing commands.

## Tasks

- [x] R0 — Branch `feature/rename-preview` from `feature/hover-inlay` (linear chain; reviewed at `d685861`).
- [x] R1 — TDD: engine overlap validation + RuntimeSession prepareRename/rename + fixture handlers (prepareRename/rename incl. an overlapping-edits variant). RED observed before GREEN.
- [x] R2 — TDD: `lsp_rename` tool (prepare/preview modes, trust gate, per-server sections, validation rejection rendering). RED observed before GREEN.
- [x] R3 — README: document `lsp_rename` and the overlap validation rule.
- [x] R4 — Full battery via verifier, closure evidence, review record.

## Commit table

| Task | Commit | Message |
| --- | --- | --- |
| R0 | _branch_ | from `feature/hover-inlay` @ `d685861` |
| R1 | `36859f8` | feat(preview): add overlap validation and rename requests |
| R2 | `6d770f0` | feat(tools): add lsp_rename tool |
| R3 | `092802d` | docs: document lsp_rename tool |
| R4 | `3a0275e` | docs: record rename-preview closure evidence |

Review-record commit: follows as `docs: record rename-preview review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (R4)

- `pnpm test`: 41 files / 392 tests passed (gentle-ai-verify; baseline 40/377 → +1 file / +15 tests).
- `pnpm lint`: zero findings. `pnpm typecheck`: exit 0. `pnpm build`: rolldown success (extension.js 709.65 kB). Post-run mutation check clean.
- TDD RED observed (14 focused failures: 4 overlap, 4 runtime rename, 6 tool) before GREEN.
- Worker-implemented (gentle-ai-worker); parent spot-checked the sweep tie handling, capability gating, and registration.
- Known documented edge (fail-safe direction): a zero-length insert sharing its start position with a longer range in the same file is flagged as overlapping (over-rejection of pathological server output; empty ranges never conflict with each other).

## Review record

- ASSESS (committed range, base `d685861a2d3a401781c1bcbed8be067e8d49d9b3` = branch base, committedOnly): medium risk, executable change (`src/extension.ts`), 10 paths / 497 lines, reviewDue = `slice_budget_reached`.
- START with explicit full branch-base created lineage `review-becf8162a37508af` (medium, review-reliability).
- Native review: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational finding (separate later work):
  - R3-prepare-range-response — `src/pi/lsp-rename-tool.ts:73-78` (WARNING; prepareRename may also answer a bare Range per LSP — hardening pass)