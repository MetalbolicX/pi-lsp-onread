# Feature: organize-imports-preview (roadmap T2.2)

## Intent

A dedicated, one-call `lsp_organize_imports` tool: fetch code actions, filter to `source.organizeImports`, resolve if needed, and show the validated bounded preview via the `edit-preview-engine`. Thin by design — everything hard (validation, rendering, trust) already shipped in T2.1.

Precondition satisfied: chain merged to main (6a284a7); this branch starts from main.

## Design decisions (settled before implementation)

- **Params** `{ path }` only — organize-imports is file-level; the request uses a zero-width range at 0:0.
- **Flow**: `activate(session, path, "read")` (same gating texts) → per matched server with truthy `codeActionProvider` → `session.codeActions(...)` → filter actions whose `kind` is a string starting with `source.organizeImports` → none → `No organize-imports action reported by <serverId>.` per server (and honest empty summary when no server reports any) → first match per server → resolve when no `edit` but object `data` (`session.resolveCodeAction`, failed → failure line) → still no `edit` → `has no editable change` line → `validateWorkspaceEdit(edit, { canonicalRoot: result.canonicalRoot, readFile, openVersions })` → rejected → `preview rejected for <serverId>:` + reasons → ok → `renderWorkspaceEdit(...)`.
- **Reuse**: readFile wrapper with 1 MB cap; bounded timeout `Math.min(requestTimeoutMs ?? 5000, 5000)`; `MAX_OUTPUT_CHARS = 8_000`; readOnly annotations; `text()` helper; sibling gating texts. Failure/unsupported buckets as everywhere.
- **Footers**: `preview only: nothing was applied; coverage: N server(s) checked for this file; results reflect each server's current view and may lag recent edits`. 
- **Line-structure test assertion included** (lesson from code-action-tool: fragment-only assertions miss separator bugs).
- No config/schema changes; no fixture changes (fixture action 2 is `source.organizeImports` with `data` + resolve → edit).

## Boundaries (binding)

Strict TDD for the tool task (observed RED → GREEN); docs read-back; structural tasks include lint.

## Tasks

- [x] O0 — Branch `feature/organize-imports-preview` from `main` (chain reset after merge).
- [x] O1 — `src/pi/lsp-organize-imports-tool.ts` + registration. Strict TDD.
- [x] O2 — README bullet (inline).
- [x] O3 — Close: full suite, lint, typecheck, build; closure docs; native review (explicit base range vs main base as appropriate); review record.

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| O1 | `fd2fcab` | feat(tools): add lsp_organize_imports tool |
| O2 | `527f024` | docs: document lsp_organize_imports tool |
| O3 | _pending_ | closure + review record |

## Verification evidence (O3)

- `pnpm test`: 36 files / 346 tests passed (verified by gentle-ai-verify at HEAD 527f024).
- `pnpm lint`: exit 0 clean. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 684.13 kB, cli.js 301.15 kB).
- TDD: O1 (6 tests RED → GREEN, including line-structure assertions per the code-action-tool lesson; parent review confirmed real newline separators).

## Review record

- _pending at close (O3)._

## Route evidence

- Branch: `feature/organize-imports-preview` from `main` (6a284a7) — chain reset after the user-authorized merge.
- Delegation: `gentle-ai-worker` for the tool task with exact `## Allowed edit surfaces` (path lines only); parent commits each work unit.
- Review: START with explicit full base `baseRef` + `committedOnly: true` (main post-merge base = 6a284a7).
