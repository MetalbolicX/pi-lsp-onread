export type LanguageIdSpec = string | Record<string, string>;

export interface LspPreset {
	/** Stable preset id used by `pi-lsp-onread init --languages`. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** Server argv; executed without a shell. */
	command: string[];
	/** File extensions (leading dot) or whole filenames without an extension (e.g. "Dockerfile"). */
	extensions: string[];
	/** LSP languageId, or a per-extension map for multi-language servers. */
	languageId: LanguageIdSpec;
	/** File/directory names used to detect the nearest project root. */
	rootMarkers?: string[];
	/** True when the server needs toolchain-specific onboarding beyond a plain command. */
	guided?: boolean;
	notes?: string;
}
