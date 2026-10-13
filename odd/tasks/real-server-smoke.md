# Feature: real-server-smoke

Layer-1 controlled runtime smoke against a real installed language server
(`gopls`), per the two-layer plan. Layer 2 (actual Pi host smoke) stays out
of scope this slice.

## Authority

User: "Follow the recommendation. Is other thing to consider?" after the
inventory (gopls + go toolchain present; no TS/Pyright/clangd/ReScript
servers). Authorization covers: starting the `gopls` executable found at
`/home/metalbolicx/go/bin/gopls` against an isolated Go fixture, isolated
config/trust (injected, no personal `~/.pi/agent/lsp.json` or
`lsp.trust.json` writes), stdlib-only fixture (no module downloads).

## Specs

Numbered expectations from the approved plan table:

- S1 — Untrusted fixture root: activation returns trust guidance and
  **no server process is started**.
- S2 — First trusted read: activation runs in the background; the read
  itself does not wait; server initializes; record advertised capabilities
  and actual gopls/tsserver-equivalent (gopls + go) versions verbatim.
- S3 — Diagnostics: the deliberate compile error surfaces with honest
  freshness/coverage labels; after fixing the file and activating `edit`,
  the delta reports the error as resolved within the wait budget.
- S4 — Navigation on known symbols: `lsp_definition`, `lsp_references`,
  `lsp_hover`, `lsp_symbols` return non-trivial, correct-location results;
  a definition on a symbol positioned after an astral character (🚀) on the
  same line resolves correctly (UTF-16 math).
- S5 — Read-only previews: `lsp_formatting`, `lsp_organize_imports`,
  `lsp_code_actions` (with preview), `lsp_rename` (prepare + preview)
  return meaningful proposed edits and **fixture files on disk stay
  byte-identical**.
- S6 — Optional capability tools (`lsp_call_hierarchy`,
  `lsp_type_hierarchy`, `lsp_selection_range`, `lsp_document_highlight`,
  `lsp_code_lens`, `lsp_inlay_hints`): outcome-aware assertions — success
  must be non-trivial on purpose-built cases, `unsupported` (capability
  absent) is acceptable and recorded, `failed` on an **advertised**
  capability is a finding reported honestly, never swallowed.
- S7 — Shutdown: `dispose()` cleanly exits the server, is idempotent, and
  post-dispose session use names the disposed state.
- S8 — Isolation: bare `pnpm test` never spawns servers (env-gated);
  personal trust store and global config untouched; fixture lives in a
  runtime temp dir.

## Non-goals

Layer-2 real-Pi-host smoke; other servers (rust-analyzer etc.); CI wiring;
product-code changes; installing anything.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 Author smoke harness (fixture + gopls.smoke.test.ts, gated) | S1–S8 | worker | C1 |
| T2 Parent re-run: unit battery + gated smoke, observations recorded | S1–S8 | parent | C2 |
| T3 Closure, docs, work-unit commits | all | parent | C3 |

## Log

- L1: "Lets plan the real server smoke to check what expect" (planning
  request; produced two-layer plan, read-only).
- L2: "Follow the recommendation. Is other thing to consider?" —
  authorization to execute the gopls smoke per plan; consideration
  question answered at close.

## Review record

- (pending)
