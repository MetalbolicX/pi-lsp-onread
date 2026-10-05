# Feature: formatting-preview (roadmap T2.5)

## Scope

- Runtime: `RuntimeSession.formatting()` — `textDocument/formatting` with `FormattingOptions` (defaults `tabSize: 2`, `insertSpaces: true`; optional `trimTrailingWhitespace`, `insertFinalNewline`, `trimFinalNewlines`). Capability gate: `documentFormattingProvider` truthy (boolean or object). `ok` requires an array response (clamped to 1000); `null` → ok with empty edits ("no formatting changes").
- Tool: `lsp_formatting` — `{path, tabSize?, insertSpaces?, trimTrailingWhitespace?, insertFinalNewline?, trimFinalNewlines?}`. Per matched server: synthesize a single-file WorkspaceEdit (`{ changes: { [uri]: edits } }`) and run the T2.1 engine (validate + render, trusted-root, overlap rejection from T2.4 included) for a bounded per-server preview. Sections, footers, options echoed in output. Nothing is ever applied.
- Non-goals: range formatting (`textDocument/rangeFormatting`), applying edits, editor-default discovery from config files.

## Tasks

- [x] F0 — Branch `feature/formatting-preview` from `feature/rename-preview` (linear chain; reviewed at `15007a7`).
- [x] F1 — TDD: RuntimeSession.formatting + `lsp_formatting` tool + fixture handlers (formatting capability flag; single-file edits; env variant with no-change null and an overlapping-edit variant to exercise rejection). RED observed before GREEN.
- [x] F2 — README: document `lsp_formatting`.
- [x] F3 — Full battery via verifier, closure evidence, review record.

## Commit table

| Task | Commit | Message |
| --- | --- | --- |
| F0 | _branch_ | from `feature/rename-preview` @ `15007a7` |
| F1 | `aff60cc` | feat(tools): add lsp_formatting tool |
| F2 | `985412f` | docs: document lsp_formatting tool |
| F3 | `c67bdfa` | docs: record formatting-preview closure evidence |

Review-record commit: follows as `docs: record formatting-preview review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (F3)

- `pnpm test`: 42 files / 404 tests passed (gentle-ai-verify; baseline 41/392 → +1 file / +12 tests). Post-run mutation check clean.
- `pnpm lint`: zero findings. `pnpm typecheck`: exit 0. `pnpm build`: rolldown success (extension.js 717.04 kB).
- TDD RED observed (12 focused failures across runtime + tool) before GREEN; line-structure assertions for output including the echoed options footer.

## Review record

- ASSESS (committed range, base `15007a76b8fdbef5b2e1a760961861d3edfc4bf4` = branch base, committedOnly): medium risk, executable change (`src/extension.ts`), 8 paths / 345 lines, reviewDue = `under_budget`.
- One stale consent binding, then START with explicit full branch-base created lineage `review-09de04a8ca266a98` (medium, review-reliability).
- Native review: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational finding (separate later work):
  - R3-001 — `src/runtime/session.ts:395` (WARNING; recurring session.ts advisory family — hardening pass)
