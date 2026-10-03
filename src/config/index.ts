import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./load.js";
import { mergeConfig } from "./merge.js";
import { validateEffectiveConfig } from "./validate.js";
import type { EffectiveConfig } from "./types.js";

export interface BuildEffectiveConfigOptions {
	projectRoot: string;
	globalPath?: string;
	projectPath?: string;
}

export type BuildEffectiveConfigResult =
	| { ok: true; config: EffectiveConfig }
	| { ok: false; errors: string[] };

export async function buildEffectiveConfig(options: BuildEffectiveConfigOptions): Promise<BuildEffectiveConfigResult> {
	try {
		const globalPath = options.globalPath ?? join(homedir(), ".pi", "agent", "lsp.json");
		const projectPath = options.projectPath ?? join(options.projectRoot, ".pi", "lsp.json");
		const [globalResult, projectResult] = await Promise.all([loadConfig(globalPath), loadConfig(projectPath)]);
		const errors = [globalResult, projectResult]
			.filter((result): result is Extract<typeof result, { status: "error" }> => result.status === "error")
			.flatMap((result) => result.errors);
		if (errors.length > 0) return { ok: false, errors };
		const global = globalResult.status === "loaded" ? globalResult.config : { version: 1 as const };
		const project = projectResult.status === "loaded" ? projectResult.config : { version: 1 as const };
		const merged = mergeConfig({}, global, project);
		const validation = validateEffectiveConfig(merged);
		return validation.ok ? { ok: true, config: validation.config } : validation;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { ok: false, errors: [`Unable to build effective configuration: ${detail}`] };
	}
}

export type { EffectiveConfig } from "./types.js";
