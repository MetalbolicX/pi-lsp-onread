# Feature: navigation-tools (roadmap T1.3 completion)

## Intent

Complete roadmap T1.3: on-demand, read-only **definition** and **references** navigation — two new Pi tools (`lsp_definition`, `lsp_references`) backed by `textDocument/definition` and `textDocument/references`. The diagnostics half of T1.3 (`lsp_diagnostics`) already shipped.

## Design decisions (settled before implementation)

- **Position contract**: tools take 1-based `line`/`character` (model-facing, matching how every formatter in this extension prints coordinates); the session layer sends 0-based LSP coordinates. Encoding: the client does not advertise `general.positionEncoding`, so per LSP 3.17 the server default **UTF-16 code units** applies — documented in tool descriptions, README, and feature doc. Position-encoding negotiation is a known foundation leftover; this slice does not add config/schema.
- **Two tools, one core**: `lsp_definition {path, line, character}` and `lsp_references {path, line, character, includeDeclaration?}` (includeDeclaration optional, default `false`). Both share one internal execute routine in a single module `src/pi/lsp-navigation-tools.ts`, mirroring the sibling tools' gating/bucketing/budgeting (activate → trust/match, per-server capability gate, bounded timeout, `MAX_OUTPUT_CHARS = 8_000`, footer).
- **Session layer**: `definition(serverId, uri, line, character, timeoutMs, client?)` and `references(serverId, uri, line, character, includeDeclaration, timeoutMs, client?)` → `{ outcome: "unsupported" | "failed" | "ok", locations: unknown[] }`. Capability gates: truthy `definitionProvider` / `referencesProvider`. Response contract: `null`/missing result → `ok` with `[]` (server legitimately reports none — unlike diagnostics, absence is a valid answer here); definition accepts a single Location/LocationLink object (wrapped into a one-element array) or an array; references accepts an array; anything else → `failed`. Raw cap 1000. Never throws, never mutates state.
- **Formatter**: new module `src/navigation/format.ts` with `formatLocations(locations, maxChars)` — per entry: `uri` string required (absent → unreadable, counted); file URIs decoded via the same logic as `formatWorkspaceSymbols` (exported helper reused); uri+range → `path:line:col-line:col` (1-based), uri without readable range → `path (range unknown)`. Caps: 300 entries, char budget with `… N locations not shown` / `… N unreadable locations omitted` lines; never exceeds `maxChars`.
- **Fixture**: `FAKE_NAVIGATION=1` advertises `definitionProvider` + `referencesProvider`. Definition: if requested line is within the open document → one Location at the requested (echoed, 0-based) position clamped to line length; out-of-range line → `null`. References: Locations for every line of the open document (0-based line, char 0, char = line length); out-of-range → `[]`; honors `FAKE_HANG_METHOD`.
- **Tool outputs**: per-server sections (headers only when >1), failures/unsupported lines, honest empties (`No definition found at this position.` / `No references reported at this position.` — server-reported), footer: `coverage: N server(s) queried for this position; results reflect each server's current view and may lag recent edits; positions are 1-based UTF-16 code units; other positions and files not checked`. Untrusted/no-match/inactive gating identical to siblings.

## Boundaries (binding)

Non-blocking; read-only annotations; never imply completeness; explicit `unsupported`/`failed`; strict TDD for N2–N4 (observed RED → GREEN); N1 structural; N5 docs read-back.

## Tasks

- [x] N0 — Branch `feature/navigation-tools` stacked on `feature/workspace-symbol-search`.
- [x] N1 — Fixture `FAKE_NAVIGATION=1` + helper flag `navigation`. Structural.
- [x] N2 — `RuntimeSession.definition` + `references`. Strict TDD.
- [x] N3 — `src/navigation/format.ts` `formatLocations`. Strict TDD.
- [x] N4 — `src/pi/lsp-navigation-tools.ts` (both tools) + registration. Strict TDD.
- [x] N5 — README bullet (inline).
- [x] N6 — Close: full suite, lint, typecheck, build; closure docs; native review (RDD); review record.

## Commit log

| Task | Commit | Message |
|------|--------|---------|
| N1 | `81b9663` | test(fixture): add navigation mode to fake LSP server |
| fix | `760d9c0` | style: use destructuring in fixture navigation handler (lint finding on N1) |
| N2 | `929789b` | feat(runtime): add definition and references requests |
| N3 | `867e03c` | feat(navigation): add bounded location formatting |
| N4 | `331a253` | feat(tools): add lsp_definition and lsp_references tools |
| N5 | `fb851c8` | docs: document navigation tools |
| N6 | _pending_ | closure + review record |

## Verification evidence (N6)

- `pnpm test`: 33 files / 300 tests passed (verified by gentle-ai-verify at HEAD fb851c8).
- `pnpm lint`: exit 0 clean. `pnpm typecheck`: clean. `pnpm build`: rolldown success (extension.js 658.59 kB, cli.js 301.15 kB).
- TDD: N2 (20 tests RED → GREEN), N3 (RED = module absent at import, then 10 tests GREEN), N4 (10 tests RED → GREEN). N1 structural (fixture + helper, suite green; lint finding on the fixture fixed in `760d9c0`). One transient suite timeout on an unrelated LSP-client test was observed mid-feature and did not reproduce (verifier run passed first try).

## Review record

- _pending at close (N6)._

## Route evidence

- Branch: `feature/navigation-tools` stacked on `feature/workspace-symbol-search` (chain strategy cached from user).
- Delegation: per-task `gentle-ai-worker` for multi-file writes with exact `## Allowed edit surfaces`; parent commits each work unit; workers never commit.
- Verification: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (full battery via `gentle-ai-verify` at close).
