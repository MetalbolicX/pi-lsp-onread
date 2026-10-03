/**
 * pi-lsp-onread configuration CLI (scaffold).
 *
 * Command families (user-facing contract):
 * - `install` registers this package's Pi extension via the official
 *   `pi install` flow (self-registration; personal or --local scope).
 * - `init` / `add` / `list` / `check` generate and inspect project
 *   `.pi/lsp.json`. They never download, install, or launch LSP servers.
 *
 * The scaffold implements help/version/list; the rest print a clear
 * "not implemented yet" notice and exit 2.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRESETS } from "./presets.js";

function readVersion(): string {
	try {
		const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const pkg = JSON.parse(raw) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function usage(): string {
	return [
		"pi-lsp-onread — project LSP configuration for the Pi coding agent",
		"",
		"Usage:",
		"  pi-lsp-onread init [options]      Create or extend .pi/lsp.json (planned)",
		"  pi-lsp-onread add <preset...>     Add language presets to config (planned)",
		"  pi-lsp-onread list                List available language presets",
		"  pi-lsp-onread check               Validate config and PATH availability (planned)",
		"  pi-lsp-onread install [--local]   Register the Pi extension via pi install (planned)",
		"  pi-lsp-onread --version           Print version",
		"",
		"Options:",
		"  --project <path>   Target another project (default: current directory)",
		"  --dry-run          Preview changes without writing",
		"  --yes              Approve non-conflicting generation non-interactively",
		"  --local            Register in project scope instead of personal scope",
		"",
		"The CLI generates configuration only. It never downloads or installs",
		"language servers and never launches builds.",
	].join("\n");
}

function listPresets(): void {
	console.log("Available language presets:\n");
	const width = Math.max(...PRESETS.map((preset) => preset.id.length));
	for (const preset of PRESETS) {
		const marker = preset.guided ? "*" : " ";
		const cmd = preset.command.join(" ");
		console.log(`  ${preset.id.padEnd(width)}  ${marker} ${preset.label}  [${cmd}]`);
	}
	console.log(
		"\n* guided preset: needs toolchain-specific onboarding; commands shown are typical defaults.",
	);
	console.log("Presets are configuration templates only — nothing is downloaded or installed.");
}

export function main(argv: readonly string[]): number {
	const command = argv[0] ?? "help";
	switch (command) {
		case "help":
		case "--help":
		case "-h":
			console.log(usage());
			return 0;
		case "--version":
		case "-v":
			console.log(readVersion());
			return 0;
		case "list":
			listPresets();
			return 0;
		case "init":
		case "add":
		case "check":
		case "install":
			console.error(`"${command}" is not implemented yet in this scaffold; see the README roadmap.`);
			return 2;
		default:
			console.error(`Unknown command: ${command}\n`);
			console.error(usage());
			return 1;
	}
}

const entryArg = process.argv[1];
if (entryArg) {
	try {
		const entry = realpathSync(entryArg);
		const self = realpathSync(fileURLToPath(import.meta.url));
		if (entry === self) {
			process.exitCode = main(process.argv.slice(2));
		}
	} catch {
		// Entry resolution failed (e.g. unusual symlink setup); fall through so
		// an importing host is never affected.
	}
}
