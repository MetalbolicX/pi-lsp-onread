import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { buildEffectiveConfig } from "./config/index.js";
import { activate } from "./runtime/activation.js";
import { prewarmServers } from "./runtime/prewarm.js";
import { RuntimeSession } from "./runtime/session.js";
import { createHookBindings } from "./pi/hooks.js";
import { registerLspDiagnosticsTool } from "./pi/lsp-diagnostics-tool.js";
import { registerLspCodeActionsTool } from "./pi/lsp-code-actions-tool.js";
import { registerLspOrganizeImportsTool } from "./pi/lsp-organize-imports-tool.js";
import { registerLspHoverTool } from "./pi/lsp-hover-tool.js";
import { registerLspInlayHintsTool } from "./pi/lsp-inlay-hints-tool.js";
import { registerLspRenameTool } from "./pi/lsp-rename-tool.js";
import { registerLspFormattingTool } from "./pi/lsp-formatting-tool.js";
import { registerLspDefinitionTool, registerLspReferencesTool } from "./pi/lsp-navigation-tools.js";
import { registerLspSymbolsTool } from "./pi/lsp-symbols-tool.js";
import { registerLspWorkspaceSymbolsTool } from "./pi/lsp-workspace-symbols-tool.js";
import { computeScorecard } from "./diagnostics/scorecard.js";
import { matchServers } from "./workspace/match.js";

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
		const editedDocuments = new Map<string, { serverId: string; uri: string }>();
		let scorecardSession: RuntimeSession | undefined;
		const scorecardPi = pi as unknown as {
			appendEntry?: (entry: { customType: string; data: unknown }) => unknown;
			registerEntryRenderer?: (customType: string, renderer: (data: unknown) => unknown) => unknown;
		};
		if (typeof scorecardPi.registerEntryRenderer === "function") {
			scorecardPi.registerEntryRenderer("lsp-scorecard", (data) => JSON.stringify(data));
		}
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
		if (typeof pi.registerTool === "function") registerLspRenameTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspFormattingTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspSymbolsTool(pi, getSession);
		if (typeof pi.registerTool === "function") registerLspWorkspaceSymbolsTool(pi, getSession);
		pi.on("session_start", (_event, ctx) => {
			if (disposed) return;
			void (async () => {
				try {
					const session = await getSession(ctx.cwd);
					if (disposed) return;
					await prewarmServers(session, { canonicalRoot: ctx.cwd, logError });
				} catch (error) {
					logError("pi-lsp-onread: prewarm failed", error);
				}
			})();
		});
		createHookBindings(pi, {
			activate: async (absoluteFilePath, event, projectRoot) => {
				if (disposed) return undefined;
				const cacheKey = `${projectRoot}::${absoluteFilePath}`;
				const performActivation = async () => {
					const session = await getSession(projectRoot);
					if (!disposed && event === "edit" && session.configResult.ok && session.configResult.config.scorecard) {
						scorecardSession = session;
						const uri = pathToFileURL(absoluteFilePath).href;
						for (const { serverId } of matchServers(session.configResult.config, absoluteFilePath)) {
							editedDocuments.set(JSON.stringify([serverId, uri]), { serverId, uri });
						}
					}
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
		pi.on("agent_settled", () => {
			if (disposed || editedDocuments.size === 0) return undefined;
			const documents = [...editedDocuments.values()];
			editedDocuments.clear();
			const session = scorecardSession;
			if (!session?.configResult.ok || !session.configResult.config.scorecard) return undefined;
			const currentVersions = documents.map(({ serverId, uri }) => {
				const client = [...session.pool.entries()].find(([key]) => key.startsWith(`${serverId}::`))?.[1];
				return { serverId, uri, currentVersion: client?.documents.version(uri) };
			});
			const scorecard = computeScorecard({
				store: session.diagnostics,
				documents: currentVersions,
				policy: session.configResult.config.diagnostics,
			});
			if (scorecard.documents.length > 0 && typeof scorecardPi.appendEntry === "function") {
				scorecardPi.appendEntry({ customType: "lsp-scorecard", data: scorecard });
			}
			return undefined;
		});
		pi.on("session_shutdown", () => {
			disposed = true;
			editedDocuments.clear();
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
