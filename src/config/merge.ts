import type { DiagnosticsConfig, DiagnosticsPolicy, MergedConfig, ServerConfig, SourceConfig } from "./types.js";

export const DEFAULT_DIAGNOSTICS: DiagnosticsPolicy = {
	onRead: "cached",
	onChange: "wait",
	waitMs: 5000,
	severities: ["error"],
	maxItems: 10,
	maxChars: 4000,
};

function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const previous = result[key];
		if (isObject(previous) && isObject(value)) result[key] = mergeObjects(previous, value);
		else result[key] = value;
	}
	return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeLayerServers(
	base: Record<string, ServerConfig>,
	layer: SourceConfig["lsp"],
): Record<string, ServerConfig> {
	if (!layer || typeof layer !== "object") return base;
	const result = { ...base };
	for (const [id, server] of Object.entries(layer)) {
		const previous = result[id] ?? {};
		result[id] = mergeObjects(previous as Record<string, unknown>, server as Record<string, unknown>);
	}
	return result;
}

export type ConfigLayer = Pick<SourceConfig, "lsp" | "diagnostics">;

export function mergeConfig(defaults: ConfigLayer, global: ConfigLayer = {}, project: ConfigLayer = {}): MergedConfig {
	const servers: Record<string, ServerConfig> = {};
	const fromDefaults = mergeLayerServers(servers, defaults.lsp);
	const fromGlobal = mergeLayerServers(fromDefaults, global.lsp);
	const fromProject = mergeLayerServers(fromGlobal, project.lsp);
	const lsp = defaults.lsp === false || global.lsp === false || project.lsp === false ? false : fromProject;

	const diagnostics = mergeObjects(
		mergeObjects({ ...DEFAULT_DIAGNOSTICS }, { ...defaults.diagnostics }),
		mergeObjects({ ...global.diagnostics }, { ...project.diagnostics }),
	) as unknown as DiagnosticsConfig;
	const inheritedPolicy = {
		onRead: diagnostics.onRead,
		onChange: diagnostics.onChange,
		waitMs: diagnostics.waitMs,
		severities: diagnostics.severities,
	};
	const withInheritedDiagnostics = lsp === false ? false : Object.fromEntries(
		Object.entries(lsp).map(([id, server]) => [id, {
			...server,
			diagnostics: { ...inheritedPolicy, ...server.diagnostics },
		}]),
	);

	return { version: 1, lsp: withInheritedDiagnostics, diagnostics };
}
