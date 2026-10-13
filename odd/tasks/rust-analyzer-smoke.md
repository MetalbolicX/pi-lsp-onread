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
| T1 Author gated rust-analyzer smoke (fixture + suite, optional shared-harness extraction) | S1–S8 | worker | C1 |
| T2 Parent re-run: unit battery + gated smoke both servers | S1–S8 | parent | — |
| T3 Closure, commits, assess | all | parent | C2+ |

## Log

- L1: "continue with rust analyzer" — authorized. Inventory:
  rust-analyzer, cargo, rustc all on PATH (cargo bin dir).

## Review record

- (pending)
