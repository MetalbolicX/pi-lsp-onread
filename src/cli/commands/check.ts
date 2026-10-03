import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildEffectiveConfig } from "../../config/index.js";
import { findExecutable } from "../executables.js";

interface ParsedArgs {
	projectRoot: string;
	error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let projectRoot = process.cwd();
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--project") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) return { projectRoot, error: "--project requires a path." };
			projectRoot = resolve(value);
			index += 1;
		} else return { projectRoot, error: `Unknown check option '${argument}'.` };
	}
	return { projectRoot };
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function check(argv: readonly string[] = []): Promise<number> {
	const args = parseArgs(argv);
	if (args.error) {
		console.error(args.error);
		return 1;
	}

	const projectPath = join(args.projectRoot, ".pi", "lsp.json");
	const globalPath = join(homedir(), ".pi", "agent", "lsp.json");
	const result = await buildEffectiveConfig({ projectRoot: args.projectRoot });
	if (!result.ok) {
		for (const error of result.errors) console.error(error);
		return 1;
	}
	if (!(await exists(projectPath)) && !(await exists(globalPath))) {
		console.error(`No LSP configuration found at ${projectPath} or ${globalPath}; nothing to check.`);
		return 1;
	}

	let findings = 0;
	if (result.config.lsp === false) {
		console.log("lsp: skipped (disabled)");
	} else {
		for (const [serverId, server] of Object.entries(result.config.lsp)) {
			if (server.disabled === true) {
				console.log(`${serverId}: skipped (disabled)`);
				continue;
			}
			const [command] = server.command;
			if (!command) {
				console.log(`${serverId}: MISSING: (empty command)`);
				findings += 1;
				continue;
			}
			const executable = await findExecutable(command, args.projectRoot);
			if (executable) console.log(`${serverId}: found at ${executable}`);
			else {
				console.log(`${serverId}: MISSING: ${command}`);
				findings += 1;
			}
		}
	}
	console.log(`Check complete: ${findings === 0 ? "no findings" : `${findings} finding(s)`}.`);
	return findings === 0 ? 0 : 1;
}
