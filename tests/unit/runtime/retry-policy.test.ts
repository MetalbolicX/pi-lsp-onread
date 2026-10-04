import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { RuntimeSession, type ClientFactoryResult } from "../../../src/runtime/session.js";
import { activate } from "../../../src/runtime/activation.js";
import { LspClient, type ClientResult } from "../../../src/lsp/client.js";
import { createProject, fakeConfig, fixtureServer, removeProject } from "./runtime-test-helpers.js";

const sessions: RuntimeSession[] = [];
const projects: string[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});

async function setup(factory: (attempt: number) => Promise<ClientFactoryResult>, options: { clock?: () => number; retryCooldownMs?: number; maxConsecutiveStartFailures?: number } = {}) {
	const project = await createProject();
	projects.push(project.projectRoot);
	let attempt = 0;
	const session = await RuntimeSession.create({
		config: fakeConfig(), projectRoot: project.projectRoot, trustStorePath: project.trustStorePath,
		clientFactory: (_factoryOptions) => factory(++attempt),
		...options,
	});
	sessions.push(session);
	return { ...project, session, calls: () => attempt };
}

function fakeClient(ensures: ClientResult[]): LspClient {
	let version: number | undefined;
	const client = {
		ensure: async () => ensures.shift() ?? { ok: true },
		dispose: async () => {},
		onPublishDiagnostics: () => () => {},
		documents: {
			version: () => version,
			open: async () => { version = 1; },
			change: async () => { version = (version ?? 0) + 1; },
		},
	} as unknown as LspClient;
	return client;
}

const failedEnsure: ClientResult = { ok: false, error: { kind: "timeout", message: "initialize timed out after 50ms" } };

