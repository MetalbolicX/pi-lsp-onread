import type { EffectiveConfig, MergedConfig } from "./types.js";

export type EffectiveValidationResult =
	| { ok: true; config: EffectiveConfig }
	| { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEffectiveConfig(value: unknown): EffectiveValidationResult {
	const errors: string[] = [];
	if (!isObject(value)) return { ok: false, errors: ["/: merged configuration must be an object"] };
	const rawLsp = value.lsp;
	if (rawLsp !== false && !isObject(rawLsp)) {
		return { ok: false, errors: ["/lsp: merged server map must be an object or false"] };
	}

	if (rawLsp !== false) {
		for (const [id, rawServer] of Object.entries(rawLsp)) {
			const path = `/lsp/${id}`;
			if (!isObject(rawServer)) {
				errors.push(`${path}: server configuration must be an object`);
				continue;
			}
			const { disabled, command, extensions, languageId } = rawServer;
			if (disabled === true) continue;


			if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.length === 0)) {
				errors.push(`${path}/command: enabled server requires a nonempty argv array of nonempty strings; shell command strings are not accepted`);
			}
			if (!Array.isArray(extensions) || extensions.length === 0 || extensions.some((extension) => typeof extension !== "string" || extension.length === 0)) {
				errors.push(`${path}/extensions: enabled server requires a nonempty array of extension strings`);
			}
			if (typeof languageId === "string") {
				if (languageId.length === 0) errors.push(`${path}/languageId: must be a nonempty string`);
			} else if (isObject(languageId)) {
				const extensionSet = new Set(Array.isArray(extensions) ? extensions.filter((entry): entry is string => typeof entry === "string") : []);
				for (const extension of extensionSet) {
					if (!(extension in languageId)) errors.push(`${path}/languageId: missing entry for extension ${extension}`);
				}
				for (const [key, language] of Object.entries(languageId)) {
					if (!extensionSet.has(key)) errors.push(`${path}/languageId: unknown key ${key} is not a configured extension`);
					if (typeof language !== "string") errors.push(`${path}/languageId/${key}: must be a string`);
				}
				if (Object.keys(languageId).length === 0) errors.push(`${path}/languageId: map must not be empty`);
			} else {
				errors.push(`${path}/languageId: enabled server requires a nonempty string or extension map`);
			}
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, config: value as unknown as EffectiveConfig };
}

export function validateMergedConfig(value: MergedConfig | unknown): EffectiveValidationResult {
	return validateEffectiveConfig(value);
}

