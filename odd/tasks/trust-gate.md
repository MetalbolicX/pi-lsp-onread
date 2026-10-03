# Feature: trust-gate

## Objective

Implement the startup authorization boundary for pi-lsp-onread: an explicit,
CLI-managed allowlist of trusted project roots in a user-owned store. Servers
may only start for trusted roots. Trust is runtime-owned — a project's
`.pi/lsp.json` can never grant trust to itself (settled design constraint).

## Authority

- User decision this session: explicit allowlist (CLI-managed) — no prompts,
  headless-safe, auditable. Rejected alternatives: first-use confirmation,
  hybrid prompt.
- Prior decisions: trust is runtime-owned, not project-self-grantable; no
  auto-approval of trust; user-owned global space holds runtime state.

## Design

- Store: `~/.pi/agent/lsp.trust.json` (path injectable), format
  `{ "version": 1, "trustedRoots": string[] }`. Roots stored as canonical
  absolute paths (realpath when the path exists, resolve fallback). Atomic
  writes (tmp + rename, mkdir -p parent). Malformed store → actionable error
  naming the file; commands refuse to write; never silently reset.
- Authorization (pure): `authorize({ projectRoot, trustedRoots })` →
  `{ allowed: true }` | `{ allowed: false, reason: "untrusted_root",
  guidance }`. Exact canonical match only in v1 — trusting a parent does NOT
  trust nested projects (documented; subtree semantics possible later).
  Guidance text names the exact command: `pi-lsp-onread trust add <root>`.
- CLI: `pi-lsp-onread trust [list] | trust add [path] | trust remove [path]`.
  Bare `trust` lists (read-only default). add defaults to cwd, idempotent
  (already trusted → friendly message, exit 0, no write). remove defaults to
  cwd, strict (absent root → error exit 1). list: missing store → "No trusted
  roots." exit 0. Help + README updated. Exit codes 0/1.
- Runtime consumption (server-start checks) lands with the runtime slice;
  this feature delivers the store, the pure gate, and the CLI.

## Non-goals

- Server lifecycle/activation, Pi hooks, diagnostics (runtime slice).
- Interactive prompts of any kind; subtree/inheritance trust; per-server trust.

## Constraints

- No new dependencies. Strict TS NodeNext, oxlint clean, vitest, English.
- Reuse atomic-write pattern; do not import src/cli from src/runtime.
- Branch feat/trust-gate (chained off feat/cli-implement). Push/PR/merge stay
  with the user.

## Checklist

### Task 1 — Trust store + authorization gate (test-first) [done]
- [x] RED: tests/unit/runtime/{trust-store,authorization}.test.ts failed on missing modules
- [x] GREEN: src/runtime/trust-store.ts (injectable path, empty-on-missing, malformed
      refusal, realpath→resolve canonicalize, pure dedup add/remove, atomic save) +
      src/runtime/authorization.ts (exact-match decision + exported untrustedGuidance;
      caller-canonicalized contract documented)
- [x] Checks: typecheck, lint, test (80 passing), build

### Task 2 — CLI trust commands (test-first) [done]
- [x] RED: tests/unit/cli/trust.test.ts failed — `trust` was an unknown command
- [x] GREEN: src/cli/commands/trust.ts (list/add idempotent/remove strict,
      noninteractive, malformed-store refusal); main.ts namespaced dispatch +
      injectable store-path seam; help Trust section; README trust docs
- [x] Checks: typecheck, lint, test (92 passing), build

## Verification evidence

(Baseline at e16512b: 69 tests / 14 files green; recorded per task below.)

- T1 (worker + parent spot check): RED observed; typecheck/lint/build exit 0;
  `pnpm test` 80 passing; parent re-ran test → 80.
- T2 (worker + parent spot check): RED observed (trust unknown command);
  typecheck/lint/build exit 0; `pnpm test` 92 passing; parent re-ran → 92.

## Delivery

- Cached strategy: feature-branch-chain. Commits on feat/trust-gate.
- RDD: on. Assess per commit (first boundary e16512b); slice review at close.

## Follow-ups

Advisory, non-blocking, from the approved review (never reopens it):

- R3-001 (reliability): src/runtime/authorization.ts:3 — WARNING.
- R3-002 (reliability): src/runtime/trust-store.ts:55-56 — WARNING.

## Progress log

- 2026-10-02: user chose explicit allowlist; feature opened before first
  write; branch feat/trust-gate created from e16512b; tasks 1–2 defined.
- 2026-10-02: T1 0fb01c0 (306 lines; 11 tests) — assess medium.
- 2026-10-02: T2 288f1bb (199 lines; 12 tests; 92 total) — assess medium.
- 2026-10-02: Slice review (e16512b..288f1bb): lineage review-a2b4958985e88560,
  medium tier, lens review-reliability, 9 files / 499 lines. One parent
  transcription error rejected without mutation; fresh STATUS + verbatim
  resubmit succeeded. Outcome APPROVED; 2 advisory findings recorded above.
  Acknowledgement executed: authority burned. Feature COMPLETE. Delivery:
  ordinary repository policy; push/PR/merge are user decisions.
