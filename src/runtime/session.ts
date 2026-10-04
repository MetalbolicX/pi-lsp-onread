import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EffectiveConfig, EffectiveServerConfig } from "../config/types.js";
import { DiagnosticsStore } from "../diagnostics/store.js";
import { PullState } from "../diagnostics/pull-state.js";
import type { DiagnosticItem, Snapshot } from "../diagnostics/types.js";
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
	readonly pullState = new PullState();
	readonly documentState = new Map<string, { languageId: string; text: string }>();
	readonly pool = new Map<string, LspClient>();
	readonly pendingClients = new Map<string, Promise<ClientFactoryResult>>();
	private readonly pendingSnapshots = new Set<PendingSnapshot>();
	private readonly countedFailureClients = new WeakSet<LspClient>();
	private disposed = false;
	private disposal: Promise<void> | undefined;
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
		if (this.disposed) return Promise.resolve({ ok: false, message: "LSP session is disposed" });
		const retryCooldownMs = options.server.retryCooldownMs ?? this.retryCooldownMs;
		const maxConsecutiveStartFailures = options.server.maxConsecutiveStartFailures ?? this.maxConsecutiveStartFailures;
		const failure = this.failureStates.get(key);
		if (failure?.disabledForSession) {
			return Promise.resolve({ ok: false, message: `server ${options.serverId} disabled for session after ${failure.consecutiveFailures} consecutive start failures` });
		}
		if (failure && failure.consecutiveFailures > 0) {
			const remainingMs = retryCooldownMs - (this.clock() - failure.lastFailedAt);
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
				if (result.ok && this.disposed) {
					await result.client.dispose().catch(() => {});
					return { ok: false, message: "LSP session is disposed" };
				}
				if (result.ok) {
					this.pool.set(key, result.client);
					this.attachDiagnostics(result.client, key, maxConsecutiveStartFailures);
				} else if (!this.disposed) {
					this.recordStartFailure(key, undefined, maxConsecutiveStartFailures);
				}
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!this.disposed) this.recordStartFailure(key, undefined, maxConsecutiveStartFailures);
				return { ok: false, message };
			} finally {
				this.pendingClients.delete(key);
			}
		})();
		this.pendingClients.set(key, creation);
		return creation;
	}

	async recordStartFailure(key: string, client?: LspClient, maxFailures?: number): Promise<void> {
		const serverId = key.slice(0, key.indexOf("::"));
		const configuredLimit = this.configResult.ok && this.configResult.config.lsp !== false
			? this.configResult.config.lsp[serverId]?.maxConsecutiveStartFailures
			: undefined;
		const failureLimit = maxFailures ?? configuredLimit ?? this.maxConsecutiveStartFailures;
		if (!client || !this.countedFailureClients.has(client)) {
			if (client) this.countedFailureClients.add(client);
			const state = this.failureStates.get(key) ?? { consecutiveFailures: 0, lastFailedAt: 0, disabledForSession: false };
			state.consecutiveFailures += 1;
			state.lastFailedAt = this.clock();
			state.disabledForSession = state.consecutiveFailures >= failureLimit;
			this.failureStates.set(key, state);
		}
		if (client && this.pool.get(key) === client) {
			this.pool.delete(key);
			await client.dispose().catch(() => {});
		}
	}

	recordStartSuccess(key: string, client?: LspClient): void {
		if (client) this.countedFailureClients.delete(client);
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

	async pullWorkspace(serverId: string, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<"unsupported" | "failed" | "applied"> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			const diagnosticProvider = client?.capabilities()?.diagnosticProvider as { workspaceDiagnostics?: unknown } | undefined;
			if (!client || diagnosticProvider?.workspaceDiagnostics !== true) return "unsupported";
			if (timeoutMs <= 0) return "failed";
			const previousResultIds: Record<string, string> = {};
			for (const snapshot of this.diagnostics.entries()) {
				if (snapshot.serverId !== serverId) continue;
				const resultId = this.pullState.get(serverId, snapshot.uri);
				if (resultId !== undefined) previousResultIds[snapshot.uri] = resultId;
			}
			const response = await client.request<unknown>("workspace/diagnostic", { previousResultIds }, timeoutMs);
			if (!response.ok || !response.value || typeof response.value !== "object") return "failed";
			const { items } = response.value as { items?: unknown };
			if (!Array.isArray(items)) return "failed";
			for (const value of items) {
				if (!value || typeof value !== "object") continue;
				const report = value as { uri?: unknown; kind?: unknown; resultId?: unknown; items?: unknown };
				if (typeof report.uri !== "string" || (report.kind !== "full" && report.kind !== "unchanged")) continue;
				if (report.resultId !== undefined && typeof report.resultId !== "string") continue;
				if (report.items !== undefined && !Array.isArray(report.items)) continue;
				if (report.kind === "unchanged") {
					if (typeof report.resultId !== "string") continue;
					this.pullState.set(serverId, report.uri, report.resultId);
					continue;
				}
				if (!Array.isArray(report.items)) continue;
				if (typeof report.resultId === "string") this.pullState.set(serverId, report.uri, report.resultId);
				this.diagnostics.record({
					serverId,
					uri: report.uri,
					version: client.documents.version(report.uri) ?? null,
					receivedAt: this.clock(),
					items: report.items.map(toDiagnosticItem).filter((item): item is DiagnosticItem => item !== undefined),
				});
			}
			return "applied";
		} catch {
			// Workspace pulls are opportunistic; preserve push-based behavior on failure.
			return "failed";
		}
	}

	changedSince(timestamp: number): { serverId: string; uri: string; receivedAt: number }[] {
		return this.diagnostics.entries()
			.filter((snapshot) => snapshot.receivedAt >= timestamp)
			.map(({ serverId, uri, receivedAt }) => ({ serverId, uri, receivedAt }))
			.sort((a, b) => a.uri.localeCompare(b.uri) || a.serverId.localeCompare(b.serverId));
	}

	async documentSymbols(serverId: string, uri: string, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<{ outcome: "unsupported" | "failed" | "ok"; symbols: unknown[] }> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			if (!client || !client.capabilities()?.documentSymbolProvider) return { outcome: "unsupported", symbols: [] };
			if (timeoutMs <= 0) return { outcome: "failed", symbols: [] };
			const response = await client.request<unknown>("textDocument/documentSymbol", { textDocument: { uri } }, timeoutMs);
			if (!response.ok || !response.value || typeof response.value !== "object") return { outcome: "failed", symbols: [] };
			if (!Array.isArray(response.value)) return { outcome: "failed", symbols: [] };
			return { outcome: "ok", symbols: response.value.slice(0, 1000) };
		} catch {
			return { outcome: "failed", symbols: [] };
		}
	}

	async workspaceSymbols(serverId: string, query: string, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<{ outcome: "unsupported" | "failed" | "ok"; symbols: unknown[] }> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			if (!client || !client.capabilities()?.workspaceSymbolProvider) return { outcome: "unsupported", symbols: [] };
			if (timeoutMs <= 0) return { outcome: "failed", symbols: [] };
			const response = await client.request<unknown>("workspace/symbol", { query }, timeoutMs);
			if (!response.ok || !response.value || typeof response.value !== "object") return { outcome: "failed", symbols: [] };
			if (!Array.isArray(response.value)) return { outcome: "failed", symbols: [] };
			return { outcome: "ok", symbols: response.value.slice(0, 1000) };
		} catch {
			return { outcome: "failed", symbols: [] };
		}
	}

	async definition(serverId: string, uri: string, line: number, character: number, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<{ outcome: "unsupported" | "failed" | "ok"; locations: unknown[] }> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			if (!client || !client.capabilities()?.definitionProvider) return { outcome: "unsupported", locations: [] };
			if (timeoutMs <= 0) return { outcome: "failed", locations: [] };
			const response = await client.request<unknown>("textDocument/definition", {
				textDocument: { uri },
				position: { line, character },
			}, timeoutMs);
			if (!response.ok) return { outcome: "failed", locations: [] };
			if (response.value === null || response.value === undefined) return { outcome: "ok", locations: [] };
			if (Array.isArray(response.value)) return { outcome: "ok", locations: response.value.slice(0, 1000) };
			if (typeof response.value === "object") return { outcome: "ok", locations: [response.value] };
			return { outcome: "failed", locations: [] };
		} catch {
			return { outcome: "failed", locations: [] };
		}
	}

	async references(serverId: string, uri: string, line: number, character: number, includeDeclaration: boolean, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<{ outcome: "unsupported" | "failed" | "ok"; locations: unknown[] }> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			if (!client || !client.capabilities()?.referencesProvider) return { outcome: "unsupported", locations: [] };
			if (timeoutMs <= 0) return { outcome: "failed", locations: [] };
			const response = await client.request<unknown>("textDocument/references", {
				textDocument: { uri },
				position: { line, character },
				context: { includeDeclaration },
			}, timeoutMs);
			if (!response.ok) return { outcome: "failed", locations: [] };
			if (response.value === null || response.value === undefined) return { outcome: "ok", locations: [] };
			if (Array.isArray(response.value)) return { outcome: "ok", locations: response.value.slice(0, 1000) };
			return { outcome: "failed", locations: [] };
		} catch {
			return { outcome: "failed", locations: [] };
		}
	}

	async pullFresh(serverId: string, uri: string, timeoutMs = 10_000, suppliedClient?: LspClient): Promise<"unsupported" | "failed" | "full" | "unchanged"> {
		try {
			const client = suppliedClient ?? [...this.pool.entries()]
				.find(([key]) => key.startsWith(`${serverId}::`))?.[1];
			if (!client || client.capabilities()?.diagnosticProvider === undefined) return "unsupported";
			if (timeoutMs <= 0) return "failed";
			const previousResultId = this.pullState.get(serverId, uri);
			const params = {
				textDocument: { uri },
				...(previousResultId === undefined ? {} : { previousResultId }),
			};
			const response = await client.request<unknown>("textDocument/diagnostic", params, timeoutMs);
			if (!response.ok || !response.value || typeof response.value !== "object") return "failed";
			const report = response.value as { kind?: unknown; resultId?: unknown; items?: unknown };
			if (report.kind !== "full" && report.kind !== "unchanged") return "failed";
			if (report.kind === "unchanged") {
				if (typeof report.resultId !== "string") return "failed";
				this.pullState.set(serverId, uri, report.resultId);
				return "unchanged";
			}
			if (!Array.isArray(report.items)) return "failed";
			if (typeof report.resultId === "string") this.pullState.set(serverId, uri, report.resultId);
			const version = client.documents.version(uri) ?? null;
			this.diagnostics.record({
				serverId,
				uri,
				version,
				receivedAt: this.clock(),
				items: report.items.map(toDiagnosticItem).filter((item): item is DiagnosticItem => item !== undefined),
			});
			return "full";
		} catch {
			// Pulls are opportunistic; preserve the existing push-based behavior on failure.
			return "failed";
		}
	}

	attachDiagnostics(client: LspClient, key?: string, maxFailures = this.maxConsecutiveStartFailures): void {
		if (key && typeof client.onFailure === "function") client.onFailure(() => { void this.recordStartFailure(key, client, maxFailures); });
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

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		this.pendingSnapshots.clear();
		this.disposal = (async () => {
			await Promise.allSettled(this.pendingClients.values());
			const clients = [...this.pool.values()];
			this.pool.clear();
			this.pendingClients.clear();
			await Promise.allSettled(clients.map((client) => client.dispose()));
		})();
		return this.disposal;
	}
}

function toDiagnosticItem(value: unknown): DiagnosticItem | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	const range = item.range as DiagnosticItem["range"] | undefined;
	if (!range || !range.start || !range.end || typeof item.message !== "string") return undefined;
	return {
		range,
		severity: typeof item.severity === "number" ? item.severity : 1,
		...(typeof item.code === "number" || typeof item.code === "string" ? { code: item.code } : {}),
		...(typeof item.source === "string" ? { source: item.source } : {}),
		message: item.message,
	};
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
			initializeTimeoutMs: server.initializeTimeoutMs,
			requestTimeoutMs: server.requestTimeoutMs,
		}),
	};
}

