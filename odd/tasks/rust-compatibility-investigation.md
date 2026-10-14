# Feature: rust-compatibility-investigation

**Plan only; investigation execution requires a later user go-ahead.**
Classify F5/F8/F9 using positive controls and minimal protocol evidence
before proposing any extension fix. Surfaces are disjoint from
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

## Acceptance and status

- [ ] F5 has a justified positive fixture and raw-vs-rendered comparison.
- [ ] Upstream documentation/issue research is recorded before F5/F8
      classification (or an explicit none-found statement).
- [ ] F8 distinguishes native assists from the rustc-context scenario.
- [ ] F9 records both transient loss and a true diagnostic clear.
- [ ] Current last-push-wins store semantics are pinned by a
      deterministic unit contract (verified present or added as
      test-infra).
- [ ] Every finding has a bounded, evidence-backed disposition; unresolved
      is acceptable when the limit is explained.
- [ ] No speculative merge-by-source or silent product fix was introduced.

R0–R4: **pending; not executed**. The next slice reconciles these results
with the host-smoke findings and documentation.
