# Feature: edit-preview-engine (roadmap T2.1, part 1 of 2)

## Intent

Core infrastructure for code-action previews: fetch code actions (including `codeAction/resolve`), **validate** their WorkspaceEdits against trust/path/version/range rules, and **render** a bounded preview — without ever applying anything or executing commands.

Part 2 (`code-action-tool`, separate feature) exposes this via the `lsp_code_actions` Pi tool. Split to respect the ~400 authored-line review budget.

## Design decisions (settled before implementation)

- **Never apply / never execute.** `workspace/applyEdit` already rejected in `LspClient`; this engine only reads and formats. `executeCommand` is never invoked — command-only actions are data, marked non-previewable downstream.
- **Two-step API**: list actions first (raw pass-through, top-level validated), then per-action `resolve` (only for actions with `data` and no `edit`, gated on truthy `codeActionProvider.resolveProvider`... capability lives on `codeActionProvider`; fixture will advertise `{ resolveProvider: true }`), then `validate` + `render`.
- **Validation verdicts** (`validateWorkspaceEdit`):
  - **REJECT** (whole preview withheld, reasons listed): empty/malformed edit (no `changes` and no `documentChanges`); any target URI that is not a parseable `file:` URI; any target path outside the canonical trusted root (normalized `path.resolve` + root-prefix check — covers create/delete/rename ops too); structurally malformed entries (non-object TextEdit, missing/invalid range coordinates, invalid resource-op entries).
  - **WARN** (rendered with notes): `TextDocumentEdit.version` present and ≠ current open-document version → `stale: document version N, edit targets M`; file content unavailable for a target → ranges unverified; target ranges out of bounds for current content (line/char beyond file) → `range out of bounds` note.
  - Overlap detection: deferred to T2.4 (rename) — out of scope here.
- **Rendering** (`renderWorkspaceEdit`): per-file sections (`path` header), per-edit `Lstart:col-end:col` line, `-` old lines sliced from current content when available (else `(current text unavailable)`), `+` new lines from `newText`. Caps: 100 edits total (excess → omission line), `maxChars` budget with omission lines; never exceeds budget.
- **Async with injected reader**: validation/render take an injected `(path) => Promise<string>` reader (session's `fsReadFile`) — pure and testable; bounded file reads (targets only, deduped).
- **Session layer**: `codeActions(serverId, uri, range, timeoutMs, client?)` → `unsupported|failed|ok` (raw array, cap 1000, capability gate on truthy `codeActionProvider`, non-array → failed, `null` → ok empty — absence is a valid answer); `resolveCodeAction(serverId, action, timeoutMs, client?)` → `unsupported|failed|ok` (gate on `codeActionProvider` object with truthy `resolveProvider`; response must be an object → else failed).
- **Fixture** `FAKE_CODE_ACTIONS=1`: advertise `codeActionProvider: { resolveProvider: true }`; `textDocument/codeAction` returns (for a request whose range intersects the doc): (a) quickfix with inline `edit` (replace line at requested start with a marked new text, same file), (b) `source.organizeImports`-style action with `data` and NO `edit` (resolved via `codeAction/resolve` to an inline edit on the same file), (c) command-only action `{ title, command: { title, command: "fake.doThing", arguments: [] } }`. Deterministic, honors `FAKE_HANG_METHOD`. Out-of-range/empty doc → `null`.
- No config/schema changes.

## Boundaries (binding)

Non-blocking; never apply/execute; explicit `unsupported`/`failed`; reject-vs-warn distinction is a safety property (untrusted targets never render); strict TDD for P1.2–P1.3 (observed RED → GREEN); P1.1 structural.

## Tasks

- [x] P1.0 — Branch `feature/edit-preview-engine` stacked on `feature/navigation-tools`.
- [x] P1.1 — Fixture `FAKE_CODE_ACTIONS=1` + helper flag `codeActions`. Structural.
- [x] P1.2 — `RuntimeSession.codeActions` + `resolveCodeAction`. Strict TDD.
- [x] P1.3 — `src/preview/workspace-edit.ts`: `validateWorkspaceEdit` + `renderWorkspaceEdit` (+ shared uri/path helpers local to the module). Strict TDD.
- [x] P1.4 — Close: full suite, lint, typecheck, build; closure docs; native review (RDD, explicit branch-base committed range per standing procedure); review record.

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| P1.1 | `eea9baf` | test(fixture): add code-action mode to fake LSP server |
| P1.2 | `e7cfd4d` | feat(runtime): add code action and resolve requests |
| P1.3 | `e1cbd80` | feat(preview): add workspace edit validation and rendering |
| P1.4 | _pending_ | closure + review record |

## Verification evidence (P1.4)

- `pnpm test`: 34 files / 333 tests passed (verified by gentle-ai-verify at HEAD e1cbd80).
- `pnpm lint`: exit 0 clean. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 660.50 kB, cli.js 301.15 kB).
- TDD: P1.2 (19 tests RED → GREEN), P1.3 (RED = module absent at import, then 14 tests GREEN). P1.1 structural (fixture + helper; test + lint + typecheck all green — lint lesson applied).
- Noted deviation (accepted, non-blocking): non-record entries inside `documentChanges` are skipped rather than rejected — non-objects cannot carry a target URI, and a sole-entry case still rejects as "no document changes"; recorded for the feature-2 consumer's awareness.

## Review record

- _pending at close (P1.4)._

## Route evidence

- Branch: `feature/edit-preview-engine` stacked on `feature/navigation-tools` (chain strategy cached from user).
- Delegation: per-task `gentle-ai-worker` for multi-file writes with exact `## Allowed edit surfaces` (path lines only); parent commits each work unit; workers never commit; structural tasks must run lint too (lesson from navigation-tools N1).
- Verification: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (full battery via `gentle-ai-verify` at close).
- Review: standing procedure — START with explicit full branch-base `baseRef` + `committedOnly: true` (cumulative candidates exceed the reviewer context budget on this chain).
