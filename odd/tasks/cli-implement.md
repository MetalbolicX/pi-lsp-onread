# Feature: cli-implement

## Objective

Implement the real CLI for pi-lsp-onread per recorded design decisions
(Engram pi-lsp-onread/cli-design-v1, cli-design-v2, extension-registration):
`init`, `add`, `check`, and `install` replace the exit-2 stubs. Configuration
generation only — the CLI never downloads, installs, starts, or executes LSP
servers, and never mutates Pi package settings.

## Authority (recorded decisions)

- `init`: target default cwd or `--project <path>`; inspect root
  manifests/markers as selection hints, never choose languages silently;
  interactive multi-preset selection, or `--languages a,b` noninteractive;
  show the exact planned change; validate before writing; `--dry-run` no
  writes; `--yes` approves only nonconflicting additions.
- `add <preset...>`: same pipeline, noninteractive positional presets.
- Safe extension: preserve custom `$schema`, servers, env, settings,
  diagnostics; malformed existing config or conflicting server definitions
  stop before writing with explicit conflict report.
- New configs get a self-contained schema copy at `.pi/lsp.schema.json`
  referenced as `$schema: "./lsp.schema.json"`; existing custom `$schema`
  refs preserved.
- Commands use portable PATH names / project-relative binaries; no machine
  absolute paths; no npx/dlx implicit installers.
- `check`: validate config + STATIC executable discovery; never execute
  servers (`--version` execution forbidden); missing binary is a finding.
- `install`: self-only registration delegating to native `pi install
  npm:pi-lsp-onread` (personal scope default, `--local` for project scope);
  requires the Pi CLI and fails clearly if unavailable; `--dry-run` prints
  the command; never edits Pi settings directly; no purge/cleanup.
- Exit codes after implementation: 0 success; 1 errors, conflicts, or check
  findings. (Exit 2 "not implemented" disappears.)

## Non-goals

- LSP runtime, activation, diagnostics pipeline, Pi extension hooks.
- Interactive TUI frameworks; new runtime dependencies (readline only).
- Generic Pi-extension installer (self-only, per decision).
- Schema changes.

## Constraints

- Reuse src/config (shape+semantic validation, merge) and src/presets
  catalog; do not duplicate definitions.
- Atomic writes (temp file + rename) in the project `.pi/` directory.
- Strict TS NodeNext, oxlint clean (no `any`), vitest; artifacts English.
- Branch feat/cli-implement (chained off feat/scaffold per cached
  feature-branch-chain choice). Push/PR/merge remain user decisions.

## Checklist

### Task 1 — Generation/write pipeline [done]
- [x] RED: tests/unit/cli/generate.test.ts failed against missing module
- [x] GREEN: src/cli/generate.ts — plan/build/write pipeline with NEW/NOOP/CONFLICT,
      custom-field preservation, companion for new configs, pre-write validation
      (source shape via ajv + in-memory merge→semantic validate), atomic write,
      dry-run no-write
- [x] Note: buildEffectiveConfig is FS-bound; in-memory validation composes the
      existing merge + semantic validators directly
- [x] Checks: typecheck, lint, test (35 passing), build

### Task 2 — init command [done]
- [x] RED: tests/unit/cli/init.test.ts failed against exit-2 stub
- [x] GREEN: src/cli/commands/init.ts + src/cli/manifests.ts + async main
      (Promise<number>, src/cli.ts awaits under self-exec guard; parent-approved
      seam change; existing cli tests updated to await)
- [x] Flags --project/--languages/--dry-run/--yes; hints never auto-select;
      interactive numbered multi-select via injectable readline; non-TTY guard;
      conflicts always block; dry-run no-write; malformed config stops
- [x] Checks: typecheck, lint, test (45 passing), build

### Task 3 — add command [done]
- [x] RED: tests/unit/cli/add.test.ts failed against exit-2 stub (8 tests)
- [x] GREEN: src/cli/commands/add.ts noninteractive create-or-extend via shared
      pipeline; src/cli/format.ts shared plan/conflict formatting (init updated
      to import, no behavior change); usage error / unknown preset listing /
      conflict block / malformed stop / dry-run semantics
- [x] Parent note: stale stub assertion in tests/unit/cli.test.ts updated by
      parent (add → usage-error exit 1; check/install stay exit 2 until T4/T5)
- [x] Checks: typecheck, lint, test (54 passing), build

### Task 4 — check command [done]
- [x] RED: tests/unit/cli/check.test.ts + executables.test.ts failed against stub/missing module
- [x] GREEN: src/cli/commands/check.ts + src/cli/executables.ts (static-only
      discovery: PATH X_OK scan / project-root resolution; no process spawn);
      validation errors precede discovery; disabled/lsp:false skipped; missing
      enabled executable = finding; exit 0 clean / 1 findings
- [x] Parent-authorized minimal cli.test.ts update (check out of stub loop)
- [x] Checks: typecheck, lint, test (64 passing), build

