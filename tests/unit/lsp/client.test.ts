import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProtocolConnection } from "vscode-languageserver-protocol/node";
import { LspClient } from "../../../src/lsp/client.js";
import { spawnServer, type ServerProcess } from "../../../src/lsp/transport.js";

const fixture = fileURLToPath(new URL("../../fixtures/fake-lsp-server.mjs", import.meta.url));
const cwd = join(process.cwd(), "tests");
const timeout = 10_000;
const clients: LspClient[] = [];
const children: ServerProcess[] = [];

function nextDiagnostics(client: LspClient): Promise<Parameters<Parameters<typeof client.onPublishDiagnostics>[0]>[0]> {
	return new Promise((resolve) => {
		const unsubscribe = client.onPublishDiagnostics((event) => {
			unsubscribe();
			resolve(event);
		});
	});
}

async function createClient(env: NodeJS.ProcessEnv = {}, options: Partial<ConstructorParameters<typeof LspClient>[1]> = {}): Promise<LspClient> {
	const spawned = await spawnServer({ command: [process.execPath, fixture], cwd, env });
	expect(spawned.ok).toBe(true);
	if (!spawned.ok) throw new Error(spawned.error.message);
	children.push(spawned.child);
	const client = new LspClient(spawned.child, {
		serverId: "fake",
		rootUri: "file:///workspace/project",
		initializationOptions: { enabled: true },
		settings: { example: true },
		...options,
	});
	clients.push(client);
	return client;
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
	children.splice(0);
});

