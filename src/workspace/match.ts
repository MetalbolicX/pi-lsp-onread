import { extname } from "node:path";
import type { EffectiveConfig, EffectiveServerConfig } from "../config/types.js";

export interface ServerMatch {
	serverId: string;
	languageId: string;
}

function isEnabled(server: EffectiveServerConfig): server is Extract<EffectiveServerConfig, { disabled?: false }> {
	return server.disabled !== true;
}

function normalizeExtension(extension: string): string {
	const withDot = extension.startsWith(".") ? extension : `.${extension}`;
	return withDot.toLowerCase();
}

/** Return enabled servers configured to handle the file's extension. */
export function matchServers(effectiveConfig: EffectiveConfig, absoluteFilePath: string): ServerMatch[] {
	if (effectiveConfig.lsp === false) return [];

	const fileExtension = extname(absoluteFilePath).toLowerCase();
	if (!fileExtension) return [];

	const matches: ServerMatch[] = [];
	for (const [serverId, server] of Object.entries(effectiveConfig.lsp)) {
		if (!isEnabled(server)) continue;
		const extension = server.extensions.find((candidate) => normalizeExtension(candidate) === fileExtension);
		if (extension === undefined) continue;

		const languageId = typeof server.languageId === "string"
			? server.languageId
			: Object.entries(server.languageId).find(([candidate]) => normalizeExtension(candidate) === fileExtension)?.[1];
		if (languageId !== undefined) matches.push({ serverId, languageId });
	}
	return matches;
}
