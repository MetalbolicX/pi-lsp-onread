# Feature: hover-inlay (roadmap T2.3)

## Scope

Two on-demand, read-only, trust-gated tools over the existing runtime plumbing:

- `lsp_hover` — `{path, line, character}` (1-based UTF-16): `textDocument/hover` per matched server; renders `MarkupContent` / `MarkedString` / `MarkedString[]` bounded; optional hover `range` echoed 1-based.
- `lsp_inlay_hints` — `{path, startLine?, endLine?}` (1-based, inclusive; bounded window): `textDocument/inlayHint` per matched server; label-only rendering (tooltips NOT resolved), hint-count cap, per-server sections.

Invariants preserved from prior slices: nothing is applied, no commands executed, positions 1-based UTF-16 (client does not negotiate `positionEncoding`), bounded outputs, trust gate via `activate()`, per-server sections with coverage footer, capability gates in `RuntimeSession`, timeout caps.

Non-goals: hover/inlay `resolve` requests (e.g. tooltip resolution), markdown sanitization beyond truncation, caching.

## Tasks

- [x] O0 — Branch `feature/hover-inlay` from `feature/organize-imports-preview` (linear chain; that branch is reviewed at `d1532aa`).
- [x] O1 — TDD: RuntimeSession `hover()` + `inlayHints()` (capability gates: `hoverProvider` boolean-or-object; `inlayHintProvider` boolean/object/nonempty-array), `src/hover/format.ts` `formatHover`, `src/inlay/format.ts` `formatInlayHints`, `src/pi/lsp-hover-tool.ts`, `src/pi/lsp-inlay-hints-tool.ts`, `src/extension.ts` registration, fake-lsp-server handlers. RED observed before GREEN; line-structure assertions for formatted output (separators must be asserted literally).
- [x] O2 — README: document both tools in the tools section.
- [x] O3 — Full battery (test/lint/typecheck/build) via verifier, closure evidence, review record.

## Commit table

| Task | Commit | Message |
| --- | --- | --- |
| O0 | _branch_ | from `feature/organize-imports-preview` @ `d1532aa` |
| O1 | `f693bd1` | feat(tools): add lsp_hover and lsp_inlay_hints tools |
| O2 | `88a5b18` | docs: document lsp_hover and lsp_inlay_hints tools |
| O3 | `a782ece` | docs: record hover-inlay closure evidence |

Review-record commit: follows as `docs: record hover-inlay review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (O3)

- `pnpm test`: 40 files / 377 tests passed (gentle-ai-verify; baseline 36/346 → exactly +4 files / +31 tests).
- `pnpm lint`: zero findings. `pnpm typecheck`: exit 0. `pnpm build`: rolldown success (extension.js 698.31 kB).
- TDD RED observed per area (formatter imports, 8 runtime failures, 6 hover-tool failures, 5 inlay-tool failures) before GREEN; line-structure assertions used throughout (T2.1 lesson).
- Worker-implemented (gentle-ai-worker), parent spot-checked runtime conversion/clamp/budgeting, independent battery by gentle-ai-verify with post-run mutation check clean.

## Review record

- ASSESS (committed range, base `d1532aa52ba45a4f7008afb880fbdb17bd450006` = branch base, committedOnly): medium risk, executable change (`src/extension.ts`), 14 paths / 623 lines, reviewDue = `slice_budget_reached`.
- START with explicit full branch-base created lineage `review-e5b1210c499f2b29` (medium, review-reliability).
- Native review: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational finding (separate later work):
  - R3-001 — `src/runtime/session.ts:358` (WARNING)
