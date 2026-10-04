# Feature: on-demand-diagnostics (foundation + T1.2 + T1.3 diagnostics tool)

## Authority

- User: "ok, work the next slice and t1 diagnosis" — approves the recommended next slice (foundation #1–#2 + T1.2 pull diagnostics) plus the T1.3 on-demand **diagnostics** tool. Strict TDD stands from the session.
- Roadmap: Engram observation 11426; T1.1 complete on `feature/diagnostic-deltas` (unmerged). This branch stacks on it.

## Scope

1. **Foundation — capability negotiation**: `LspClient.initialize` retains server capabilities from the InitializeResult and advertises the `textDocument.diagnostic` client capability.
2. **T1.2 — pull diagnostics**: `textDocument/diagnostic` support with `previousResultId`, full/unchanged handling, per-`(serverId, uri)` resultId state. Used on the edit path (post-wait, bounded by remaining deadline) and by the on-demand tool. Reads unchanged.
3. **T1.3 — `lsp_diagnostics` tool**: model-callable tool via `pi.registerTool` returning bounded, freshness-labeled diagnostics for one file, with explicit coverage wording (workspace not checked; never silence-is-clean). Trust-gated.

**Out of scope:** workspace-wide pulls (T1.4), definition/references/symbols tools (rest of T1.3), hover/rename/formatting (T2), prewarm/scorecard/preflight (T3), config/schema changes.

## Design decisions (settled)

- **Capability store**: `LspClient` exposes `capabilities()` (the retained InitializeResult capabilities object). Pull supported ⇔ `capabilities.diagnosticProvider` is present.
- **Client advertisement**: initialize params gain `textDocument: { diagnostic: {} }` (minimal; no dynamic registration).
- **Pull result handling**:
  - `full` report → `session.diagnostics.record(...)` with the tracker's current version (feeds existing delta/baseline machinery).
  - `unchanged` report → **no re-record** (a same-version re-record would corrupt baselines); only update stored resultId.
  - resultId kept per `(serverId, uri)` in a small pull-state store owned by `RuntimeSession`.
- **Edit path**: after the existing push wait, if the server advertises pull, issue one pull per matched server within the remaining deadline budget; failures degrade to existing behavior silently.
- **Tool contract**: name `lsp_diagnostics`; params `{ path: string }`; read-only annotations; output = existing format header + freshness + capped items + explicit coverage line naming checked servers; untrusted root returns trust guidance; lazy session creation; errors swallowed into bounded output.
- **Fixture**: fake server gains env-gated pull support — `FAKE_PULL_DIAGNOSTICS=1` advertises `diagnosticProvider` and answers `textDocument/diagnostic` with a content-hash resultId; `previousResultId` matching the hash ⇒ `unchanged`, else `full`. Default behavior unchanged.

## Tasks

Strict TDD mandatory for F1/F3/F4 (product behavior, deterministic tests). F2 is test infrastructure — no RED lifecycle; verified through F3/F4 integration.

| ID | Task | Route | Checks | Status |
| --- | --- | --- | --- | --- |
| F1 | Client retains server capabilities + advertises diagnostic client capability | delegated: gentle-ai-worker | RED/GREEN `tests/unit/lsp/client.test.ts` | done |
| F2 | Fixture pull support (env-gated) + helper flag | delegated: gentle-ai-worker | structural + exercised by F3/F4 | done |
| F3 | Session/activation pull flow: resultId state, full/unchanged, edit-path bounded pull | delegated: gentle-ai-worker | RED/GREEN `tests/unit/runtime/*` | done |
| F4 | `lsp_diagnostics` registered tool, trust-gated, coverage wording | delegated: gentle-ai-worker | RED/GREEEN new `tests/unit/pi/lsp-diagnostics-tool.test.ts` | done |
| F5 | README documents pull + tool | inline | structural readback | done |
| F6 | Full-suite close + assess + native review | inline + native | all green; approved + acknowledged | done |

## Verification commands

`pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build`

## Delivery strategy

`ask-on-risk`. Forecast ~550 authored changed lines (>400 budget): oversized-delivery question asked once before the first commit. **User chose `chain_strategy=feature-branch-chain`** — each slice is its own PR chained on the previous (diagnostic-deltas → on-demand-diagnostics).

## Commit log (work-unit commits, evidence)

| Task | Commit | Notes |
| --- | --- | --- |
| F1 | 680749a | RED→GREEN; client suite 12/12; typecheck clean |
| F2 | 989dcf8 | test infra; protocol smoke + structural check; defaults unchanged |
| F3 | 1cb2545 | RED→GREEN; runtime 46/46, diagnostics 29/29, typecheck clean; session API: pullFresh(serverId, uri, timeoutMs?, client?) |
| F4 | 4c6d05b | RED→GREEN incl. truthfulness round: pullFresh returns unsupported/failed/full/unchanged; hung pull with prior resultId can no longer masquerade as unchanged; pi 12/12, runtime 47/47 |
| F5 | e4bf891 | README: pull diagnostics + tool contract; structural readback |
| F6 | — | 190/190 tests, oxlint clean, tsc clean, build clean; assess medium (510 lines vs feature/diagnostic-deltas base) |

## Review record

- Native assessment: medium risk (executable change, 1118 total changed lines vs origin base).
- Native review lineage `review-9408e493b0e3aacd`: **approved**; acknowledgement burned (`delivery: ordinary-repository-policy`).
- Non-blocking informational findings (separate later work):
  - R3-001 — `src/diagnostics/format.ts:52` (WARNING, informational)
  - R3-002 — `src/runtime/session.ts:209` (WARNING, informational)
- Process note: one capture resubmission was rejected (`capture-binding-rejected`) because the parent corrupted a field while re-serializing the binding; resolved by fresh bound STATUS reoffering the same slot and submitting the exact verbatim binding. Lesson: never reassemble provider bindings by hand.

## Route evidence

- Multi-file write rule fired for F1–F4 ⇒ delegated to one writer per task; F1+F2 may share one worker run (disjoint surfaces, two commits).
- F5 single-file mechanical docs edit ⇒ inline. Workers do not commit; parent commits per work unit.
