export type Severity = "error" | "warning" | "information" | "hint";
export type OnReadPolicy = "cached" | "off";
export type OnChangePolicy = "wait" | "cached" | "off";

export interface DiagnosticsConfig {
	onRead?: OnReadPolicy;
	onChange?: OnChangePolicy;
	waitMs?: number;
	severities?: Severity[];
	maxItems?: number;
	maxChars?: number;
}

export interface ServerDiagnosticsConfig {
	onRead?: OnReadPolicy;
	onChange?: OnChangePolicy;
	waitMs?: number;
	severities?: Severity[];
}

export interface ServerConfig {
	command?: string[];
	extensions?: string[];
	languageId?: string | Record<string, string>;
	rootMarkers?: string[];
	disabled?: boolean;
	env?: Record<string, string>;
	initialization?: Record<string, unknown>;
	settings?: Record<string, unknown>;
	diagnostics?: ServerDiagnosticsConfig;
}

export interface SourceConfig {
	version: 1;
	lsp?: false | Record<string, ServerConfig>;
	diagnostics?: DiagnosticsConfig;
	"$schema"?: string;
}

export interface DiagnosticsPolicy {
	onRead: OnReadPolicy;
	onChange: OnChangePolicy;
	waitMs: number;
	severities: Severity[];
	maxItems: number;
	maxChars: number;
}

export type EffectiveServerConfig =
	| (Omit<ServerConfig, "command" | "extensions" | "languageId" | "diagnostics" | "disabled"> & {
			command: string[];
			extensions: string[];
			languageId: string | Record<string, string>;
			disabled?: false;
			diagnostics: Required<ServerDiagnosticsConfig>;
	  })
	| (ServerConfig & { disabled: true; diagnostics: Required<ServerDiagnosticsConfig> });

export interface EffectiveConfig {
	version: 1;
	lsp: false | Record<string, EffectiveServerConfig>;
	diagnostics: DiagnosticsPolicy;
}

export interface MergedServerConfig extends ServerConfig {}

export interface MergedConfig {
	version: 1;
	lsp: false | Record<string, MergedServerConfig>;
	diagnostics: DiagnosticsConfig;
}