describe("LSP client", () => {
	it("advertises utf-16 position encoding and exposes the server's negotiated encoding", async () => {
		const client = await createClient({ FAKE_POSITION_ENCODING: "utf-16" });
		expect((await client.ensure()).ok).toBe(true);
		expect(client.positionEncoding()).toBe("utf-16");
	}, timeout);

	it("returns undefined when the server does not reply with a position encoding", async () => {
		const client = await createClient();
		expect((await client.ensure()).ok).toBe(true);
		expect(client.positionEncoding()).toBeUndefined();
	}, timeout);

	it("advertises pull diagnostics and retains server capabilities", async () => {
		const server = `
			let input = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", chunk => {
					input += chunk;
					while (true) {
						const boundary = input.indexOf("\\r\\n\\r\\n");
						if (boundary < 0) return;
						const length = Number(input.slice(0, boundary).match(/Content-Length: (\\d+)/i)?.[1]);
						if (input.length < boundary + 4 + length) return;
						const message = JSON.parse(input.slice(boundary + 4, boundary + 4 + length));
						input = input.slice(boundary + 4 + length);
						if (message.method === "initialize") {
							const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { capabilities: {
								textDocumentSync: 1,
							experimental: {
									receivedDiagnosticCapability: !!message.params.capabilities.textDocument.diagnostic,
									positionEncodings: message.params.capabilities.general?.positionEncodings,
								},
							} } }));
							process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
							process.stdout.write(body);
						} else if (message.method === "shutdown") {
							const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: null }));
							process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
							process.stdout.write(body);
						} else if (message.method === "exit") process.exit(0);
					}
				});
		`;
		const spawned = await spawnServer({ command: [process.execPath, "-e", server], cwd, env: {} });
		expect(spawned.ok).toBe(true);
		if (!spawned.ok) throw new Error(spawned.error.message);
		children.push(spawned.child);
		const client = new LspClient(spawned.child, { serverId: "fake", rootUri: "file:///workspace/project" });
		clients.push(client);

		expect((await client.ensure()).ok).toBe(true);
		expect(client.capabilities()).toEqual({
			textDocumentSync: 1,
			experimental: { receivedDiagnosticCapability: true, positionEncodings: ["utf-16"] },
		});
	}, timeout);

	it("probes the protocol default for an unhandled server request", async () => {
		const client = await createClient({ FAKE_SERVER_REQUESTS: "1" });
		const received = nextDiagnostics(client);
		expect((await client.ensure()).ok).toBe(true);
		const event = await received;
		const message = event.diagnostics[0]?.message;
		const outcomes = JSON.parse(typeof message === "string" ? message.replace(/^error: /, "") : "{}");
		expect(outcomes["custom/unhandledProbe"]).toMatchObject({ error: { code: -32601 } });
	}, timeout);

	it("handles server requests with safe defaults and configured settings", async () => {
		const settings = { example: "configured" };
		const client = await createClient({ FAKE_SERVER_REQUESTS: "1" }, { settings });
		const received = nextDiagnostics(client);
		expect((await client.ensure()).ok).toBe(true);
		// The fixture echoes the request response outcomes in one diagnostics event for deterministic observation.
		const event = await received;
		const message = event.diagnostics[0]?.message;
		const outcomes = JSON.parse(typeof message === "string" ? message.replace(/^error: /, "") : "{}");
		expect(outcomes["custom/unhandledProbe"]).toMatchObject({ error: { code: -32601 } });
		expect(outcomes["window/showMessageRequest"]).toEqual({ result: null });
		expect(outcomes["workspace/applyEdit"].result).toMatchObject({ applied: false, failureReason: expect.any(String) });
		expect(outcomes["client/registerCapability"]).toEqual({ result: null });
		expect(outcomes["client/unregisterCapability"]).toEqual({ result: null });
		expect(outcomes["workspace/configuration"]).toEqual({ result: [settings, settings] });
	}, timeout);

	it("completes initialize and initialized handshake", async () => {
		const client = await createClient();
		const [resultA, resultB] = await Promise.all([client.ensure(), client.ensure()]);
		expect(resultA).toEqual({ ok: true });
		expect(resultB).toEqual({ ok: true });
		expect(client.state).toBe("ready");
	}, timeout);

	it("publishes diagnostics for an opened document", async () => {
		const client = await createClient();
		const received = nextDiagnostics(client);
		expect((await client.ensure()).ok).toBe(true);
		await client.documents.open("file:///workspace/project/a.ts", "typescript", "error: broken\nclean");
		const event = await received;
		expect(event).toMatchObject({ serverId: "fake", uri: "file:///workspace/project/a.ts", version: 1 });
		expect(event.diagnostics).toHaveLength(1);
	}, timeout);

	it("publishes updated diagnostics after didChange and handles delayed publication", async () => {
		const client = await createClient({ FAKE_DELAY_MS: "50" });
		const received = nextDiagnostics(client);
		expect((await client.ensure()).ok).toBe(true);
		await client.documents.open("file:///workspace/project/a.ts", "typescript", "clean");
		const opened = await received;
		expect(opened.version).toBe(1);
		const changed = nextDiagnostics(client);
		await client.documents.change("file:///workspace/project/a.ts", "error: updated");
		const event = await changed;
		expect(event.version).toBe(2);
		expect(event.diagnostics).toHaveLength(1);
	}, timeout);

	it("times out initialize, disposes the child, and clears the cached failure", async () => {
		const client = await createClient({ FAKE_HANG_INITIALIZE: "1" }, { initializeTimeoutMs: 100 });
		const [child] = children;
		if (!child) throw new Error("Expected child process");
		const exited = once(child, "exit");

		const [result, concurrentResult] = await Promise.all([client.ensure(), client.ensure()]);
		expect(result).toMatchObject({ ok: false, error: { kind: "timeout", message: expect.stringContaining("initialize") } });
		expect(concurrentResult).toEqual(result);
		if (!result.ok) expect(result.error.message).toContain("100ms");
		await exited;
		expect(await client.ensure()).toMatchObject({ ok: false, error: { kind: "disposed" } });
		await client.dispose();
	}, timeout);

	it("observes the protocol connection close event on clean exit after readiness", async () => {
		const spawned = await spawnServer({ command: [process.execPath, fixture], cwd, env: { FAKE_EXIT_AFTER_READY: "1" } });
		expect(spawned.ok).toBe(true);
		if (!spawned.ok) throw new Error(spawned.error.message);
		const connection = createProtocolConnection(spawned.child.stdout!, spawned.child.stdin!);
		connection.listen();
		const closed = new Promise<void>((resolve) => connection.onClose(resolve));
		await connection.sendRequest("initialize", { processId: process.pid, rootUri: "file:///workspace/project", capabilities: {} });
		await connection.sendNotification("initialized", {});
		await closed;
		await once(spawned.child, "exit");
		connection.dispose();
		expect(spawned.child.exitCode).toBe(0);
	}, timeout);

	it("probes clean child exit after readiness and reports a connection failure", async () => {
		const client = await createClient({ FAKE_EXIT_AFTER_READY: "1" });
		expect((await client.ensure()).ok).toBe(true);
		const [child] = children;
		if (!child) throw new Error("Expected child process");
		await once(child, "exit");
		expect(client.state).toBe("disposed");
		expect(await client.ensure()).toMatchObject({ ok: false, error: { kind: "connection" } });
	}, timeout);

	it("keeps the connection usable after a request times out", async () => {
		const client = await createClient({ FAKE_HANG_METHOD: "custom/hang" }, { requestTimeoutMs: 100 });
		expect((await client.ensure()).ok).toBe(true);
		const timedOut = await client.request("custom/hang");
		expect(timedOut).toMatchObject({ ok: false, error: { kind: "timeout", message: expect.stringContaining("custom/hang") } });
		if (!timedOut.ok) expect(timedOut.error.message).toContain("100ms");
		expect(await client.request<boolean>("custom/normal")).toEqual({ ok: true, value: true });
	}, timeout);

	it("reports ENOENT as a typed failure", async () => {
		const result = await spawnServer({ command: ["/missing/lsp-binary"], cwd, env: {} });
		expect(result).toMatchObject({ ok: false, error: { kind: "spawn", code: "ENOENT" } });
	}, timeout);

	it("kills the child on dispose and makes double dispose safe", async () => {
		const client = await createClient();
		const [child] = children;
		if (!child) throw new Error("Expected child process");
		expect((await client.ensure()).ok).toBe(true);
		const exited = once(child, "exit");
		await client.dispose();
		await client.dispose();
		await exited;
		expect(client.state).toBe("disposed");
	}, timeout);
});
