import { readFileSync } from "node:fs";
import { add } from "./commands/add.js";
import { check } from "./commands/check.js";
import { init } from "./commands/init.js";
import { install } from "./commands/install.js";
import { list } from "./commands/list.js";

function readVersion(): string {
	try {
		const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
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

export function main(argv: readonly string[]): number {
	const [command = "help"] = argv;
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
			return list();
		case "init":
			return init();
		case "add":
			return add();
		case "check":
			return check();
		case "install":
			return install();
		default:
			console.error(`Unknown command: ${command}\n`);
			console.error(usage());
			return 1;
	}
}
