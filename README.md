# pi-lsp-onread

Pi extension that activates project-configured LSP servers when the agent reads code, and feeds language-server diagnostics back to the agent — OpenCode-style, but configuration-first and diagnostics-first.

Status: **scaffold** — this commit lands the toolchain, extension/CLI entries, preset catalog, and v1 schema. Activation, diagnostics, and CLI generation come next.

## Design (settled)

- **Config**: extension-owned `~/.pi/agent/lsp.json` (global) and `.pi/lsp.json` (project). OpenCode-like server entries (`command`, `extensions`, `env`, `initialization`, `disabled`) plus `languageId` and `rootMarkers` for custom languages and monorepos. Bundled JSON Schema, Draft 2020-12 (`schema/lsp.schema.json`).
- **Activation**: the first successful read/edit/write of a matching file starts the configured server in the background, pooled per server id + project root. Loading configuration starts nothing.
- **Diagnostics**: reads append cached errors with freshness labels — never blocking, never implying "clean". Edit/write get a bounded wait (default 5000 ms); push and pull diagnostics are supported; output is capped (default 10 items / 4000 chars).
- **Boundaries**: the CLI authors configuration; the extension owns activation and feedback. Neither downloads or installs language servers, and builds are never launched automatically. Workspace trust is runtime-owned.

## CLI (implemented vs. planned)

| Command | Status |
| --- | --- |
| `list` | implemented |
| `init`, `add`, `check`, `install` | planned (scaffold prints a clear notice, exit 2) |

`install` will delegate to `pi install npm:pi-lsp-onread [--local]` (self-registration only, mirroring pi-rules-md). Configuration commands never touch Pi package registrations.

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
