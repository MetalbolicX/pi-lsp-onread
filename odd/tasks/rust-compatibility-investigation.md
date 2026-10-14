# Feature: rust-compatibility-investigation

**Executed.** Plan authored before investigation. Classify F5/F8/F9
using positive controls and minimal protocol evidence before proposing
any extension fix. Surfaces are disjoint from
[host-smoke hardening](pi-host-smoke-hardening.md): default sequential
order, parallel execution only on explicit user opt-in; outcomes feed
[ledger closure](ledger-followup-closure.md).

## Known evidence and its limits

Planning baseline: `main` at
`ede820fc5c560f3d58521f41f0213e4d3ed97f80`. Source records:
[hardening-ledger](hardening-ledger.md),
[finding-fixes](finding-fixes.md), and
[rust-analyzer-smoke](rust-analyzer-smoke.md).

- **F5:** rust-analyzer 1.95.0 advertised code lenses but returned zero
  under valid settings in both configuration shapes. Advertisement
  alone does not guarantee a lens at every location or prove a server bug.
- **F8:** requests at rustc-warning/error positions returned `null` for
  all tested contexts. The native-only pool contained **zero native
  diagnostics**; this does not establish that all assists fail.
- **F9:** empty native pushes interleave with rustc-bearing flycheck
  pushes. Last-push-wins can transiently lose the error/delta baseline.
  Empty reports provide no source identity; source-slot merging could
  retain obsolete errors after a legitimate clear. That design was
  explicitly rejected, and remains rejected without new evidence.

## Work units and reasons

| Unit | Action | Why | Exit evidence |
|---|---|---|---|
| R0 | Inventory installed versions, exact settings, initialization capabilities, configuration requests, workspace readiness, and fixture state. Define bounded positive controls. Before probing F5/F8, consult rust-analyzer documentation and the upstream issue tracker (read-only web research) for codeLens enablement requirements and assist behavior with rustc-sourced diagnostics; record citations. | Configuration rejection and unloaded workspaces previously confounded probes; a known upstream requirement or already-fixed issue can reclassify F5/F8 before any probe runs. | Reproducible environment record; valid configuration with no ignored rejection; explicit readiness evidence before requests; upstream research notes with sources recorded, or an explicit none-found statement. |
| R1 — F5 | Use a lens-eligible fixture/location backed by documentation for the tested version; request raw lenses through the real stack after readiness. Compare the rendered tool result. | Distinguish ineligible fixture/timing from server emptiness or client filtering. | Raw request/response, settings, location, readiness and renderer comparison; actual lens if supported, otherwise narrowly scoped disposition. |
| R2 — F8 | Establish a known-applicable native assist, then test the original rustc-warning location separately. Use genuinely populated native context only when available; compare context variants and raw vs rendered actions. | An empty native pool is not a positive control; code actions are range/context-sensitive. | Action kind, exact range, diagnostic sources, raw responses and non-mutating preview; unavailable native diagnostics explicitly recorded rather than fabricated. |
| R3 — F9 | Capture timestamped push/pull reports and store transitions across broken → different broken → genuinely fixed content. Include versions, sources, empty reports, baseline and eventual state. Repeat a bounded number of times. | Measure reproducibility and transient loss without concealing legitimate clears or mislabeling unchanged versions as freshness. | Timeline linking wire reports to stored/output state; clear succeeds; convergence and delta variants measured; repetitions/timeouts reported; a deterministic unit contract pinning current last-push-wins semantics via fake-server interleaved publish flags is verified present or added as test-infra only. |
| R4 | Classify each result; compare against another already-installed version if available, otherwise propose a separately authorized version comparison. | A reproduced interaction is not automatically a client defect or upstream bug. | Each finding classified as fixture/config/readiness, renderer/client, server/version behavior, protocol ambiguity, or unresolved—with evidence. |

## Probe contract and stop gates

- Use temp, dependency-free fixtures and isolated trust; never apply
  code actions, run server-supplied commands, or modify user projects.
- Prefer the real RuntimeSession/client stack. Standalone framed probes
  must handle server requests faithfully, including `-32601` for
  unhandled requests; escalate to the real stack when instruments disagree.
- Capture relevant `showMessage`/stderr configuration failures. Use
  bounded readiness/polling deadlines, not arbitrary sleeps as proof.
- Set a finite run count and time budget before execution; report timeout
  as failure/inconclusive, never automatically retry to obtain green.
- No downloads, server/SDK upgrades, public issue creation, or installed
  configuration changes without separate user authorization.
- If raw results are correct but client/renderer loses them, propose a
  separate RED → GREEN product-fix slice with deterministic unit coverage.
