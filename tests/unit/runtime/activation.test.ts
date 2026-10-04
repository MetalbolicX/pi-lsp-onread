import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { activate } from "../../../src/runtime/activation.js";
import { createProject, fakeConfig, fixtureServer, removeProject } from "./runtime-test-helpers.js";

const sessions: RuntimeSession[] = [];
const projects: string[] = [];
const timeout = 20_000;

async function setup(options: { trusted?: boolean; delayMs?: number; waitMs?: number; command?: string[] } = {}) {
	const project = await createProject(options.trusted ?? true);
	projects.push(project.projectRoot);
	const session = await RuntimeSession.create({ config: fakeConfig(options), projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
	sessions.push(session);
	return { ...project, session };
}

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
	await Promise.all(projects.splice(0).map(removeProject));
});

describe("runtime activation", () => {
	it("starts lazily and returns pending without waiting on reads, then attaches current cached diagnostics", async () => {
		const { filePath, session } = await setup({ delayMs: 1500 });
		const started = Date.now();
		const first = await activate(session, filePath, "read");
		expect(first.kind).toBe("ok");
		if (first.kind !== "ok") throw new Error("Expected activation success");
		expect(first.formatted).toContain("pending — no diagnostics received yet from fake");
		expect(Date.now() - started).toBeLessThan(750);
		await sleep(1700);
		const second = await activate(session, filePath, "read");
		expect(second.kind).toBe("ok");
		if (second.kind !== "ok") throw new Error("Expected activation success");
		expect(second.formatted).toContain("fresh: current");
		expect(second.formatted).toContain("error 1:1 fake-lsp: error: broken source");
	}, timeout);

	it("waits within the edit budget for the current publication", async () => {
		const { filePath, session } = await setup({ delayMs: 0, waitMs: 1000 });
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("fresh: current");
		expect(result.formatted).toContain("waited ");
	}, timeout);

	it("bounds cold initialization by the shared edit budget and labels diagnostics pending", async () => {
		const { filePath, session } = await setup({ waitMs: 250 });
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false) throw new Error("Expected server configuration");
		const server = config.config.lsp.fake;
		if (!server) throw new Error("Expected fake server");
		server.env = { ...server.env, FAKE_HANG_INITIALIZE: "1" };

		const started = Date.now();
		const result = await activate(session, filePath, "edit");
		expect(Date.now() - started).toBeLessThan(1500);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("pending — no diagnostics received yet from fake");
		expect(result.formatted).toContain("wait budget exhausted");
	}, timeout);

	it("shares the edit deadline across a ready server and a cold server", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const config = fakeConfig({ waitMs: 300 });
		if (config.lsp === false) throw new Error("Expected server configuration");
		const ready = config.lsp.fake;
		if (!ready) throw new Error("Expected fake server");
		config.lsp = { ready: { ...ready } };
		const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		await activate(session, project.filePath, "read");
		config.lsp.cold = { ...ready, env: { FAKE_HANG_INITIALIZE: "1" } };

		const started = Date.now();
		const result = await activate(session, project.filePath, "edit");
		expect(Date.now() - started).toBeLessThan(1500);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("ready: fresh: current");
		expect(result.formatted).toContain("pending — no diagnostics received yet from cold");
		expect(result.formatted).toContain("wait budget exhausted");
	}, timeout);

	it("bounds delayed edit feedback and reports stale or pending content", async () => {
		const { filePath, session } = await setup({ delayMs: 8000, waitMs: 500 });
		const started = Date.now();
		const result = await activate(session, filePath, "edit");
		expect(Date.now() - started).toBeLessThan(2500);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toMatch(/pending|stale/);
		expect(result.formatted).toContain("wait budget exhausted");
	}, timeout);

	it("denies untrusted roots without spawning and returns trust guidance verbatim", async () => {
		const { filePath, session } = await setup({ trusted: false });
		const result = await activate(session, filePath, "read");
		expect(result.kind).toBe("untrusted");
		if (result.kind !== "untrusted") throw new Error("Expected untrusted result");
		expect(result.guidance).toContain("trust add");
		expect(session.getServerIds()).toEqual([]);
	}, timeout);

	it("returns no-match for an unsupported extension", async () => {
		const { filePath, session } = await setup();
		expect((await activate(session, filePath.replace(/\.ts$/, ".txt"), "read")).kind).toBe("no-match");
	}, timeout);

	it("returns inactive when LSP is disabled", async () => {
		const { projectRoot, trustStorePath, filePath } = await createProject();
		projects.push(projectRoot);
		const session = await RuntimeSession.create({ config: { ...fakeConfig(), lsp: false }, projectRoot, trustStorePath });
		sessions.push(session);
		expect(await activate(session, filePath, "read")).toMatchObject({ kind: "inactive" });
	}, timeout);

	it("reports spawn errors per server and continues starting other matched servers", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const config = fakeConfig();
		if (config.lsp === false) throw new Error("Expected server configuration");
		const server = config.lsp.fake;
		if (!server) throw new Error("Expected fake server configuration");
		config.lsp = {
			broken: { ...server, command: ["/missing/runtime-fixture"] },
			healthy: { ...server, command: [process.execPath, fixtureServer] },
		};
		const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		const result = await activate(session, project.filePath, "read");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("failed to start broken:");
		expect(session.getServerIds()).toEqual(["healthy"]);
	}, timeout);

	it("disposes pooled fixture children", async () => {
		const { filePath, session } = await setup();
		const result = await activate(session, filePath, "read");
		expect(result.kind).toBe("ok");
		expect(session.getServerIds()).toEqual(["fake"]);
		await session.dispose();
		expect(session.getServerIds()).toEqual([]);
	}, timeout);
});