describe("session retry policy", () => {
	it("reports a failure, suppresses an immediate retry, then retries after cooldown", async () => {
		let now = 1000;
		const { filePath, session, calls } = await setup(async () => { throw new Error("spawn failure"); }, {
			clock: () => now, retryCooldownMs: 60,
		});
		const first = await activate(session, filePath, "read");
		const second = await activate(session, filePath, "read");
		expect(first.kind === "ok" && first.formatted).toContain("spawn failure");
		expect(second.kind === "ok" && second.formatted).toMatch(/fake.*retry in 60ms/);
		expect(calls()).toBe(1);
		now += 61;
		await activate(session, filePath, "read");
		expect(calls()).toBe(2);
	});

	it("disables a server after three consecutive failures, including after cooldown", async () => {
		let now = 0;
		const { filePath, session, calls } = await setup(async () => ({ ok: false, message: "spawn failure" }), {
			clock: () => now, retryCooldownMs: 10, maxConsecutiveStartFailures: 3,
		});
		for (let failure = 0; failure < 3; failure += 1) {
			await activate(session, filePath, "read");
			now += 11;
		}
		const disabled = await activate(session, filePath, "read");
		expect(disabled.kind === "ok" && disabled.formatted).toContain("fake disabled for session after 3 consecutive start failures");
		expect(calls()).toBe(3);
	});

	it("resets the failure count after successful initialization", async () => {
		let now = 0;
		const clients = [fakeClient([failedEnsure]), fakeClient([{ ok: true }, failedEnsure])];
		const { filePath, session, calls } = await setup(async () => ({ ok: true, client: clients.shift() ?? fakeClient([{ ok: true }]) }), {
			clock: () => now, retryCooldownMs: 1, maxConsecutiveStartFailures: 2,
		});
		await activate(session, filePath, "read");
		now += 2;
		await activate(session, filePath, "read");
		now += 2;
		const laterFailure = await activate(session, filePath, "read");
		expect(laterFailure.kind === "ok" && laterFailure.formatted).toContain("initialize timed out after 50ms");
		expect(calls()).toBe(2);
	});

	it("coalesces concurrent cold activations into one startup and one failure", async () => {
		let now = 100;
		const { filePath, session, calls } = await setup(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			throw new Error("single spawn failure");
		}, { clock: () => now, retryCooldownMs: 60 });
		const [first, second] = await Promise.all([
			activate(session, filePath, "read"),
			activate(session, filePath, "read"),
		]);
		expect(first.kind === "ok" && first.formatted).toContain("single spawn failure");
		expect(second.kind === "ok" && second.formatted).toContain("single spawn failure");
		expect(calls()).toBe(1);
		now += 1;
		const suppressed = await activate(session, filePath, "read");
		expect(suppressed.kind === "ok" && suppressed.formatted).toContain("retry in 59ms");
		expect(calls()).toBe(1);
	});

	it("isolates retry failures by server and canonical root pool key", async () => {
		const { session, calls } = await setup(async () => { throw new Error("isolated spawn failure"); }, { retryCooldownMs: 60_000 });
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false) throw new Error("Expected server configuration");
		const server = config.config.lsp.fake;
		if (!server) throw new Error("Expected fake server configuration");
		const options = (root: string) => ({ serverId: "fake", server, root, projectRoot: session.projectRoot });
		await session.getOrCreateClient(session.getPoolKey("fake", "/root-a"), options("/root-a"));
		await session.getOrCreateClient(session.getPoolKey("fake", "/root-b"), options("/root-b"));
		await session.getOrCreateClient(session.getPoolKey("other", "/root-a"), { ...options("/root-a"), serverId: "other" });
		expect(calls()).toBe(3);
		expect((await session.getOrCreateClient(session.getPoolKey("fake", "/root-a"), options("/root-a"))).ok).toBe(false);
		expect((await session.getOrCreateClient(session.getPoolKey("fake", "/root-b"), options("/root-b"))).ok).toBe(false);
		expect(calls()).toBe(3);
	});

	it("disposes clients that finish creating after shutdown and refuses later activation", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		let finishFactory!: (result: ClientFactoryResult) => void;
		let disposed = 0;
		let attempts = 0;
		const session = await RuntimeSession.create({
			config: fakeConfig(), projectRoot: project.projectRoot, trustStorePath: project.trustStorePath,
			clientFactory: () => {
				attempts += 1;
				return new Promise((resolve) => { finishFactory = resolve; });
			},
		});
		sessions.push(session);
		const activation = activate(session, project.filePath, "read");
		while (!finishFactory) await new Promise((resolve) => setTimeout(resolve, 1));
		const shutdown = session.dispose();
		const client = fakeClient([{ ok: true }]);
		(client as unknown as { dispose: () => Promise<void> }).dispose = async () => { disposed += 1; };
		finishFactory({ ok: true, client });
		await shutdown;
		const result = await activation;
		expect(result.kind === "ok" && result.formatted).toContain("session is disposed");
		expect(session.pool.size).toBe(0);
		expect(disposed).toBe(1);
		await activate(session, project.filePath, "read");
		expect(attempts).toBe(1);
	});

	it("keeps late older diagnostics from replacing the current snapshot", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const session = await RuntimeSession.create({ config: fakeConfig(), projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		let publish!: (event: { serverId: string; uri: string; version: number; diagnostics: [] }) => void;
		const client = {
			onPublishDiagnostics: (listener: typeof publish) => { publish = listener; return () => {}; },
		} as unknown as LspClient;
		session.attachDiagnostics(client);
		publish({ serverId: "fake", uri: "file:///current.ts", version: 2, diagnostics: [] });
		publish({ serverId: "fake", uri: "file:///current.ts", version: 1, diagnostics: [] });
		expect(session.diagnostics.get("fake", "file:///current.ts")?.version).toBe(2);
	});

	it("reports initialize timeout and does not spawn again during cooldown", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		let spawns = 0;
		const session = await RuntimeSession.create({
			config: fakeConfig({ command: [process.execPath, fixtureServer] }),
			projectRoot: project.projectRoot, trustStorePath: project.trustStorePath, retryCooldownMs: 60_000,
			clientFactory: async (options) => {
				spawns += 1;
				const child = spawn(process.execPath, [fixtureServer], { cwd: options.projectRoot, env: { ...process.env, FAKE_HANG_INITIALIZE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
				return { ok: true, client: new LspClient(child, { serverId: options.serverId, rootUri: pathToFileURL(options.root).href, initializeTimeoutMs: 50 }) };
			},
		});
		sessions.push(session);
		const first = await activate(session, project.filePath, "read");
		const second = await activate(session, project.filePath, "read");
		expect(first.kind === "ok" && first.formatted).toContain("initialize timed out after 50ms");
		expect(second.kind === "ok" && second.formatted).toContain("retry in");
		expect(spawns).toBe(1);
	}, 5000);
});
