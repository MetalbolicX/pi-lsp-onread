import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EffectiveConfig, EffectiveServerConfig } from "../config/types.js";
import { DiagnosticsStore } from "../diagnostics/store.js";
import type { Snapshot } from "../diagnostics/types.js";
import { LspClient } from "../lsp/client.js";
import { spawnServer } from "../lsp/transport.js";
import { loadTrustStore, defaultTrustStorePath, type LoadTrustStoreResult } from "./trust-store.js";

export type ConfigResult = { ok: true; config: EffectiveConfig } | { ok: false; errors: string[] };

export interface ClientFactoryOptions {
	serverId: string;
	server: EffectiveServerConfig;
	root: string;
	projectRoot: string;
}

export type ClientFactoryResult = { ok: true; client: LspClient } | { ok: false; message: string };
export type ClientFactory = (options: ClientFactoryOptions) => Promise<ClientFactoryResult>;
export type FsReadFile = (path: string, encoding: "utf8") => Promise<string>;

export const RETRY_COOLDOWN_MS = 60_000;
export const MAX_CONSECUTIVE_START_FAILURES = 3;

export interface RuntimeSessionOptions {
	config: EffectiveConfig | ConfigResult;
	projectRoot: string;
	trustStorePath?: string;
	clientFactory?: ClientFactory;
	fsReadFile?: FsReadFile;
	clock?: () => number;
	retryCooldownMs?: number;
	maxConsecutiveStartFailures?: number;
}

interface StartFailureState {
	consecutiveFailures: number;
	lastFailedAt: number;
	disabledForSession: boolean;
}

interface PendingSnapshot {
	serverId: string;
	uri: string;
	version: number;
	resolve: () => void;
}

export class RuntimeSession {
	readonly configResult: ConfigResult;
	readonly projectRoot: string;
	readonly trustResult: LoadTrustStoreResult;
	readonly diagnostics = new DiagnosticsStore();
	readonly documentState = new Map<string, { languageId: string; text: string }>();
	readonly pool = new Map<string, LspClient>();
	readonly pendingClients = new Map<string, Promise<ClientFactoryResult>>();
	private readonly pendingSnapshots = new Set<PendingSnapshot>();
	private readonly factory: ClientFactory;
	private readonly failureStates = new Map<string, StartFailureState>();
	private readonly retryCooldownMs: number;
	private readonly maxConsecutiveStartFailures: number;
	readonly fsReadFile: FsReadFile;
	readonly clock: () => number;

	private constructor(options: RuntimeSessionOptions, trustResult: LoadTrustStoreResult) {
		this.configResult = isConfigResult(options.config) ? options.config : { ok: true, config: options.config };
		this.projectRoot = resolve(options.projectRoot);
		this.trustResult = trustResult;
		this.factory = options.clientFactory ?? defaultClientFactory;
		this.fsReadFile = options.fsReadFile ?? ((path, encoding) => readFile(path, encoding));
		this.clock = options.clock ?? Date.now;
		this.retryCooldownMs = options.retryCooldownMs ?? RETRY_COOLDOWN_MS;
		this.maxConsecutiveStartFailures = options.maxConsecutiveStartFailures ?? MAX_CONSECUTIVE_START_FAILURES;
	}

	static async create(options: RuntimeSessionOptions): Promise<RuntimeSession> {
		let trustResult: LoadTrustStoreResult;
		try {
			trustResult = await loadTrustStore({ path: options.trustStorePath ?? defaultTrustStorePath() });
		} catch (error) {
			trustResult = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
		}
		return new RuntimeSession(options, trustResult);
	}

	get trustStore() {
		return this.trustResult.ok ? this.trustResult.store : undefined;
	}

	getPoolKey(serverId: string, canonicalRoot: string): string {
		return `${serverId}::${canonicalRoot}`;
	}

	getServerIds(): string[] {
		return [...new Set([...this.pool.keys()].map((key) => key.slice(0, key.indexOf("::"))))];
	}

