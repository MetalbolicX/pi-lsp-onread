import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable } from "node:stream";
import { validateSourceConfig } from "../../config/schema.js";
import type { SourceConfig } from "../../config/types.js";
import { PRESETS } from "../../presets/catalog.js";
import { detectManifestPresets } from "../manifests.js";
import { buildUpdatedSource, planAdditions, writeConfig } from "../generate.js";
import { printConflict, printPlan } from "../format.js";

interface InitOptions {
	stdin?: Readable & { isTTY?: boolean };
}

interface ParsedArgs {
	projectRoot: string;
	languages?: string[];
	dryRun: boolean;
	yes: boolean;
	error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let projectRoot = process.cwd();
	let languages: string[] | undefined;
	let dryRun = false;
	let yes = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--project" || argument === "--languages") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) return { projectRoot, dryRun, yes, error: `${argument} requires a value.` };
			index += 1;
			if (argument === "--project") projectRoot = resolve(value);
			else languages = value.split(",").map((item) => item.trim()).filter(Boolean);
		} else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--yes") yes = true;
		else return { projectRoot, dryRun, yes, error: `Unknown init option '${argument}'.` };
	}
	return { projectRoot, ...(languages ? { languages } : {}), dryRun, yes };
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

function parseSelection(line: string): string[] | undefined {
	const selections = line.split(",").map((item) => item.trim()).filter(Boolean);
	if (selections.length === 0) return undefined;
	const selected: string[] = [];
	for (const item of selections) {
		const preset = /^\d+$/.test(item) ? PRESETS[Number(item) - 1]?.id : PRESETS.find(({ id }) => id === item)?.id;
		if (!preset) return undefined;
		if (!selected.includes(preset)) selected.push(preset);
	}
	return selected;
}

async function interactiveSelection(projectRoot: string, ask: (prompt: string) => Promise<string>): Promise<string[] | undefined> {
	const suggestions = await detectManifestPresets(projectRoot);
	console.log(`Detected project hints: ${suggestions.length ? suggestions.join(", ") : "none"}.`);
	console.log("Available presets:");
	let previousGroup = "";
	PRESETS.forEach((preset, index) => {
		const group = preset.guided ? "Guided presets" : "Standard presets";
		if (group !== previousGroup) {
			console.log(`${group}:`);
			previousGroup = group;
		}
		console.log(`  ${index + 1}. ${preset.id} — ${preset.label}`);
	});
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const line = await ask("Select comma-separated numbers or preset ids: ");
		const selected = parseSelection(line);
		if (selected) return selected;
		console.error("Invalid selection. Enter valid preset numbers or ids separated by commas.");
	}
	return undefined;
}

async function runInit(argv: readonly string[], options: InitOptions, ask: (prompt: string) => Promise<string>): Promise<number> {
	const args = parseArgs(argv);
	if (args.error) {
		console.error(args.error);
		return 1;
	}
	const stdin = options.stdin ?? process.stdin;
	let presetIds = args.languages;
	if (!presetIds) {
		if (!stdin.isTTY) {
			console.error("Interactive selection requires a TTY; pass --languages a,b for noninteractive use.");
			return 1;
		}
		presetIds = await interactiveSelection(args.projectRoot, ask);
		if (!presetIds) return 1;
	}
	if (presetIds.length === 0) {
		console.error("--languages must include at least one preset id.");
		return 1;
	}

	const configPath = join(args.projectRoot, ".pi", "lsp.json");
	const existing = await readExistingConfig(configPath);
	if (existing.error) {
		console.error(existing.error);
		return 1;
	}
	const plan = planAdditions({ existingSource: existing.source, presetIds });
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
	if (args.dryRun) return 0;
	if (!args.yes) {
		if (!stdin.isTTY) {
			console.error("Confirmation requires a TTY; pass --yes to approve these non-conflicting changes.");
			return 1;
		}
		const answer = await ask("Apply this change? [y/N] ");
		if (!/^y(?:es)?$/i.test(answer.trim())) {
			console.log("No changes written.");
			return 0;
		}
	}
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

export async function init(argv: readonly string[] = [], options: InitOptions = {}): Promise<number> {
	const stdin = options.stdin ?? process.stdin;
	const terminal = stdin.isTTY ? createInterface({ input: stdin, output: process.stdout }) : undefined;
	const ask = (prompt: string): Promise<string> => {
		if (!terminal) return Promise.resolve("");
		return terminal.question(prompt);
	};
	try {
		return await runInit(argv, options, ask);
	} finally {
		terminal?.close();
	}
}
