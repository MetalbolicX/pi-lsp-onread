# pi-lsp-onread

Pi extension that activates project-configured LSP servers when the agent reads code, and feeds language-server diagnostics back to the agent — OpenCode-style, but configuration-first and diagnostics-first.

Status: **early implementation** — project LSP configuration, runtime activation, and diagnostic feedback are implemented.

## Design (settled)

- **Config**: extension-owned `~/.pi/agent/lsp.json` (global) and `.pi/lsp.json` (project). OpenCode-like server entries (`command`, `extensions`, `env`, `initialization`, `disabled`) plus `languageId` and `rootMarkers` for custom languages and monorepos. Bundled JSON Schema, Draft 2020-12 (`schema/lsp.schema.json`).
- **Activation**: the first successful read/edit/write of a matching file starts the configured server in the background, pooled per server id + project root. Loading configuration starts nothing.
- **Diagnostics**: reads append cached errors with freshness labels — never blocking, never implying "clean". Edit/write get a bounded wait (default 5000 ms); v1 supports push diagnostics only; output is capped (default 10 items / 4000 chars). On edit/write, when a previous snapshot exists for a matched server, feedback reports a delta since that previous snapshot — newly observed diagnostics in full, resolved ones as brief one-liners, and unchanged ones collapsed to a count. Deltas describe observations since the previous snapshot, never causality; servers without a previous snapshot keep the full-list output.
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
| `trust` | `pi-lsp-onread trust [list]` | Lists trusted roots in store order; a missing or empty store prints `No trusted roots.`. |
| `trust add` | `pi-lsp-onread trust add [path]` | Adds the canonical path (default: current directory) to the explicit user-owned allowlist. Re-adding an exact root is a no-write success. |
| `trust remove` | `pi-lsp-onread trust remove [path]` | Removes an exact canonical root (default: current directory); absent roots are an error. |

Trust is a fully noninteractive explicit allowlist: only exact canonical roots are trusted, so trusting a parent does **not** trust nested projects. The store is `~/.pi/agent/lsp.trust.json`; it is user-owned and is never granted by project configuration. Malformed store data names the file and blocks changes rather than resetting it. Trust commands exit **0** on success and **1** on errors.

Exit code **0** means success (including a successful dry-run); **1** means an error, conflict, or check finding. The former exit-2 unimplemented-command stubs are gone.

## Pi extension

The extension listens for successful Pi `read`, `edit`, and `write` tool results. It creates its runtime session lazily on the first matching file result; loading the extension does not start language-server processes. Servers start only for files matched by effective configuration and roots explicitly trusted in `~/.pi/agent/lsp.trust.json` (use `pi-lsp-onread trust add [path]` to authorize an exact canonical project root). Untrusted roots never spawn servers and receive the runtime's trust guidance.

Reads launch activation in the background and immediately attach any cached diagnostics; the current read does not wait for startup or diagnostics, so a later result can benefit from the warm-up. Edit and write results wait according to the effective `diagnostics.waitMs` budget (default 5000 ms) before attaching diagnostics. Feedback includes freshness/pending information and never treats silence as a clean compile. Failed Pi tool results are left untouched. Configuration, activation, or disposal errors are logged and swallowed so diagnostics never break the underlying tool call. Server-initiated requests use safe defaults: build/action prompts are declined, and server edits are never applied automatically. Session resources are disposed on Pi's `session_shutdown` event.

### Per-server lifecycle settings

Each server entry may optionally set `initializeTimeoutMs` (default `15000`), `requestTimeoutMs` (default `10000`), `retryCooldownMs` (default `60000`), and `maxConsecutiveStartFailures` (default `3`). Values are layered per field: project configuration overrides global configuration, and omitted values preserve the defaults. Timeouts and failure thresholds must be positive integers; retry cooldown must be a non-negative integer. Values outside the supported bounds or of an invalid type are rejected with an error naming the server and setting; they are never clamped or coerced.

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
