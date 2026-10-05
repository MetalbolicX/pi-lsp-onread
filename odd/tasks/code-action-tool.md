# Feature: code-action-tool (roadmap T2.1, part 2 of 2)

## Intent

Expose code actions to the model via the `lsp_code_actions` Pi tool, wired to the `edit-preview-engine` validation/render engine: **list mode** (actions with previewability markers) and **preview mode** (validated, bounded diff for one selected action). Preview-only: nothing is ever applied; server commands are never executed.

## Design decisions (settled before implementation)

- **Params** `{ path, line, character, action? }`: path required; `line`/`character` integers ≥ 1 (1-based UTF-16, same contract as navigation tools); `action` optional integer ≥ 1 (1-based index into the action list). No `action` → list mode; with `action` → preview mode.
- **Canonical root plumbing**: `activate()` computes the trusted canonical root but discards it. Its `ok` result gains `canonicalRoot: string` (single source of truth — the tool must not re-derive trust). Existing consumers ignore the extra field; activation tests updated where exact-shape assertions break.
- **List mode**: per contributing server (headers only when >1): numbered entries `${n}. [marker] title (kind)` with markers `previewable` (inline `edit`), `needs resolve` (no `edit`, has `data`), `command only — not previewable` (`command`, no `edit`), `no preview available` (none of these). Indices are stable across list/preview (concatenated in matched-server order, ok servers only).
- **Preview mode**: index out of range → explicit message naming the list call. Command-only → refusal naming the never-execute boundary (no engine call). `data` action without `edit` → `resolveCodeAction` (failed → failure line; resolved action still without `edit` → "no edit to preview"). Then engine: `validateWorkspaceEdit(edit, { canonicalRoot, readFile, openVersions })` — rejected → `preview rejected:` + every reason; ok → warnings + rendered diff. `readFile` wrapper caps at 1 MB (larger → undefined → engine warns "content unavailable"). `openVersions` from contributing clients' anchor-document versions (best-effort staleness).
- **Footers**: list — `coverage: N server(s) checked for this position; actions are listed as reported by servers; call this tool with an action number to preview its edit — previews are never applied, and commands are never executed`. Preview — `preview only: nothing was applied; commands are never executed; coverage: N server(s) checked for this position; results reflect each server's current view and may lag recent edits`.
- **Boundaries unchanged**: `MAX_OUTPUT_CHARS = 8_000`, bounded timeout (`Math.min(requestTimeoutMs ?? 5000, 5000)`), sibling gating texts, readOnly annotations, no config/schema changes, never `executeCommand`, never apply.

## Boundaries (binding)

Strict TDD for P2.1 (observed RED → GREEN); P2.2 docs read-back; structural tasks include lint.

## Tasks

- [x] P2.0 — Branch `feature/code-action-tool` stacked on `feature/edit-preview-engine`.
- [x] P2.1 — `src/pi/lsp-code-actions-tool.ts` (both modes) + `activate()` canonicalRoot + registration. Strict TDD.
- [x] P2.2 — README bullet (inline).
- [x] P2.3 — Close: full suite, lint, typecheck, build; closure docs; native review (explicit branch-base committed range); review record.

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| P2.1 | `fe23fab` | feat(tools): add lsp_code_actions tool |
| P2.2 | `870a67f` | docs: document lsp_code_actions tool |
| P2.3 | `b293591` | docs: record code-action-tool closure evidence |

Review-record commit: follows as `docs: record code-action-tool review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (P2.3)

- `pnpm test`: 35 files / 340 tests passed (verified by gentle-ai-verify at HEAD 870a67f).
- `pnpm lint`: exit 0 clean. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 677.62 kB, cli.js 301.15 kB).
- TDD: P2.1 (7 tests RED → GREEN). Post-GREEN parent review caught a formatting bug the fragment-based tests missed: `budgeted()` joined lines with literal `\n` two-character sequences instead of newlines — new assertion (output lines split on real newlines) observed RED, fix observed GREEN.
- Activation `ok` result gained `canonicalRoot`; no existing activation tests required changes (worker verified no exact-shape assertions).

## Review record

- ASSESS (committed range, base `a28df4b`, committedOnly): medium risk, executable change (`src/extension.ts`), 6 paths / 347 lines, reviewDue = `under_budget`; plan = writerSelfVerification (independent battery already run).
- Standing procedure: START with explicit full branch-base `a28df4bb53b91c414722d917cdff2d0e5acf38f5` + `committedOnly: true` succeeded first try (no stale binding this cycle).
- Reduced-scope lineage `review-7065b67c014a3049` (medium, review-reliability) → **approved** → acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational finding (separate later work):
  - R3-001 — `src/pi/lsp-code-actions-tool.ts:105` (WARNING)

## Route evidence

- Branch: `feature/code-action-tool` stacked on `feature/edit-preview-engine` (chain strategy cached from user).
- Delegation: `gentle-ai-worker` for the multi-file tool task with exact `## Allowed edit surfaces` (path lines only); parent commits each work unit; workers never commit; structural tasks include lint.
- Review: standing procedure — START with explicit full branch-base `baseRef` + `committedOnly: true`.
