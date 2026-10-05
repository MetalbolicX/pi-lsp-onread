# Feature: hardening-pass (foundation, post-Tier-2)

## Scope

Single hardening slice, three work units (playbook: second advisory sweep, mirroring `odd/tasks/advisory-cleanup.md`):

1. **Position-encoding negotiation** — `client.ts` initialize advertises `general: { positionEncodings: ["utf-16"] }` (LSP 3.17). The server's replied `positionEncoding` capability is recorded and exposed via a getter. No coordinate conversion (documented non-goal: we only ever offer utf-16). README wording updated ("the LSP default since position encoding is not negotiated yet" → "negotiated as utf-16 with each server").
2. **Session request plumbing hardening** — extract the repeated pool-lookup + capability gate boilerplate in `RuntimeSession` request methods (the `session.ts:358`/`:395` recurring advisory family) into a shared private helper. Behavior-preserving; all existing tests stay green unchanged.
3. **Second advisory sweep** — retire two tool-level informational findings:
   - `lsp-organize-imports-tool.ts:62` — kind matching prefers an exact `"source.organizeImports"` match; when only prefix matches exist, additional prefix-matching actions beyond the first are named as omissions ("N additional organize-imports action(s) from {serverId} not shown.") instead of being silently dropped.
   - `lsp-rename-tool.ts:73-78` — a bare-Range `prepareRename` response (Range without `{range, placeholder}` wrapper) is used as the range directly instead of falling through to the no-range path.

Non-goals: coordinate conversion, multi-encoding support, changing any tool output except the two named fixes, lifecycle redesigns.

## Tasks

- [x] P0 — Branch `feature/hardening-pass` from `feature/formatting-preview` (reviewed at `d979fb9`).
- [x] P1 — TDD: utf-16 positionEncodings advertisement + negotiated-encoding getter + README wording.
- [x] P2 — Refactor: shared matched-client helper in `RuntimeSession` (behavior-preserving, battery green).
- [x] P3 — TDD: organize-imports kind matching + rename bare-Range prepare handling.
- [x] P4 — Full battery via verifier, closure evidence, review record.

## Commit table

| Task | Commit | Message |
| --- | --- | --- |
| P0 | _branch_ | from `feature/formatting-preview` @ `d979fb9` |
| P1 | `0b621d3` | feat(lsp): advertise utf-16 position encoding at initialize |
| P2 | `e4e99d3` | refactor(runtime): extract shared matched-client lookup in session requests |
| P3 | `be2e179` | fix(tools): precise organize-imports matching and bare-range prepare ranges |
| P4 | `f916b29` | docs: record hardening-pass closure evidence |

Review-record commit: follows as `docs: record hardening-pass review approval` (its own hash cannot be tabulated from inside the recorded document; see git log).

## Verification evidence (P4)

- `pnpm test`: 42 files / 409 tests passed (gentle-ai-verify; baseline 42/404 → +5 tests, no new files). Post-run mutation check clean.
- `pnpm lint`: zero findings. `pnpm typecheck`: exit 0. `pnpm build`: rolldown success (extension.js 717.66 kB).
- TDD RED observed for P1 (3 client failures) and P3 (3 tool failures: exact-kind preference, omission line, bare-Range at-clause) before GREEN; P2 refactor verified by the full unchanged battery (all 13 request methods routed through `matchedClient`; no inline pool lookup remains).

## Review record

- ASSESS (committed range, base `d979fb924addc78bd71993c8c8496d62f1d58b78` = branch base, committedOnly): medium risk, executable change (`src/lsp/client.ts`), 10 paths / 188 lines, reviewDue = `under_budget`.
- One stale consent binding, then START with explicit full branch-base created lineage `review-7110ca626e8607a3` (medium, review-reliability). One capture resubmission after a parent-side binding transcription error (fresh STATUS re-offered the identical slot; resubmitted verbatim).
- Native review: **approved — zero findings** (the session.ts advisory family and both tool advisories are retired); acknowledgement burned (`delivery: ordinary-repository-policy`).
