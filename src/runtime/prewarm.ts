import { authorize } from "./authorization.js";
import { canonicalizeRoot } from "./trust-store.js";
import type { ClientFactoryOptions, RuntimeSession } from "./session.js";

export interface PrewarmOptions {
	canonicalRoot: string;
	logError: (message: string, error: unknown) => void;
}

/** Start explicitly opted-in servers without opening documents or delaying the caller. */
export async function prewarmServers(session: RuntimeSession, options: PrewarmOptions): Promise<void> {
	const { configResult, trustResult } = session;
	if (!configResult.ok || configResult.config.lsp === false || !trustResult.ok) return;
	const canonicalRoot = await canonicalizeRoot(options.canonicalRoot);
	const authorization = authorize({ projectRoot: canonicalRoot, trustedRoots: trustResult.store.trustedRoots });
	if (!authorization.allowed) return;

	await Promise.all(Object.entries(configResult.config.lsp).map(async ([serverId, server]) => {
		if (server.disabled === true || server.prewarm !== true) return;
		const poolKey = session.getPoolKey(serverId, canonicalRoot);
		const clientOptions: ClientFactoryOptions = { serverId, server, root: canonicalRoot, projectRoot: session.projectRoot };
		try {
			const created = await session.getOrCreateClient(poolKey, clientOptions);
			if (!created.ok) {
				options.logError(`pi-lsp-onread: prewarm failed for ${serverId}`, created.message);
				return;
			}
			const ensured = await created.client.ensure();
			if (!ensured.ok) {
				await session.recordStartFailure(poolKey, created.client);
				options.logError(`pi-lsp-onread: prewarm failed for ${serverId}`, ensured.error);
				return;
			}
			session.recordStartSuccess(poolKey, created.client);
		} catch (error) {
			options.logError(`pi-lsp-onread: prewarm failed for ${serverId}`, error);
		}
	}));
}
