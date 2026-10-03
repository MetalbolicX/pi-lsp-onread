import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import schema from "../../schema/lsp.schema.json" with { type: "json" };
import { mergeConfig } from "../config/merge.js";
import { validateSourceConfig } from "../config/schema.js";
import { validateEffectiveConfig } from "../config/validate.js";
import type { ServerConfig, SourceConfig } from "../config/types.js";
import { PRESETS } from "../presets/catalog.js";
import type { LspPreset } from "../presets/types.js";

export type ServerEntryResult =
	| { ok: true; serverId: string; entry: ServerConfig }
	| { ok: false; errors: string[] };

export function buildServerEntry(presetId: string): ServerEntryResult {
	const preset = PRESETS.find((candidate) => candidate.id === presetId);
	if (!preset) {
		return { ok: false, errors: [`Unknown preset '${presetId}'. Valid preset ids: ${PRESETS.map(({ id }) => id).join(", ")}`] };
	}
	return { ok: true, serverId: preset.id, entry: toServerEntry(preset) };
}

function toServerEntry(preset: LspPreset): ServerConfig {
	return {
		command: [...preset.command],
		extensions: [...preset.extensions],
		languageId: typeof preset.languageId === "string" ? preset.languageId : { ...preset.languageId },
		...(preset.rootMarkers ? { rootMarkers: [...preset.rootMarkers] } : {}),
	};
}

export type Addition =
	| { status: "NEW"; serverId: string; entry: ServerConfig }
	| { status: "NOOP"; serverId: string; entry: ServerConfig }
	| { status: "CONFLICT"; serverId: string; existing: ServerConfig; incoming: ServerConfig };

export type AdditionsResult = { ok: true; additions: Addition[] } | { ok: false; errors: string[] };

export function planAdditions(options: { existingSource?: SourceConfig | null; presetIds: string[] }): AdditionsResult {
	const existingServers = options.existingSource?.lsp || {};
	const additions: Addition[] = [];
	for (const presetId of options.presetIds) {
		const built = buildServerEntry(presetId);
		if (!built.ok) return built;
		const existing = existingServers[built.serverId];
		if (existing === undefined) additions.push({ status: "NEW", serverId: built.serverId, entry: built.entry });
		else if (isDeepStrictEqual(existing, built.entry)) additions.push({ status: "NOOP", serverId: built.serverId, entry: built.entry });
		else additions.push({ status: "CONFLICT", serverId: built.serverId, existing, incoming: built.entry });
	}
	return { ok: true, additions };
}

export function buildUpdatedSource(options: { existingSource?: SourceConfig | null; additions: Addition[] }): SourceConfig {
	const existing = options.existingSource ?? { version: 1 as const };
	const existingLsp = existing.lsp || {};
	const newEntries = Object.fromEntries(options.additions
		.filter((addition): addition is Extract<Addition, { status: "NEW" }> => addition.status === "NEW")
		.map(({ serverId, entry }) => [serverId, entry]));
	return { ...existing, lsp: { ...existingLsp, ...newEntries } };
}

export function ensureSchemaCompanion(options: {
	source: SourceConfig;
	existingSource?: SourceConfig | null;
}): { source: SourceConfig; companion?: string } {
	if (options.existingSource || options.source["$schema"]) return { source: options.source };
	return {
		source: { ...options.source, "$schema": "./lsp.schema.json" },
		companion: `${JSON.stringify(schema, null, 2)}\n`,
	};
}

export interface WriteConfigOptions {
	projectRoot: string;
	source: SourceConfig;
	dryRun: boolean;
	existingSource?: SourceConfig | null;
	addedIds?: string[];
	noopIds?: string[];
}

export type WriteConfigResult =
	| { ok: true; path: string; summary: string; source: SourceConfig }
	| { ok: false; errors: string[] };

export async function writeConfig(options: WriteConfigOptions): Promise<WriteConfigResult> {
	const prepared = ensureSchemaCompanion({ source: options.source, existingSource: options.existingSource });
	const shape = validateSourceConfig(prepared.source);
	if (!shape.ok) return { ok: false, errors: shape.errors };

	const effective = validateEffectiveConfig(mergeConfig({}, {}, prepared.source));
	if (!effective.ok) return { ok: false, errors: effective.errors };

	const path = join(options.projectRoot, ".pi", "lsp.json");
	const added = options.addedIds ?? [];
	const noops = options.noopIds ?? [];
	const summary = `Write ${path}; added: ${added.length ? added.join(", ") : "none"}; no-op: ${noops.length ? noops.join(", ") : "none"}.`;
	if (options.dryRun) return { ok: true, path, summary, source: prepared.source };

	try {
		const directory = join(options.projectRoot, ".pi");
		await mkdir(directory, { recursive: true });
		const temporaryPath = join(directory, `.lsp.json.${randomUUID()}.tmp`);
		await writeFile(temporaryPath, `${JSON.stringify(prepared.source, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		await rename(temporaryPath, path);
		if (prepared.companion !== undefined) {
			await writeFile(join(directory, "lsp.schema.json"), prepared.companion, "utf8");
		}
		return { ok: true, path, summary, source: prepared.source };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { ok: false, errors: [`Unable to write configuration at ${path}: ${detail}`] };
	}
}
