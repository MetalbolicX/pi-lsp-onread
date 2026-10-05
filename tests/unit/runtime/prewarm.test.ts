import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { activate } from "../../../src/runtime/activation.js";
import { prewarmServers } from "../../../src/runtime/prewarm.js";
import { createExtension } from "../../../src/extension.js";
import { createProject, fakeConfig, removeProject } from "./runtime-test-helpers.js";

const sessions: RuntimeSession[] = [];
const projects: string[] = [];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});

async function setup(options: { trusted?: boolean; prewarm?: boolean; factory?: (attempt: number) => Promise<{ ok: false; message: string }> | Promise<{ ok: true; client: never }>; cooldown?: number } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const config = fakeConfig();
	if (config.lsp === false || !config.lsp.fake) throw new Error("Expected fake server");
	if (options.prewarm) config.lsp.fake.prewarm = true;
	let attempts = 0;
	const session = await RuntimeSession.create({
		config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath,
		retryCooldownMs: options.cooldown,
		clientFactory: async (factoryOptions) => {
			attempts += 1;
			if (options.factory) return options.factory(attempts);
			const { LspClient } = await import("../../../src/lsp/client.js");
			const { spawnServer } = await import("../../../src/lsp/transport.js");
			const { pathToFileURL } = await import("node:url");
			const spawned = await spawnServer({ command: factoryOptions.server.command!, cwd: project.projectRoot, env: factoryOptions.server.env ?? {} });
			if (!spawned.ok) return { ok: false, message: spawned.error.message };
			return { ok: true, client: new LspClient(spawned.child, { serverId: factoryOptions.serverId, rootUri: pathToFileURL(factoryOptions.root).href, initializeTimeoutMs: 1000 }) };
		},
	});
	sessions.push(session);
	return { ...project, session, calls: () => attempts };
}

describe("runtime prewarm", () => {
	it("does not spawn by default", async () => {
		const { session, projectRoot, calls } = await setup();
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		expect(calls()).toBe(0);
	});

	it("does not spawn for an untrusted root", async () => {
		const { session, projectRoot, calls } = await setup({ trusted: false, prewarm: true });
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		expect(calls()).toBe(0);
	});

	it("starts trusted opted-in servers and coalesces demand activation", async () => {
		const { session, projectRoot, filePath, calls } = await setup({ prewarm: true });
		await Promise.all([
			prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} }),
			activate(session, filePath, "read"),
		]);
		expect(calls()).toBe(1);
		expect(session.pool.size).toBe(1);
	});

	it("accounts a failure once and honors cooldown", async () => {
		let now = 10;
		const { session, projectRoot, calls } = await setup({ prewarm: true, cooldown: 100, factory: async () => ({ ok: false, message: "spawn failed" }) });
		Object.defineProperty(session, "clock", { value: () => now });
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		expect(calls()).toBe(1);
		now += 101;
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		expect(calls()).toBe(2);
	});

	it("is idempotent across repeated invocations", async () => {
		const { session, projectRoot, calls } = await setup({ prewarm: true });
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		await prewarmServers(session, { canonicalRoot: projectRoot, logError: () => {} });
		expect(calls()).toBe(1);
	});

	it("triggers prewarm on session_start using ctx.cwd", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		let attempts = 0;
		const config = fakeConfig();
		if (config.lsp === false || !config.lsp.fake) throw new Error("Expected fake server");
		config.lsp.fake.prewarm = true;
		const session = await RuntimeSession.create({
			config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath,
			clientFactory: async () => { attempts += 1; return { ok: false, message: "spawn failed" }; },
		});
		sessions.push(session);
		const handlers = new Map<string, ((event: unknown, ctx: { cwd: string }) => unknown)[]>();
		createExtension({ createSession: async () => session }).call(undefined, {
			on(event: string, handler: (event: unknown, ctx: { cwd: string }) => unknown) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
				return () => {};
			},
		} as never);
		const handler = handlers.get("session_start")?.[0];
		expect(handler).toBeDefined();
		await handler?.({}, { cwd: project.projectRoot });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(attempts).toBe(1);
	});
});
