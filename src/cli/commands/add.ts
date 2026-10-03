import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateSourceConfig } from "../../config/schema.js";
import type { SourceConfig } from "../../config/types.js";
import { buildUpdatedSource, planAdditions, writeConfig } from "../generate.js";
import { printConflict, printPlan } from "../format.js";

interface ParsedArgs {
	projectRoot: string;
	presetIds: string[];
	dryRun: boolean;
	error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let projectRoot = process.cwd();
	let dryRun = false;
	const presetIds: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === undefined) continue;
		if (argument === "--project") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) return { projectRoot, presetIds, dryRun, error: "--project requires a path." };
			projectRoot = resolve(value);
			index += 1;
		} else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--yes") continue;
		else if (argument.startsWith("--")) return { projectRoot, presetIds, dryRun, error: `Unknown add option '${argument}'.` };
		else presetIds.push(argument);
	}
	return { projectRoot, presetIds, dryRun };
}

async function readExistingConfig(path: string): Promise<{ source?: SourceConfig; error?: string }> {
	try {
		await access(path);
	} catch {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		const validation = validateSourceConfig(parsed);
		if (!validation.ok) return { error: `Malformed configuration at ${path}: ${validation.errors.join("; ")}` };
		return { source: parsed as SourceConfig };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { error: `Malformed configuration at ${path}: ${detail}` };
	}
}

export async function add(argv: readonly string[] = []): Promise<number> {
	const args = parseArgs(argv);
	if (args.error) {
		console.error(args.error);
		return 1;
	}
	if (args.presetIds.length === 0) {
		console.error("Usage: pi-lsp-onread add <preset...> [--project <path>] [--dry-run] [--yes]");
		return 1;
	}

	const configPath = join(args.projectRoot, ".pi", "lsp.json");
	const existing = await readExistingConfig(configPath);
	if (existing.error) {
		console.error(existing.error);
		return 1;
	}
	const plan = planAdditions({ existingSource: existing.source, presetIds: args.presetIds });
	if (!plan.ok) {
		for (const error of plan.errors) console.error(error);
		return 1;
	}
	const conflict = plan.additions.find((addition) => addition.status === "CONFLICT");
	if (conflict?.status === "CONFLICT") {
		printConflict(conflict);
		return 1;
	}
	printPlan(plan.additions, configPath, existing.source !== undefined);
	const skipped = plan.additions.filter((addition) => addition.status === "NOOP").map((addition) => addition.serverId);
	if (skipped.length > 0) console.log(`Skipped (already configured): ${skipped.join(", ")}.`);
	if (args.dryRun) return 0;

	const source = buildUpdatedSource({ existingSource: existing.source, additions: plan.additions });
	const result = await writeConfig({
		projectRoot: args.projectRoot,
		source,
		dryRun: false,
		existingSource: existing.source,
		addedIds: plan.additions.filter((addition) => addition.status === "NEW").map((addition) => addition.serverId),
		noopIds: plan.additions.filter((addition) => addition.status === "NOOP").map((addition) => addition.serverId),
	});
	if (!result.ok) {
		for (const error of result.errors) console.error(error);
		return 1;
	}
	console.log(`Wrote ${result.path}.`);
	if (!existing.source && result.source["$schema"] === "./lsp.schema.json") console.log("Created schema companion at .pi/lsp.schema.json.");
	return 0;
}
