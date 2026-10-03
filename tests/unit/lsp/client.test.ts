import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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

async function createClient(env: NodeJS.ProcessEnv = {}): Promise<LspClient> {
	const spawned = await spawnServer({ command: [process.execPath, fixture], cwd, env });
	expect(spawned.ok).toBe(true);
	if (!spawned.ok) throw new Error(spawned.error.message);
	children.push(spawned.child);
	const client = new LspClient(spawned.child, {
		serverId: "fake",
		rootUri: "file:///workspace/project",
		initializationOptions: { enabled: true },
		settings: { example: true },
	});
	clients.push(client);
	return client;
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
	children.splice(0);
});

describe("LSP client", () => {
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