- If known-positive requests work, tighten the smoke where that fixture
  guarantees the capability. Do not require every optional capability.
- If the server fails a valid positive control, prepare a minimal upstream
  report draft; publication is a separate decision. If inconclusive,
  retain the finding honestly. Do not force a product patch to close it.
- F9 cannot be changed unless the design proves genuine clears remain
  effective, versions/freshness stay correct, and stale errors cannot
  survive by accidental union. A versionless/empty-report ambiguity is
  a finding, not permission to infer a hidden stream identity.

## Deliverables, edits, and verification

Proposed branch: `feature/rust-compatibility-investigation`, created after
authorization from an accepted reviewed baseline. One sequential probe
owner: F5/F8/F9 share Rust fixture, smoke and runtime observation surfaces.
Evidence goes in this plan; reproducible gated fixture/smoke improvements
may touch `tests/smoke/rust-analyzer-smoke-fixture.ts` and
`tests/smoke/rust-analyzer.smoke.test.ts`. Temporary instruments are
removed after capture unless a reusable harness is explicitly justified.
No product source change is part of this investigation slice. Deliverable
addition: verify (and add, if absent) a deterministic unit contract pinning
the store's last-push-wins semantics under interleaved empty and
item-bearing pushes via fake-server publish flags — test-infra only.

Investigation has no promised RED → GREEN fix: preserve raw evidence and
negative/positive controls. Any deterministic assertion/behavior change
must demonstrate its own applicable RED → GREEN. Keep each evidence
unit with its fixture/assertions; forecast and slice the diff if needed.
Rollback removes only new probes/fixture cases, retaining shipped behavior
and prior finding records.

Future checks: gated Rust smoke after each retained harness change;
`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm format:check`, then all three smoke scripts before closure. Record
commands/exit codes and apply applicable native assessment/review.

## Evidence log (R0–R4)

Executed on `feature/rust-compatibility-investigation`, branched from
`main` @ `e335b13` (the merged follow-up plans). One sequential probe
owner; temporary instruments (a /tmp framed-LSP capability A/B probe and
an RA_PROBE-gated harness test) were removed after capture; the durable
repo change is the unit pin only.

- L1 (R0 inventory): rust-analyzer 1.95.0 (5980761 2026-04-14), cargo
  1.95.0, rustc 1.95.0; single `stable` toolchain, single RA binary — a
  version comparison (R4) would require a download and was recorded as
  out of scope, not performed. The client sends
  `{check:{command:"check"}, lens:{enable,run,debug}}` via
  initializationOptions + didChangeConfiguration. Client initialize
  capabilities (`src/lsp/client.ts:212-220`) declare ONLY
  `textDocument.synchronization`, `textDocument.diagnostic`,
  `general.positionEncodings` — no `experimental.commands.commands`, no
  `textDocument.codeAction.codeActionLiteralSupport`.
- L2 (R0 upstream research; rust-analyzer master sources + issue
  tracker — noted: master, not the 1.95.0 tag): Run/Debug lenses require
  the client capability `experimental.commands.commands`
  (`runSingle`/`debugSingle`) plus a loaded cargo workspace (`has_root`),
  while `codeLensProvider` is advertised unconditionally (`config.rs`,
  `handlers/request.rs`, `lsp/to_proto.rs`, `lsp/capabilities.rs`);
  issue #18126 (closed 2024-10-04) is our exact signature — empty lenses
  in a non-VSCode client, resolved by declaring the commands. No
  upstream evidence ties lens emission to flycheck success (none-found).
  `handle_code_action` computes assists positionally, never reads
  `params.context.diagnostics` (only `context.only`), and returns
  `Ok(None)` → JSON-RPC `null` when the client lacks
  `textDocument.codeAction.codeActionLiteralSupport`.
- L3 (R1+R2 probe — one capability A/B instrument, verbatim):
  - A (current client capabilities): `codeLensProvider=true`, rustc
    flycheck flowing; `codeLens → []` (F5 reproduced); codeAction at
    struct / unused-import / rustc-error positions → `null` (F8
    reproduced; `result: null` renders as `undefined` through the
    summarizer).
  - B (A + `experimental.commands.commands` +
    `codeActionLiteralSupport`): `codeLens` at the `#[test]` returned a
    real `▶︎ Run Tests` / `rust-analyzer.runSingle` lens (F5 = client
    capability gap); codeAction returned non-empty arrays, including
    `Generate undefined_helper function` at the ORIGINAL rustc-error
    position — the earlier "no actions for rustc-sourced context"
    statement is disproven; the `null` was the missing capability. One
    transient `{"code":-32801,"message":"content modified"}` at the
    struct position (the same connection returned arrays elsewhere);
    recorded verbatim.
  - Renderer-comparison honesty: the `lsp_code_lens`/`lsp_code_actions`
    renderers are covered by existing FAKE_CODE_LENS / fake-server
    unit+smoke coverage; rendering a REAL lens end-to-end requires the
    capability fix (separate slice), so the rendered leg stays bounded
    to that existing coverage.
