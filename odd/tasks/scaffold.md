# Feature: project scaffold (pi-lsp-onread)

- Date: 2026-10-03
- Status: in progress
- Route: inline direct (mechanical new-file scaffold; design authored in the orchestrator session; multi-file but zero-ambiguity content, so a writer delegation would not add safety)
- Delivery strategy: single work-unit commit on `feat/scaffold` (brand-new repository)

## Goal

Standalone TypeScript package at `/home/metalbolicx/Documents/pi-lsp-onread` containing the Pi extension entry, the configuration CLI shell, the language preset catalog, and the v1 JSON Schema — installed with pnpm, checked (typecheck + lint + test + build), and committed.

Toolchain (user-selected): pnpm, TypeScript, rolldown bundler, vitest, oxlint — mirroring the proven pi-rules-md setup.

## Tasks

- [x] T1 Init git repo + feature doc (this file) — branch `feat/scaffold`
- [x] T2 Package manifest + TypeScript toolchain (package.json, tsconfig.json, rolldown.config.js, .gitignore, LICENSE)
- [x] T3 Source skeleton: extension entry, CLI entry, preset catalog, v1 schema, tests
- [x] T4 Install dependencies (pnpm)
- [x] T5 Verify: typecheck + lint + test + build
- [x] T6 Record evidence + work-unit commit

## Verification evidence

- `pnpm typecheck` (tsc --noEmit, strict): clean
- `pnpm lint` (oxlint): clean
- `pnpm test` (vitest): 2 files, 11/11 passed
- `pnpm build` (rolldown): dist/extension.js + dist/cli.js produced
- CLI smoke: `node dist/cli.js list` renders the catalog; `--version` prints 0.0.1
- Note: pnpm 12 no longer reads the `pnpm` field in package.json; build-script denials are recorded in pnpm-workspace.yaml (`allowBuilds`), recorded via `pnpm approve-builds '!pkg'`

## Commit identity

- Work-unit commit: `811f299` — feat: scaffold pi-lsp-onread package with TypeScript toolchain (branch `feat/scaffold`)

## Decisions locked from design discussion

- Name `pi-lsp-onread`; greenfield; diagnostics-first MVP.
- Reads: background warmup + cached errors with freshness labels; no blocking waits on read.
- Config: extension-owned `~/.pi/agent/lsp.json` (global) + `.pi/lsp.json` (project), OpenCode-like server entries; bundled JSON Schema (Draft 2020-12).
- CLI generates configuration only — never downloads/installs LSP servers or starts builds.
- One package, one executable (`pi-lsp-onread`), two command families: `install` (self-registration via `pi install`) and `init/add/list/check` (project config). Self-registration chosen over generic installer.
