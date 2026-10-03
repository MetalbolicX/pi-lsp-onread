import { findExecutable } from "../executables.js";
import { runPi, type PiRunner } from "../pi-runner.js";

interface InstallOptions {
	pathEnv?: string;
	runner?: PiRunner;
}

function parseArgs(argv: readonly string[]): { local: boolean; dryRun: boolean; error?: string } {
	let local = false;
	let dryRun = false;
	for (const argument of argv) {
		if (argument === "--local") local = true;
		else if (argument === "--dry-run") dryRun = true;
		else return { local, dryRun, error: `Unknown install option '${argument}'.` };
	}
	return { local, dryRun };
}

export async function install(argv: readonly string[] = [], options: InstallOptions = {}): Promise<number> {
	const parsed = parseArgs(argv);
	if (parsed.error) {
		console.error(parsed.error);
		console.error("Usage: pi-lsp-onread install [--local] [--dry-run]");
		return 1;
	}

	const executable = await findExecutable("pi", process.cwd(), options.pathEnv);
	if (!executable) {
		console.error("Pi CLI 'pi' was not found on PATH. Install the Pi coding agent CLI, then retry.");
		return 1;
	}

	const args = ["install", "npm:pi-lsp-onread", ...(parsed.local ? ["--local"] : [])];
	if (parsed.dryRun) {
		console.log(["pi", ...args].join(" "));
		return 0;
	}

	try {
		const result = await (options.runner ?? runPi)(args);
		if (result.stdout) console.log(result.stdout);
		if (result.stderr) console.error(result.stderr);
		if (result.code === 0) return 0;
		console.error(`Pi extension install failed${result.code === null ? " (process terminated)" : ` (exit ${result.code})`}.`);
		return 1;
	} catch (error) {
		console.error(`Pi extension install failed: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}
