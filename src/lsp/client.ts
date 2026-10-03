import { createProtocolConnection, type Diagnostic, type PublishDiagnosticsParams } from "vscode-languageserver-protocol/node";
import type { ChildProcess } from "node:child_process";
import { DocumentTracker } from "./documents.js";
import { terminateServer } from "./transport.js";

export type ClientState = "starting" | "ready" | "disposed";

export interface ClientOptions {
	serverId: string;
	rootUri: string;
	initializationOptions?: unknown;
	settings?: unknown;
	initializeTimeoutMs?: number;
	requestTimeoutMs?: number;
}

class TimeoutError extends Error {}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export interface PublishedDiagnostics extends PublishDiagnosticsParams {
	serverId: string;
	diagnostics: Diagnostic[];
}

export type ClientResult<T = void> =
	| { ok: true; value?: T }
	| { ok: false; error: { kind: "connection" | "request" | "disposed" | "timeout"; message: string } };

export class LspClient {
	state: ClientState = "starting";
	readonly documents: DocumentTracker;
	private readonly connection;
	private initialization: Promise<ClientResult> | undefined;
	private failure: Error | undefined;
	private disposal: Promise<void> | undefined;
	private readonly listeners = new Set<(event: PublishedDiagnostics) => void>();

	constructor(private readonly child: ChildProcess, private readonly options: ClientOptions) {
		if (!child.stdout || !child.stdin) throw new Error("LSP child must have piped stdin and stdout");
		this.connection = createProtocolConnection(child.stdout, child.stdin);
		this.connection.onError(([error]) => {
			this.failure = error;
			void this.dispose();
		});
		this.connection.onNotification("textDocument/publishDiagnostics", (params: PublishDiagnosticsParams) => {
			const event: PublishedDiagnostics = { ...params, serverId: this.options.serverId };
			for (const listener of this.listeners) listener(event);
		});
		this.connection.listen();
		this.documents = new DocumentTracker({
			sendNotification: async (method, params) => {
				const result = await this.notify(method, params);
				if (!result.ok) throw new Error(result.error.message);
			},
		});
	}

	onPublishDiagnostics(listener: (event: PublishedDiagnostics) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	ensure(): Promise<ClientResult> {
		if (this.state === "disposed") return Promise.resolve({ ok: false, error: { kind: "disposed", message: "LSP client is disposed" } });
		if (this.state === "ready") return Promise.resolve({ ok: true });
		if (!this.initialization) this.initialization = this.initialize();
		return this.initialization;
	}

	async request<T>(method: string, params?: unknown, timeoutMs = this.options.requestTimeoutMs ?? 10_000): Promise<ClientResult<T>> {
		if (this.state === "disposed") return { ok: false, error: { kind: "disposed", message: "LSP client is disposed" } };
		try {
			const pending = params === undefined
				? this.connection.sendRequest<T>(method)
				: this.connection.sendRequest<T>(method, params);
			const value = await withTimeout(pending, timeoutMs, method);
			return this.failure
				? { ok: false, error: { kind: "connection", message: this.failure.message } }
				: { ok: true, value };
		} catch (error) {
			return {
				ok: false,
				error: {
					kind: error instanceof TimeoutError ? "timeout" : "request",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	async notify(method: string, params?: unknown): Promise<ClientResult> {
		if (this.state === "disposed") return { ok: false, error: { kind: "disposed", message: "LSP client is disposed" } };
		try {
			if (params === undefined) await this.connection.sendNotification(method);
			else await this.connection.sendNotification(method, params);
			return this.failure
				? { ok: false, error: { kind: "connection", message: this.failure.message } }
				: { ok: true };
		} catch (error) {
			return { ok: false, error: { kind: "connection", message: error instanceof Error ? error.message : String(error) } };
		}
	}

	private isDisposed(): boolean {
		return this.state === "disposed";
	}

	private async failedInitialization(result: ClientResult): Promise<ClientResult> {
		await this.dispose();
		this.initialization = undefined;
		return result;
	}

	private async initialize(): Promise<ClientResult> {
		const result = await this.request<{ capabilities?: Record<string, unknown> }>("initialize", {
			processId: process.pid,
			rootUri: this.options.rootUri,
			capabilities: {
				textDocument: { synchronization: { dynamicRegistration: false, willSave: false, didSave: false } },
			},
			initializationOptions: this.options.initializationOptions ?? null,
		}, this.options.initializeTimeoutMs ?? 15_000);
		if (!result.ok) return this.failedInitialization(result);
		if (this.isDisposed()) return this.failedInitialization({ ok: false, error: { kind: "disposed", message: "LSP client is disposed" } });
		const initialized = await this.notify("initialized", {});
		if (!initialized.ok) return this.failedInitialization(initialized);
		if (this.isDisposed()) return this.failedInitialization({ ok: false, error: { kind: "disposed", message: "LSP client is disposed" } });
		if (this.options.settings !== undefined) {
			const settings = await this.notify("workspace/didChangeConfiguration", { settings: this.options.settings });
			if (!settings.ok) return this.failedInitialization(settings);
		}
		if (this.isDisposed()) return this.failedInitialization({ ok: false, error: { kind: "disposed", message: "LSP client is disposed" } });
		if (this.failure) return this.failedInitialization({ ok: false, error: { kind: "connection", message: this.failure.message } });
		this.state = "ready";
		return { ok: true };
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.state = "disposed";
		this.disposal = (async () => {
			try {
				await Promise.race([
					this.connection.sendRequest<null>("shutdown"),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
				]);
			} catch {
				// The transport may already be closed; child termination is still required.
			}
			try {
				await this.connection.sendNotification("exit");
			} catch {
				// Ignore a closed connection while disposing.
			}
			this.connection.dispose();
			await terminateServer(this.child);
		})();
		return this.disposal;
	}
}
