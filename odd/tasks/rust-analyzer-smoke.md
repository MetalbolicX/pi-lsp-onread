# Feature: rust-analyzer-smoke

Layer-1 controlled runtime smoke against a second real server —
`rust-analyzer` — proving multi-language generality of the gopls-proven
harness. Layer 2 (real Pi host) stays out of scope.

## Authority

User: "continue with rust analyzer" — standing option from the smoke
close-out. Authorization covers starting `rust-analyzer`
(`/home/metalbolicx/.cargo/bin/rust-analyzer`, with `cargo`/`rustc` on
PATH) against an isolated cargo fixture; isolated config/trust; no
external crates (offline-safe).

## Specs

Adapted from the gopls-proven S1–S8, with rust-analyzer-specific
observation targets (record verbatim, never assume):

- S1 — Untrusted fixture root: trust guidance, no spawn.
- S2 — Non-blocking first read; initialize; record rust-analyzer /
  cargo / rustc versions and the advertised capability set. Rust-analyzer
  differences worth observing: `renameProvider.prepareProvider` (gopls
  lacked it), pull diagnostics (`diagnosticProvider`), rich code actions
  with resolve, inlay hints, experimental capabilities.
- S3 — Deliberate compile error surfaces with freshness labels; fix-edit
  delta reports it resolved. NOTE: rust-analyzer diagnostics for cargo
  projects come from flycheck (cargo check) — timing differs from gopls
  push; observe convergence honestly within the wait budget.
- S4 — definition/references/hover/symbols on known fixture symbols;
  UTF-16 astral probe (symbol after 🚀 on the same line).
- S5 — Read-only previews: formatting (rustfmt), code actions (preview
  one), rename (prepare — EXPECTED to be supported this time — plus
  preview); fixture files byte-identical on disk.
- S6 — Optional tools outcome-aware: call hierarchy (prepare→item→
  incoming/outgoing), type hierarchy, selection range, document
  highlight, code lens, inlay hints; unsupported acceptable and
  recorded; failed-on-advertised = reported finding.
- S7 — dispose() clean, idempotent; post-dispose names disposed state.
- S8 — Bare `pnpm test` never spawns (env gate); temp-dir fixture;
  injected config + isolated trust store; personal paths untouched.

## Non-goals

Layer-2 Pi-host smoke; merging (user decides); other servers; product
changes; CI wiring.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| [x] T1 Author gated rust-analyzer smoke (fixture + suite) | S1–S8 | worker + parent | C1 |
| [x] T2 Parent re-run: unit battery + gated smoke both servers | S1–S8 | parent | — |
| [x] T3 Closure, commits, assess | all | parent | `d015b1c`, `7154325` |

## Log

- L1: "continue with rust analyzer" — authorized. Inventory:
  rust-analyzer, cargo, rustc all on PATH (cargo bin dir).
- L2 (blocker, user-resolved): the PATH `rust-analyzer` is a rustup proxy
  with the component ABSENT (verbatim: `Unknown binary 'rust-analyzer'
  in official toolchain 'stable-x86_64-unknown-linux-gnu'`). User chose
  "Install component" → `rustup component add rust-analyzer` →
  `rust-analyzer 1.95.0 (5980761 2026-04-14)`; cargo 1.95.0, rustc 1.95.0.
- L3 (T1 evidence): harness authored by worker (fixture + gated suite,
  `smoke:rust-analyzer` script, README note); first real run 5/8 — three
  failures diagnosed by parent with a standalone framed-LSP probe
  (/tmp/ra-probe.mjs, Content-Length protocol, NOT repo code).
- L4 (FINDINGS — all PRODUCT-side unless noted, all UNFIXED, fix decision
  is the user's; each is asserted verbatim in the smoke so fixes flip it):
  - **F3 codeAction context omitted**: `session.codeActions` sends
    `textDocument/codeAction` with `{ textDocument, range }` only — the
    LSP-REQUIRED `context` param is missing. gopls tolerated; rust-analyzer
    rejects ("failed to retrieve code actions"). Probe with
    `context: { diagnostics: [] }` returns clean `null`. Full fix must also
    send the file's current diagnostics (servers filter quickfixes by
    context.diagnostics).
  - **F4 pull clobbers push**: probe proved RA PUSHES flycheck E0425
    (`undefined_helper`, source rustc) within ~2s, yet the tool showed
    `fresh: current / no diagnostics received` for 120s: `pullFresh`
    records each pull "full" report as the authoritative snapshot, and RA's
    pull view (native diagnostics only) omits flycheck results — every
    `lsp_diagnostics` poll re-clobbers the pushed error.
  - **F5 codeLens advertised-but-empty** (interaction finding):
  `codeLensProvider` advertised, lens settings sent (`lens.run.enable`),
    `#[test]` fn in range — yet zero lenses returned. RA-side investigation;
    the tool's empty-with-coverage output is honest.
  - **F6 EOF clamp off-by-one (amends F1)**: the F1 clamp uses
    `split("\n").length`, one past the LSP-legal EOF line (valid max =
    length − 1 for files ending in a newline). Probe error verbatim:
    `Invalid offset LineCol { line: 12, col: 0 } (line index length: 183)`.
    gopls tolerates the one-past line (its smoke passed); rust-analyzer
    rejects — so the DEFAULT 200-line inlay window fails on any short file
    against RA. Same request-shape class as F3.
- L5 (T1 harness edits): S3/S5/S6 converted to finding-observation
  branches (assert each finding shape verbatim; original success assertions
  run automatically once the fixes land — never loosened silently). Also:
  rename prepare confirmed `prepareProvider: true` ("ready to rename",
  placeholder recorded — gopls lacked it); formatting preview (rustfmt) ok;
  rename preview multi-file ok; disk byte-identical after all previews;
  call hierarchy spec-shaped on a real server (`main → callee`,
  `callee → to_uppercase` — stdlib location resolved); type hierarchy
  genuinely unsupported (capability absent); selection_range (7 nested ok
  on gopls) / document_highlight ok; S1/S7/S8 pass (no-spawn untrusted,
  dispose idempotent, isolated temp+trust).
- L6 (T2 evidence): bare `pnpm test` 494 passed | 16 skipped (51 files,
  both smokes skipped — never spawns); lint/tsc/format green (after removing
  an orphaned helper + biome format on the touched file); BOTH gated smokes
  green on final content: gopls 8/8, rust-analyzer 8/8 (duration ~21s,
  finding paths; five FINDING observations captured verbatim via
  `--silent=false`).

## Review record

- Post-implementation assess (committed range, base `7c2b868fa6…`):
  **medium risk** (`configuration_change`: package.json), 5 paths / 893
  lines, **reviewDue: false (`under_budget`)** — no native review started
  per entry rule; writer self-verification stands (worker authored + parent
  independently reran: bare 494/49+skip, lint/tsc/format green, both gated
  smokes 8/8 on final content). If a later reminder claims the target, the
  tight base above applies.
