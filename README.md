# pi-lsp-onread

Pi extension that activates project-configured LSP servers when the agent reads code, and feeds language-server diagnostics back to the agent — OpenCode-style, but configuration-first and diagnostics-first.

Status: **early implementation** — the CLI generates project LSP configuration; runtime activation and diagnostics are still in development.

## Design (settled)

- **Config**: extension-owned `~/.pi/agent/lsp.json` (global) and `.pi/lsp.json` (project). OpenCode-like server entries (`command`, `extensions`, `env`, `initialization`, `disabled`) plus `languageId` and `rootMarkers` for custom languages and monorepos. Bundled JSON Schema, Draft 2020-12 (`schema/lsp.schema.json`).
- **Activation**: the first successful read/edit/write of a matching file starts the configured server in the background, pooled per server id + project root. Loading configuration starts nothing.
- **Diagnostics**: reads append cached errors with freshness labels — never blocking, never implying "clean". Edit/write get a bounded wait (default 5000 ms); push and pull diagnostics are supported; output is capped (default 10 items / 4000 chars).
- **Boundaries**: the CLI authors configuration; the extension owns activation and feedback. Neither downloads or installs language servers, and builds are never launched automatically. Workspace trust is runtime-owned.

## CLI

The CLI generates LSP configuration only. It does not download, install, or launch language servers, and it never edits Pi package settings directly.

| Command | Usage | Behavior |
| --- | --- | --- |
| `init` | `pi-lsp-onread init [--project <path>] [--languages a,b] [--dry-run] [--yes]` | Interactively selects presets by default; `--languages` selects noninteractively. Manifest and marker matches are hints only and never silently select languages. Shows the plan before writing. `--dry-run` previews without writes; `--yes` approves non-conflicting additions. Conflicts and malformed configs stop without writing. |
| `add` | `pi-lsp-onread add <preset...> [--project <path>] [--dry-run] [--yes]` | Adds the named presets without interactive selection. Shows the plan; `--dry-run` previews without writing. Conflicts and malformed configs stop without writing. |
| `list` | `pi-lsp-onread list` | Lists available language presets and typical commands; guided presets may need toolchain-specific onboarding. |
| `check` | `pi-lsp-onread check [--project <path>]` | Validates the effective configuration and statically searches PATH (and project-relative paths) for enabled server executables. It never runs a server or checks versions. Exit 1 reports configuration errors, missing configuration, or missing executables. |
| `install` | `pi-lsp-onread install [--local] [--dry-run]` | Registers this package through native `pi install npm:pi-lsp-onread`; defaults to personal scope and uses `--local` for project scope. Requires the `pi` CLI on PATH. `--dry-run` prints the command without spawning it. This is self-registration only; it does not install language servers. |

Exit code **0** means success (including a successful dry-run); **1** means an error, conflict, or check finding. The former exit-2 unimplemented-command stubs are gone.

## Development

```sh
pnpm install
pnpm build        # rolldown -> dist/extension.js + dist/cli.js
pnpm test
pnpm lint && pnpm typecheck
```

Try the extension locally:

```sh
pnpm build && pi -e .
```

Try the CLI:

```sh
node dist/cli.js list
```

## Preset catalog note

Commands in `src/presets.ts` are typical ecosystem defaults (`typescript-language-server`, `pyright-langserver`, `gopls`, `rust-analyzer`, `clangd`, `rescript-language-server`, ...). They are configuration templates, not live-verified installs; `guided` presets need toolchain-specific onboarding.

## License

MIT — see [LICENSE](LICENSE).
