import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { buildEffectiveConfig } from "./config/index.js";
import { activate } from "./runtime/activation.js";
import { RuntimeSession } from "./runtime/session.js";
import { createHookBindings } from "./pi/hooks.js";
import { registerLspDiagnosticsTool } from "./pi/lsp-diagnostics-tool.js";
import { registerLspCodeActionsTool } from "./pi/lsp-code-actions-tool.js";
import { registerLspOrganizeImportsTool } from "./pi/lsp-organize-imports-tool.js";
import { registerLspHoverTool } from "./pi/lsp-hover-tool.js";
import { registerLspInlayHintsTool } from "./pi/lsp-inlay-hints-tool.js";
import { registerLspDefinitionTool, registerLspReferencesTool } from "./pi/lsp-navigation-tools.js";
import { registerLspSymbolsTool } from "./pi/lsp-symbols-tool.js";
import { registerLspWorkspaceSymbolsTool } from "./pi/lsp-workspace-symbols-tool.js";

type SessionFactory = (projectRoot: string) => Promise<RuntimeSession>;

export interface ExtensionOptions {
	createSession?: SessionFactory;
	logError?: (message: string, error: unknown) => void;
}

const defaultSessionFactory: SessionFactory = async (projectRoot) => {
	const config = await buildEffectiveConfig({ projectRoot });
	return RuntimeSession.create({ config, projectRoot });
};

/** Create the Pi extension with an injectable session factory for deterministic tests. */
export function createExtension(options: ExtensionOptions = {}): ExtensionFactory {
	return (pi: ExtensionAPI): void => {
		let sessionPromise: Promise<RuntimeSession> | undefined;
		let disposed = false;
		const cachedResults = new Map<string, string>();
		const getSession = (projectRoot: string): Promise<RuntimeSession> => {
			if (!sessionPromise) sessionPromise = (options.createSession ?? defaultSessionFactory)(projectRoot);
			return sessionPromise;
		};
		const logError = options.logError ?? ((message, error) => console.warn(message, error));
		if (typeof pi.registerTool === "function") registerLspDiagnosticsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspDefinitionTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspReferencesTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspCodeActionsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspOrganizeImportsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspHoverTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspInlayHintsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspSymbolsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspWorkspaceSymbolsTool(pi, getSession);
		createHookBindings(pi, {
			activate: async (absoluteFilePath, event, projectRoot) => {
				if (disposed) return undefined;
				const cacheKey = `${projectRoot}::${absoluteFilePath}`;
				const performActivation = async () => {
					const session = await getSession(projectRoot);
					const result = await activate(session, absoluteFilePath, event);
					if (result.kind === "ok") return result.formatted;
					if (result.kind === "untrusted") return result.guidance;
					if (result.kind === "inactive") return result.reason;
					return undefined;
				};
				if (event === "read") {
					void (async () => {
						try {
							const formatted = await performActivation();
							if (formatted) cachedResults.set(cacheKey, formatted);
						} catch (error) {
							logError("pi-lsp-onread: read activation failed", error);
						}
					})();
					return cachedResults.get(cacheKey);
				}
				try {
					const formatted = await performActivation();
					if (formatted) cachedResults.set(cacheKey, formatted);
					return formatted;
				} catch (error) {
					logError("pi-lsp-onread: activation failed", error);
					return undefined;
				}
			},
			logError,
		});
		pi.on("session_shutdown", () => {
			disposed = true;
			if (sessionPromise) {
				void (async () => {
					try {
						const session = await sessionPromise;
						await session.dispose();
					} catch (error) {
						logError("pi-lsp-onread: session disposal failed", error);
					}
				})();
			}
		});
	};
}

const extension = createExtension();
export default extension;