- L4 (R3): unit pins added (`tests/unit/diagnostics/store.test.ts`,
  15/15 green): an empty push at the SAME version replaces a
  rustc-bearing push (baseline retains the error snapshot — the F9
  transient-loss mechanism, deterministic) and a version-advanced empty
  push is a genuine clear. Real-stack timeline (RA_PROBE instrument,
  deleted after capture): E0425 surfaced +1239ms (v=1, 1 error), E0432
  +7160ms (v=2, 2 errors), fix → v=3 at +7340ms with **errors=0** (the
  2 remaining items are rustc warnings — unused variable / dead code —
  persisting by design); genuine error-clear confirmed. Flycheck
  edit→publish latency varied 0.2s–60s+ across three runs (attempt 2
  timed out a 45s phase-2 budget), making 50ms-granularity interleaving
  capture unreliable in this environment.
- L5 (R4 classification):
  - **F5 → client-side capability gap** (was recorded server-side): the
    server is correct for the declared capability set. Fix path:
    advertise `experimental.commands.commands` in `src/lsp/client.ts`
    initialize capabilities — a separate RED→GREEN product slice (unit:
    initialize params; gated smoke: lens appears). NOT changed here.
  - **F8 → client-side capability gap** (was recorded server-side):
    `null` ⇔ missing `codeActionLiteralSupport`; assists work at
    rustc-error positions once declared. Same product-fix slice as F5.
  - **F9 → stays recorded**, mechanism now pinned deterministically at
    unit level; the timeline confirms genuine error-clears converge;
    merge-by-source remains rejected (no stream identity; stale-item
    risk).
  - Version comparison: skipped — no second RA binary without a
    download (authorization gate).
  - Upstream reports: none warranted for F5/F8 (the server behaved per
    its declared capabilities). Nothing published.
  - Prior records to reconcile: `hardening-ledger.md`'s F5/F8
    "server-side confirmed" dispositions are superseded by this
    evidence — reconciliation belongs to the ledger-followup-closure
    slice (C1/C2).

## Acceptance and status

- [x] F5 has a justified positive fixture and raw-vs-rendered comparison.
- [x] Upstream documentation/issue research is recorded before F5/F8
      classification (or an explicit none-found statement).
- [x] F8 distinguishes native assists from the rustc-context scenario.
- [x] F9 records both transient loss and a true diagnostic clear.
- [x] Current last-push-wins store semantics are pinned by a
      deterministic unit contract (added as test-infra; 15/15 green).
- [x] Every finding has a bounded, evidence-backed disposition; unresolved
      is acceptable when the limit is explained.
- [x] No speculative merge-by-source or silent product fix was introduced.

R0–R4: **complete** on `feature/rust-compatibility-investigation`
(branched from `main` @ `e335b13`). Evidence in the log above. The
ledger-followup-closure slice reconciles the corrected F5/F8
dispositions with the older records; the F5/F8 capability fix is its own
future product slice, authorized separately.

## Review record

- Post-implementation assess (committed range, base
  `e335b13d3f9dd8a9bfce20d73b230922b73a8109`): **medium risk**
  (`executable_change`: `tests/unit/diagnostics/store.test.ts`),
  2 paths / 144 lines, **reviewDue: false (`under_budget`)** — writer
  self-verification stands (unit pins 15/15 focused; full battery on
  final content: bare 508/49+3 skipped, lint/tsc/build/format clean,
  gopls 8/8, rust-analyzer 8/8, pi-host 5/5, 0 orphans). No native
  review started per entry rule; if a later reminder claims this
  target, the tight base above applies. Commits: `dd4b08b` (unit pins)
  + `74fb883` (this evidence).
- RDD reminder (target `sha256:0e418ba6…`) later claimed the slice:
  **APPROVED — ZERO findings** — lineage `review-18abaadc3f68be9c`,
  medium (`executable_change`: `tests/unit/diagnostics/store.test.ts`),
  `review-reliability` lens, 2 paths / 157 lines, correction budget 79,
  tight base `e335b13d3f9…` (committedOnly; candidate `dd4b08b` +
  `74fb883` + `1b9c038`). Reviewer forecast (1 host-relay run)
  acknowledged; approved on the last admitted event; acknowledgement
  burned (consumed revision `sha256:8c867c8d…`). Delivery: ordinary
  repository policy.
