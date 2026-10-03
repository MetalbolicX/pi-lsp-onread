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
- [ ] T2 Package manifest + TypeScript toolchain (package.json, tsconfig.json, rolldown.config.js, .gitignore, LICENSE)
- [ ] T3 Source skeleton: extension entry, CLI entry, preset catalog, v1 schema, tests
- [ ] T4 Install dependencies (pnpm)
- [ ] T5 Verify: typecheck + lint + test + build
- [ ] T6 Record evidence + work-unit commit

## Verification evidence

- (pending)

## Commit identity

- (pending)

## Decisions locked from design discussion

- Name `pi-lsp-onread`; greenfield; diagnostics-first MVP.
- Reads: background warmup + cached errors with freshness labels; no blocking waits on read.
- Config: extension-owned `~/.pi/agent/lsp.json` (global) + `.pi/lsp.json` (project), OpenCode-like server entries; bundled JSON Schema (Draft 2020-12).
- CLI generates configuration only — never downloads/installs LSP servers or starts builds.
- One package, one executable (`pi-lsp-onread`), two command families: `install` (self-registration via `pi install`) and `init/add/list/check` (project config). Self-registration chosen over generic installer.