### Task 5 — install command + docs [done]
- [x] RED: tests/unit/cli/install.test.ts failed against exit-2 stub (6 tests)
- [x] GREEN: src/cli/commands/install.ts + src/cli/pi-runner.ts (injectable
      spawn); static PATH-only pi detection (reuses executables lookup, no
      `pi --version` spawn); `pi install npm:pi-lsp-onread` (+--local);
      --dry-run prints only; failures relay output exit 1; never edits Pi
      settings; no LSP installs; no purge
- [x] README CLI section = final behavior for all commands + exit-code contract
- [x] Stub loop removed from cli.test.ts (no exit-2 remains anywhere)
- [x] Checks: typecheck, lint, test (69 passing ×2 runs), build

## Verification evidence

(Per task as `<command>: <result>`; baseline: 33713bf all green, 28 tests.)

- T1 (worker + parent spot check): RED observed; typecheck/lint/build exit 0;
  `pnpm test` 35 passing; parent re-ran test → 35.
- T2 (worker + parent spot check): RED against stub; async main seam change
  parent-approved; typecheck/lint/build exit 0; `pnpm test` 45 passing;
  parent re-ran test → 45.
- T3 (worker, then parent): RED 8 tests; worker full-suite partial on stale
  stub assertion; parent updated tests/unit/cli.test.ts (add → usage exit 1;
  check/install remain stubs); typecheck + full `pnpm test` 54 → green.
- T4 (worker + parent spot check): RED 16 tests; typecheck/lint/build exit 0;
  `pnpm test` 64 passing; parent re-ran test → 64.
- T5 (worker + parent): RED 6 tests; typecheck/lint/build exit 0; `pnpm test`
  69 × 2 runs; RDD assess HIGH (process_boundary shell_process) → independent
  gentle-ai-verify run REQUIRED and executed: process boundary MITIGATED
  (array args, no shell, injectable runner, dry-run no-spawn verified live,
  static PATH detection); verifier exposed deterministic init-test timeout
  (2/2 runs) pre-existing from T2.
- Test-race fix 5c1c083 (worker): root cause fixed-delay staged input racing
  readline prompt registration; prompt-staged input; 5× focused + 3× full
  suite green (69); parent spot check 69; assess medium (test-only).

## Delivery

- Cached strategy: feature-branch-chain (user choice, config-foundation
  slice). New commits on feat/cli-implement; push/PR/merge user decisions.
- RDD: on. Assess after each work-unit commit (first boundary 33713bf);
  native review at slice close.

## Follow-ups

All advisory, non-blocking, from the approved four-lens native review
 (never reopens it; separate later work):

- R1-001 (risk): src/cli/generate.ts:107 — WARNING, informational.
- R2-001 (readability): src/cli/commands/add.ts:28 — SUGGESTION.
- R3-001 (reliability): src/cli/executables.ts:5-9 — WARNING.
- R3-002 (reliability): src/cli/generate.ts:106-108 — WARNING.
- R4-001 (resilience): src/cli/generate.ts:105-107 — WARNING.
- (Prior slice) R3-001: src/workspace/match.ts:23 — informational.

## Progress log

- 2026-10-02: feature opened before first write; branch feat/cli-implement
  created from 33713bf; tasks 1–5 defined.
- 2026-10-02: T1 48c3fb2 (337 lines) — assess medium.
- 2026-10-02: T2 8dc99e8 (431) — parent-approved async main seam; assess
  medium; slice budget reached (cached feature-branch-chain applies).
- 2026-10-02: T3 b0ee506 (252) — parent updated stale stub assertion; assess
  medium after parent corrected a mis-transcribed baseRef SHA.
- 2026-10-02: T4 8269dfe (261) — assess medium after second SHA correction
  (always rev-parse, never hand-copy).
- 2026-10-02: T5 55f6251 (200) — assess HIGH (process_boundary) → mandatory
  independent verifier run executed; boundary mitigated; verifier found
  deterministic init-test timeout. Fix 5c1c083 (39) — assess medium.
- 2026-10-02: Slice complete: 5 tasks + fix, 6 commits, ~1220 authored lines,
  69 tests / 14 files, all checks green. Slice review at close.
- 2026-10-02: Slice review (33713bf..9c91a4e, docs commit included): lineage
  review-ad7815b93cfd33e1, HIGH tier (process_boundary pi-runner), four
  lenses risk/resilience/readability/reliability, 20 files / 1442 lines,
  correction budget 200. One parent transcription error in a group binding
  was rejected without mutation; fresh STATUS + verbatim resubmit succeeded.
  Outcome APPROVED (4/4 reviewers); 5 advisory findings recorded above.
  Acknowledgement executed: authority burned. Delivery: ordinary repository
  policy; feat/cli-implement → feat/scaffold chain; push/PR/merge are user
  decisions. Feature COMPLETE.
