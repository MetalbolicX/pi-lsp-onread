import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EffectiveConfig } from "../../../src/config/types.js";

export const fixtureServer = fileURLToPath(new URL("../../fixtures/fake-lsp-server.mjs", import.meta.url));

export function fakeConfig(options: { delayMs?: number; waitMs?: number; command?: string[]; pullDiagnostics?: boolean; workspaceDiagnostics?: boolean; documentSymbols?: boolean; workspaceSymbols?: boolean } = {}): EffectiveConfig {
	return {
		version: 1,
		lsp: {
			fake: {
				command: options.command ?? [process.execPath, fixtureServer],
				extensions: [".ts"],
				languageId: "typescript",
				rootMarkers: [],
				disabled: false,
				env: {
					...(options.delayMs === undefined ? {} : { FAKE_DELAY_MS: String(options.delayMs) }),
					...(options.pullDiagnostics ? { FAKE_PULL_DIAGNOSTICS: "1" } : {}),
					...(options.workspaceDiagnostics ? { FAKE_WORKSPACE_DIAGNOSTICS: "1" } : {}),
					...(options.documentSymbols ? { FAKE_DOCUMENT_SYMBOLS: "1" } : {}),
					...(options.workspaceSymbols ? { FAKE_WORKSPACE_SYMBOLS: "1" } : {}),
				},
				diagnostics: { onRead: "cached", onChange: "wait", waitMs: options.waitMs ?? 5000, severities: ["error"] },
			},
		},
		diagnostics: { onRead: "cached", onChange: "wait", waitMs: options.waitMs ?? 5000, severities: ["error"], maxItems: 10, maxChars: 4000 },
	};
}

export async function createProject(trusted = true): Promise<{ projectRoot: string; trustStorePath: string; filePath: string }> {
	const projectRoot = await mkdtemp(join(tmpdir(), "pi-lsp-activation-"));
	const trustStorePath = join(projectRoot, "trust.json");
	await writeFile(trustStorePath, JSON.stringify({ version: 1, trustedRoots: trusted ? [projectRoot] : [] }));
	const filePath = join(projectRoot, "broken.ts");
	await writeFile(filePath, "error: broken source\n");
	return { projectRoot, trustStorePath, filePath };
}

export async function removeProject(projectRoot: string): Promise<void> {
	await rm(projectRoot, { recursive: true, force: true });
}
