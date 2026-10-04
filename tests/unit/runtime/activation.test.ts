import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeSession } from "../../../src/runtime/session.js";
import { activate } from "../../../src/runtime/activation.js";
import { createProject, fakeConfig, fixtureServer, removeProject } from "./runtime-test-helpers.js";

const sessions: RuntimeSession[] = [];
const projects: string[] = [];
const timeout = 20_000;

function diagnostic(message: string, line = 0) {
	return { range: { start: { line, character: 0 }, end: { line, character: message.length } }, severity: 1, source: "fake-lsp", message };
}

function recordHistory(session: RuntimeSession, uri: string, serverIds: string[], baselineMessage = "error: old", previousMessage = "error: unchanged") {
	for (const serverId of serverIds) {
		session.diagnostics.record({ serverId, uri, version: 0, receivedAt: 1, items: [diagnostic(baselineMessage)] });
		session.diagnostics.record({ serverId, uri, version: 1, receivedAt: 2, items: [diagnostic(previousMessage)] });
	}
}

async function setup(options: { trusted?: boolean; delayMs?: number; waitMs?: number; command?: string[]; pullDiagnostics?: boolean } = {}) {
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

	it("pulls full diagnostics after the edit wait and renders their delta", async () => {
		const { filePath, session } = await setup({ waitMs: 1000, pullDiagnostics: true });
		const uri = new URL(`file://${filePath}`).href;
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false || !config.config.lsp.fake) throw new Error("Expected fake server configuration");
		config.config.lsp.fake.env = { ...config.config.lsp.fake.env, FAKE_SUPPRESS_PUBLISH: "1" };
		session.diagnostics.record({ serverId: "fake", uri, version: 0, receivedAt: 1, items: [diagnostic("error: baseline")] });
		session.diagnostics.record({ serverId: "fake", uri, version: 1, receivedAt: 2, items: [diagnostic("error: before pull")] });
		await writeFile(filePath, "error: pulled only\\n");
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("error 1:1 fake-lsp: error: pulled only");
		expect(session.pullState.get("fake", uri)).toBeTruthy();
	}, timeout);

	it("does not re-record unchanged pulls and retains the resultId", async () => {
		const { filePath, session } = await setup({ waitMs: 1000, pullDiagnostics: true });
		const uri = new URL(`file://${filePath}`).href;
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false || !config.config.lsp.fake) throw new Error("Expected fake server configuration");
		config.config.lsp.fake.env = { ...config.config.lsp.fake.env, FAKE_SUPPRESS_PUBLISH: "1" };
		session.diagnostics.record({ serverId: "fake", uri, version: 0, receivedAt: 1, items: [diagnostic("error: baseline")] });
		await activate(session, filePath, "edit");
		const afterFull = session.diagnostics.get("fake", uri);
		const baselineAfterFull = session.diagnostics.baseline("fake", uri);
		expect(baselineAfterFull).toBeDefined();
		const resultId = session.pullState.get("fake", uri);
		await session.pullFresh("fake", uri);
		expect(session.diagnostics.get("fake", uri)).toBe(afterFull);
		expect(session.diagnostics.baseline("fake", uri)).toBe(baselineAfterFull);
		expect(session.pullState.get("fake", uri)).toBe(resultId);
	}, timeout);

	it("does not send pulls to servers without diagnosticProvider", async () => {
		const { filePath, session } = await setup({ waitMs: 1000 });
		const uri = new URL(`file://${filePath}`).href;
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		expect(session.pullState.get("fake", uri)).toBeUndefined();
	}, timeout);

	it("surfaces a hanging pull as failed without throwing", async () => {
		const { filePath, session } = await setup({ waitMs: 1000, pullDiagnostics: true });
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false || !config.config.lsp.fake) throw new Error("Expected fake server configuration");
		config.config.lsp.fake.env = { ...config.config.lsp.fake.env, FAKE_HANG_METHOD: "textDocument/diagnostic" };
		const activated = await activate(session, filePath, "read");
		if (activated.kind !== "ok") throw new Error("Expected activation success");
		const client = session.pool.get(session.getPoolKey("fake", session.projectRoot));
		if (!client) throw new Error("Expected pooled fake client");
		expect(await session.pullFresh("fake", new URL(`file://${filePath}`).href, 100, client)).toBe("failed");
	}, timeout);

	it("silently degrades when a pull hangs and stays within the edit deadline", async () => {
		const { filePath, session } = await setup({ waitMs: 250, pullDiagnostics: true });
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false || !config.config.lsp.fake) throw new Error("Expected fake server configuration");
		config.config.lsp.fake.env = { ...config.config.lsp.fake.env, FAKE_HANG_METHOD: "textDocument/diagnostic" };
		const started = Date.now();
		const result = await activate(session, filePath, "edit");
		expect(Date.now() - started).toBeLessThan(1500);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("Diagnostics for broken.ts:");
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

	it("renders newly observed diagnostics and collapses unchanged items against a baseline", async () => {
		const { filePath, session } = await setup({ waitMs: 1000 });
		const uri = new URL(`file://${filePath}`).href;
		session.diagnostics.record({ serverId: "fake", uri, version: 0, receivedAt: 1, items: [diagnostic("error: old"), diagnostic("error: unchanged")] });
		session.diagnostics.record({ serverId: "fake", uri, version: 1, receivedAt: 2, items: [diagnostic("error: unchanged")] });
		await writeFile(filePath, "error: unchanged\nerror: new\n");
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("Delta since previous snapshot: 1 newly observed, 1 resolved, 1 unchanged.");
		expect(result.formatted).toContain("error 2:1 fake-lsp: error: new");
		expect(result.formatted).not.toContain("error: unchanged");
	}, timeout);

	it("keeps legacy edit output when no server has a baseline", async () => {
		const { filePath, session } = await setup({ waitMs: 1000 });
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted.replace(/waited \d+ms/, "waited <duration>ms")).toBe([
			"Diagnostics for broken.ts:",
			"fake: fresh: current",
			"error 1:1 fake-lsp: error: broken source",
			"waited <duration>ms; freshest available attached",
		].join("\n"));
	}, timeout);

	it("merges multiple server deltas in alphabetical server order", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const config = fakeConfig({ waitMs: 1000 });
		if (config.lsp === false || !config.lsp.fake) throw new Error("Expected server config");
		const server = config.lsp.fake;
		config.lsp = { zeta: { ...server }, alpha: { ...server } };
		const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		const uri = new URL(`file://${project.filePath}`).href;
		for (const serverId of ["zeta", "alpha"]) {
			session.diagnostics.record({ serverId, uri, version: 0, receivedAt: 1, items: [diagnostic(`error: baseline ${serverId}`)] });
			session.diagnostics.record({ serverId, uri, version: 1, receivedAt: 2, items: [diagnostic(`error: previous ${serverId}`)] });
		}
		await writeFile(project.filePath, "error: new\n");
		const result = await activate(session, project.filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("Delta since previous snapshot: 2 newly observed, 2 resolved, 0 unchanged.");
		const resolved = result.formatted.split("Resolved since previous snapshot:")[1]?.split("waited ")[0] ?? "";
		expect(resolved.indexOf("baseline alpha")).toBeLessThan(resolved.indexOf("baseline zeta"));
	}, timeout);

	it("renders delta for servers with baselines and full items for first-observation servers", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const config = fakeConfig({ waitMs: 1000 });
		if (config.lsp === false || !config.lsp.fake) throw new Error("Expected server config");
		const server = config.lsp.fake;
		config.lsp = { zeta: { ...server }, alpha: { ...server } };
		const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		const uri = new URL(`file://${project.filePath}`).href;
		session.diagnostics.record({ serverId: "alpha", uri, version: 0, receivedAt: 1, items: [diagnostic("error: old alpha"), diagnostic("error: unchanged alpha")] });
		session.diagnostics.record({ serverId: "alpha", uri, version: 1, receivedAt: 2, items: [diagnostic("error: unchanged alpha")] });
		await writeFile(project.filePath, "error: unchanged alpha\nerror: new\n");
		const result = await activate(session, project.filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("Delta since previous snapshot: 1 newly observed, 1 resolved, 1 unchanged.");
		const newlySection = result.formatted.split("Newly observed since previous snapshot:")[1]?.split("Resolved since previous snapshot:")[0] ?? "";
		expect(newlySection).toContain("error: new");
		expect(result.formatted).toContain("- error: old alpha");
		expect(result.formatted.match(/error: unchanged alpha/g)?.length ?? 0).toBe(1);
		expect(result.formatted.indexOf("error: new")).toBeLessThan(result.formatted.indexOf("waited "));
	}, timeout);

	it("never includes delta wording on reads", async () => {
		const { filePath, session } = await setup();
		const uri = new URL(`file://${filePath}`).href;
		recordHistory(session, uri, ["fake"]);
		const result = await activate(session, filePath, "read");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).not.toContain("Delta since previous snapshot");
	}, timeout);

	it("uses the retained baseline even when it predates the pre-edit snapshot", async () => {
		const { filePath, session } = await setup({ waitMs: 1000 });
		const uri = new URL(`file://${filePath}`).href;
		recordHistory(session, uri, ["fake"], "error: retained baseline", "error: pre-edit snapshot");
		await writeFile(filePath, "error: current\n");
		const result = await activate(session, filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		expect(result.formatted).toContain("Delta since previous snapshot: 1 newly observed, 1 resolved, 0 unchanged.");
		expect(result.formatted).toContain("error: current");
		expect(result.formatted).not.toContain("error: pre-edit snapshot");
	}, timeout);

	it("caps merged newly observed and resolved delta lists", async () => {
		const project = await createProject();
		projects.push(project.projectRoot);
		const config = fakeConfig({ waitMs: 1000 });
		config.diagnostics.maxItems = 1;
		if (config.lsp === false || !config.lsp.fake) throw new Error("Expected server config");
		const server = config.lsp.fake;
		config.lsp = { alpha: { ...server }, beta: { ...server } };
		const session = await RuntimeSession.create({ config, projectRoot: project.projectRoot, trustStorePath: project.trustStorePath });
		sessions.push(session);
		const uri = new URL(`file://${project.filePath}`).href;
		for (const serverId of ["alpha", "beta"]) {
			session.diagnostics.record({ serverId, uri, version: 0, receivedAt: 1, items: [diagnostic(`error: old ${serverId}`)] });
			session.diagnostics.record({ serverId, uri, version: 1, receivedAt: 2, items: [diagnostic(`error: previous ${serverId}`)] });
		}
		await writeFile(project.filePath, "error: first\nerror: second\n");
		const result = await activate(session, project.filePath, "edit");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") throw new Error("Expected activation success");
		const newSection = result.formatted.split("Newly observed since previous snapshot:")[1]?.split("Resolved since previous snapshot:")[0] ?? "";
		expect(newSection.match(/fake-lsp: error: (first|second)/g)).toHaveLength(1);
		const resolvedSection = result.formatted.split("Resolved since previous snapshot:")[1]?.split("waited ")[0] ?? "";
		expect(resolvedSection.match(/^- /gm)).toHaveLength(1);
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

	it("evicts a ready client after clean child exit and reports cooldown honestly", async () => {
		const { filePath, session } = await setup();
		const config = session.configResult;
		if (!config.ok || config.config.lsp === false || !config.config.lsp.fake) throw new Error("Expected fake server configuration");
		config.config.lsp.fake.env = { FAKE_EXIT_AFTER_READY: "1" };
		const first = await activate(session, filePath, "read");
		expect(first.kind).toBe("ok");
		const deadline = Date.now() + 2000;
		while (session.pool.size > 0 && Date.now() < deadline) await sleep(10);
		expect(session.pool.size).toBe(0);
		const next = await activate(session, filePath, "read");
		expect(next.kind === "ok" && next.formatted).toMatch(/failed to start fake: server fake retry in/);
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
