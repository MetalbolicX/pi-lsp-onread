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

### Task 5 — install command + docs [pending]
- [ ] RED: tests/unit/cli/install.test.ts
- [ ] GREEN: src/cli/commands/install.ts + src/cli/pi-runner.ts (injectable);
      pi availability detection, `pi install npm:pi-lsp-onread` (+--local),
      --dry-run prints, failures relay pi output, exit 1 clear errors
- [ ] README CLI section updated to final behavior (all commands)
- Route: delegated.

## Verification evidence

(Per task as `<command>: <result>`; baseline: 33713bf all green, 28 tests.)

## Delivery

- Cached strategy: feature-branch-chain (user choice, config-foundation
  slice). New commits on feat/cli-implement; push/PR/merge user decisions.
- RDD: on. Assess after each work-unit commit (first boundary 33713bf);
  native review at slice close.

## Progress log

- 2026-10-02: feature opened before first write; branch feat/cli-implement
  created from 33713bf; tasks 1–5 defined.
