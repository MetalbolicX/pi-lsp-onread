# Feature: cross-file-awareness (T1.4)

## Authority

- User: "lets move to next tasks" — continue the roadmap in the recommended order; next is T1.4 cross-file awareness (unblocked by T1.2 pulls). Strict TDD stands.
- Roadmap: Engram 11426 / 11437. Delivery: `chain_strategy=feature-branch-chain` (cached user choice) — this branch stacks on `feature/on-demand-diagnostics`.

## Scope

After an edit to file A, report diagnostic changes the language server surfaces in **other files** (e.g. broken callers), with honest coverage wording:

1. **Workspace pulls**: when a server advertises `diagnosticProvider.workspaceDiagnostics`, issue `workspace/diagnostic` after the edit wait (bounded by remaining deadline), with per-uri `previousResultIds`; map per-uri full/unchanged reports into the store (unchanged never re-records; malformed reports rejected per the b3776b7 contract).
2. **Changed-files tracking**: a session-level query for `(serverId, uri)` snapshots that changed since a timestamp (covers both push publications for other URIs and workspace-pull updates).
3. **Cross-file output section** on edit: after the current-file delta block, list other files whose diagnostics changed during the activation window — file, server, newly-observed/resolved counts (vs each file's own baseline where present, else "first observation"), capped. Coverage line states exactly what was checked: pushed/pulled files only, never the whole workspace, unless a workspace pull ran (then still "server-reported files only" — a workspace pull's completeness is server-owned and unverifiable).

**Out of scope:** extending the `lsp_diagnostics` tool to other files, symbols (T1.5), definition/references tools, config/schema changes.

## Design decisions (settled)

- Workspace pull gated on `capabilities().diagnosticProvider.workspaceDiagnostics === true`.
- `workspace/diagnostic` params: `{ previousResultIds: { [uri]: id } }` (only known ids). Response `items`: array of `{ uri, kind, resultId?, items? }`; per-uri handling identical to document pulls; unknown/malformed entries skipped individually, not fatal.
- Workspace pull outcome surfaced like pullFresh (`"unsupported" | "failed" | "applied"`); edit path ignores it for the current file's formatting.
- New store/session capability: `changedSince(timestamp)` returning changed `(serverId, uri)` pairs — implemented by scanning store snapshots' `receivedAt` (store is small; no new index).
- Cross-file section only on **edit** events; read path byte-identical.
- Coverage wording (exact): `cross-file coverage: changes in other files are reported only as surfaced by servers (push or workspace pull); files not reported remain unchecked.`
- Caps: cross-file file-list capped at `maxItems` files; per-file one summary line.

## Tasks

Strict TDD mandatory for X2/X3 (product behavior). X1 is test infrastructure (no RED lifecycle).

| ID | Task | Route | Checks | Status |
| --- | --- | --- | --- | --- |
| X1 | Fixture workspace-diagnostics mode + helper flag | delegated | structural + exercised by X2/X3 | done |
| X2 | Session: workspace pull + changedSince query | delegated | RED/GREEN `tests/unit/runtime/session.test.ts` | done |
| X3 | Activation: cross-file section + coverage wording + caps | delegated | RED/GREEN `tests/unit/runtime/activation.test.ts` | done |
| X4 | README documents cross-file behavior | inline | structural readback | done |
| X5 | Full-suite close + assess + native review | inline + native | all green; review below | done |

## Verification commands

`pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build`

## Delivery strategy

Feature-branch chain (cached user choice). Forecast ~450 authored lines.

## Commit log (work-unit commits, evidence)

| Task | Commit | Notes |
| --- | --- | --- |
| X1 | f21d00d | test infra; structural check; runtime 52/52; defaults unchanged |
| X2 | 4ffdd8a | 6 tests RED→GREEN; session 14/14, diagnostics 30/30, tsc clean |
| X3 | e6755b1 | section tests RED→GREEN; activation 29/29, runtime 64/64, tsc clean |
| X4 | 81dee01 | README cross-file bullet; structural readback |
| X5 | 3357218 | style fix (oxlint); full suite 208/208, lint 0, tsc clean, build clean |

## Review record

- Native assessment and lineage recorded at close (see below after review completes).

## Route evidence

- Multi-file write rule fired for X1–X3 ⇒ one writer per task. X4 single-file docs ⇒ inline. Workers do not commit; parent commits per work unit.