	getOrCreateClient(key: string, options: ClientFactoryOptions): Promise<ClientFactoryResult> {
		const failure = this.failureStates.get(key);
		if (failure?.disabledForSession) {
			return Promise.resolve({ ok: false, message: `server ${options.serverId} disabled for session after ${failure.consecutiveFailures} consecutive start failures` });
		}
		if (failure && failure.consecutiveFailures > 0) {
			const remainingMs = this.retryCooldownMs - (this.clock() - failure.lastFailedAt);
			if (remainingMs > 0) {
				return Promise.resolve({ ok: false, message: `server ${options.serverId} retry in ${Math.ceil(remainingMs)}ms` });
			}
		}
		const existing = this.pool.get(key);
		if (existing) return Promise.resolve({ ok: true, client: existing });
		const pending = this.pendingClients.get(key);
		if (pending) return pending;
		const creation = (async (): Promise<ClientFactoryResult> => {
			try {
				const result = await this.factory(options);
				if (result.ok) {
					this.pool.set(key, result.client);
					this.attachDiagnostics(result.client);
				} else {
					this.recordStartFailure(key);
				}
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.recordStartFailure(key);
				return { ok: false, message };
			} finally {
				this.pendingClients.delete(key);
			}
		})();
		this.pendingClients.set(key, creation);
		return creation;
	}

	async recordStartFailure(key: string, client?: LspClient): Promise<void> {
		const state = this.failureStates.get(key) ?? { consecutiveFailures: 0, lastFailedAt: 0, disabledForSession: false };
		state.consecutiveFailures += 1;
		state.lastFailedAt = this.clock();
		state.disabledForSession = state.consecutiveFailures >= this.maxConsecutiveStartFailures;
		this.failureStates.set(key, state);
		if (client && this.pool.get(key) === client) {
			this.pool.delete(key);
			await client.dispose().catch(() => {});
		}
	}

	recordStartSuccess(key: string): void {
		const state = this.failureStates.get(key);
		if (state) {
			state.consecutiveFailures = 0;
			state.disabledForSession = false;
		}
	}

	watchPublication(serverId: string, uri: string, version: number): { promise: Promise<void>; cancel: () => void } {
		let resolveWaiter = () => {};
		const promise = new Promise<void>((resolvePromise) => { resolveWaiter = resolvePromise; });
		const waiter = { serverId, uri, version, resolve: resolveWaiter };
		this.pendingSnapshots.add(waiter);
		return { promise, cancel: () => this.pendingSnapshots.delete(waiter) };
	}

	attachDiagnostics(client: LspClient): void {
		client.onPublishDiagnostics((event) => {
			const version = typeof event.version === "number" ? event.version : null;
			const snapshot: Snapshot = {
				serverId: event.serverId,
				uri: event.uri,
				version,
				receivedAt: this.clock(),
				items: event.diagnostics.map(({ range, severity, code, source, message }) => ({
					range,
					severity: severity ?? 1,
					...(typeof code === "number" || typeof code === "string" ? { code } : {}),
					...(source ? { source } : {}),
					message: typeof message === "string" ? message : message.value,
				})),
			};
			this.diagnostics.record(snapshot);
			for (const waiter of this.pendingSnapshots) {
				if (waiter.serverId === event.serverId && waiter.uri === event.uri && version === waiter.version) waiter.resolve();
			}
		});
	}

	async dispose(): Promise<void> {
		const clients = [...this.pool.values()];
		this.pool.clear();
		this.pendingSnapshots.clear();
		await Promise.allSettled(clients.map((client) => client.dispose()));
	}
}

function isConfigResult(value: EffectiveConfig | ConfigResult): value is ConfigResult {
	const { ok } = value as ConfigResult;
	return typeof ok === "boolean";
}

async function defaultClientFactory(options: ClientFactoryOptions): Promise<ClientFactoryResult> {
	const { server } = options;
	const { command } = server;
	if (server.disabled || !command) return { ok: false, message: "server is disabled or has no command" };
	const spawned = await spawnServer({ command, cwd: options.projectRoot, env: server.env ?? {} });
	if (!spawned.ok) return { ok: false, message: spawned.error.message };
	return {
		ok: true,
		client: new LspClient(spawned.child, {
			serverId: options.serverId,
			rootUri: pathToFileURL(options.root).href,
			initializationOptions: server.initialization,
			settings: server.settings,
		}),
	};
}

