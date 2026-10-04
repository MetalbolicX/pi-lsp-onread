import { createHash } from "node:crypto";
import { stdin, stdout } from "node:process";

let input = "";
const documents = new Map();
const lastResultIds = new Map();
const pullDiagnostics = process.env.FAKE_PULL_DIAGNOSTICS === "1";
const workspaceDiagnostics = process.env.FAKE_WORKSPACE_DIAGNOSTICS === "1";
const documentSymbols = process.env.FAKE_DOCUMENT_SYMBOLS === "1";
const workspaceSymbols = process.env.FAKE_WORKSPACE_SYMBOLS === "1";
const navigation = process.env.FAKE_NAVIGATION === "1";
const delayMs = Number.parseInt(process.env.FAKE_DELAY_MS ?? "0", 10);
const workspaceDelayMs = Number.parseInt(process.env.FAKE_WORKSPACE_DELAY_MS ?? "0", 10);

function send(message) {
	const body = Buffer.from(JSON.stringify(message));
	stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	stdout.write(body);
}

function diagnosticsFor(text) {
	return text.split("\n").flatMap((line, index) => {
		if (!line.includes("error:")) return [];
		return [{
			range: { start: { line: index, character: 0 }, end: { line: index, character: line.length } },
			severity: 1,
			source: "fake-lsp",
			message: line,
		}];
	});
}

function documentSymbolsFor(text) {
	const symbols = [];
	let currentClass;
	for (const [index, line] of text.split("\n").entries()) {
		const trimmed = line.trim();
		const range = { start: { line: index, character: 0 }, end: { line: index, character: line.length } };
		const classMatch = trimmed.match(/class (\w+)/);
		if (classMatch) {
			currentClass = { name: classMatch[1], detail: "class", kind: 5, range, selectionRange: range, children: [] };
			symbols.push(currentClass);
			continue;
		}
		const functionMatch = trimmed.match(/(?:export )?(?:async )?function (\w+)/);
		if (functionMatch) {
			const symbol = { name: functionMatch[1], detail: "function", kind: 12, range, selectionRange: range, children: [] };
			if (currentClass) currentClass.children.push(symbol);
			else symbols.push(symbol);
		}
	}
	return symbols;
}

function publish(uri, version, text) {
	if (process.env.FAKE_SUPPRESS_PUBLISH === "1") return;
	const diagnostics = diagnosticsFor(text);
	const params = { uri, diagnostics };
	if (Number.isInteger(version)) params.version = version;
	send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
}

const pendingServerRequests = new Map();
let nextServerRequestId = 1;
const serverRequestOutcomes = {};

function sendServerRequest(method, params) {
	const id = nextServerRequestId++;
	pendingServerRequests.set(id, method);
	send({ jsonrpc: "2.0", id, method, params });
}

function startServerRequests() {
	sendServerRequest("custom/unhandledProbe", {});
}

function handle(message) {
	if (message.id !== undefined && pendingServerRequests.has(message.id)) {
		const method = pendingServerRequests.get(message.id);
		pendingServerRequests.delete(message.id);
		serverRequestOutcomes[method] = message.error
			? { error: { code: message.error.code, message: message.error.message } }
			: { result: message.result };
		if (method === "custom/unhandledProbe") {
			sendServerRequest("window/showMessageRequest", { type: 3, message: "Choose?", actions: [{ title: "Build" }, { title: "Run" }] });
		} else if (method === "window/showMessageRequest") {
			sendServerRequest("workspace/applyEdit", { edit: { changes: {} } });
		} else if (method === "workspace/applyEdit") {
			sendServerRequest("client/registerCapability", { registrations: [] });
		} else if (method === "client/registerCapability") {
			sendServerRequest("client/unregisterCapability", { unregisterations: [] });
		} else if (method === "client/unregisterCapability") {
			sendServerRequest("workspace/configuration", { items: [{ section: "one" }, { section: "two" }] });
		} else if (method === "workspace/configuration") {
			publish("file:///fake/server-requests", undefined, `error: ${JSON.stringify(serverRequestOutcomes)}`);
		}
	} else if (message.method === "initialize") {
		if (process.env.FAKE_HANG_INITIALIZE === "1") return;
		const capabilities = { textDocumentSync: 1 };
		if (pullDiagnostics || workspaceDiagnostics) {
			capabilities.diagnosticProvider = {
				interFileDependencies: false,
				workspaceDiagnostics,
			};
		}
		if (documentSymbols) capabilities.documentSymbolProvider = true;
		if (workspaceSymbols) capabilities.workspaceSymbolProvider = true;
		if (navigation) {
			capabilities.definitionProvider = true;
			capabilities.referencesProvider = true;
		}
		send({ jsonrpc: "2.0", id: message.id, result: { capabilities } });
	} else if (message.method === "initialized") {
		if (process.env.FAKE_SERVER_REQUESTS === "1") startServerRequests();
		if (process.env.FAKE_EXIT_AFTER_READY === "1") setTimeout(() => process.exit(0), 10);
	} else if (message.method === "shutdown") {
		send({ jsonrpc: "2.0", id: message.id, result: null });
	} else if (message.method === "textDocument/didOpen") {
		const { uri, version, text } = message.params.textDocument;
		documents.set(uri, { version, text });
		setTimeout(() => publish(uri, version, text), delayMs);
	} else if (message.method === "textDocument/didChange") {
		const { uri, version } = message.params.textDocument;
		const [{ text }] = message.params.contentChanges;
		documents.set(uri, { version, text });
		setTimeout(() => publish(uri, version, text), delayMs);
	} else if (message.method === "textDocument/didClose") {
		documents.delete(message.params.textDocument.uri);
		lastResultIds.delete(message.params.textDocument.uri);
	} else if (message.method === "textDocument/diagnostic" && pullDiagnostics) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const { uri } = message.params.textDocument;
		const { previousResultId } = message.params;
		const text = documents.get(uri)?.text ?? "";
		const resultId = createHash("sha256").update(text).digest("hex");
		const unchanged = previousResultId !== undefined
			&& previousResultId === lastResultIds.get(uri)
			&& previousResultId === resultId;
		lastResultIds.set(uri, resultId);
		const result = unchanged
			? { kind: "unchanged", resultId }
			: { kind: "full", resultId, items: diagnosticsFor(text) };
		send({ jsonrpc: "2.0", id: message.id, result });
	} else if (message.method === "textDocument/definition" && navigation) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const { uri, text } = documents.get(message.params.textDocument.uri) ?? {};
		const line = message.params.position?.line;
		if (text === undefined || !Number.isInteger(line) || line < 0 || line >= text.split("\n").length) {
			send({ jsonrpc: "2.0", id: message.id, result: null });
			return;
		}
		const { position } = message.params;
		const character = Number.isInteger(position.character) && position.character >= 0 ? position.character : 0;
		const point = { line, character };
		send({ jsonrpc: "2.0", id: message.id, result: { uri, range: { start: point, end: point } } });
	} else if (message.method === "textDocument/references" && navigation) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const { uri, text } = documents.get(message.params.textDocument.uri) ?? {};
		const line = message.params.position?.line;
		if (text === undefined || !Number.isInteger(line) || line < 0 || line >= text.split("\n").length) {
			send({ jsonrpc: "2.0", id: message.id, result: [] });
			return;
		}
		const lines = text.split("\n");
		const result = lines.map((content, index) => ({
			uri,
			range: { start: { line: index, character: 0 }, end: { line: index, character: content.length } },
		}));
		send({ jsonrpc: "2.0", id: message.id, result });
	} else if (message.method === "textDocument/documentSymbol" && documentSymbols) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const text = documents.get(message.params.textDocument.uri)?.text;
		const result = text === undefined ? [] : documentSymbolsFor(text);
		send({ jsonrpc: "2.0", id: message.id, result });
	} else if (message.method === "workspace/symbol" && workspaceSymbols) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const query = String(message.params?.query ?? "");
		const entries = [...documents.entries()].flatMap(([uri, { text }]) => {
			const flatten = (symbols) => symbols.flatMap((symbol) => [
				{ name: symbol.name, kind: symbol.kind, location: { uri, range: symbol.range } },
				...flatten(symbol.children ?? []),
			]);
			return flatten(documentSymbolsFor(text));
		}).filter(({ name }) => name.toLowerCase().includes(query.toLowerCase()))
			.sort((a, b) => a.name.localeCompare(b.name) || a.location.uri.localeCompare(b.location.uri));
		send({ jsonrpc: "2.0", id: message.id, result: entries });
	} else if (message.method === "workspace/diagnostic" && workspaceDiagnostics) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		const previousResultIds = message.params?.previousResultIds ?? {};
		const items = [...documents.entries()]
			.sort(([uriA], [uriB]) => uriA.localeCompare(uriB))
			.map(([uri, { text }]) => {
				const resultId = createHash("sha256").update(text).digest("hex");
				const previousResultId = previousResultIds[uri];
				lastResultIds.set(uri, resultId);
				return previousResultId === resultId
					? { uri, kind: "unchanged", resultId }
					: { uri, kind: "full", resultId, items: diagnosticsFor(text) };
			});
		setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { items } }), workspaceDelayMs);
	} else if (message.method === "exit") {
		process.exit(0);
	} else if (message.id !== undefined) {
		if (message.method === process.env.FAKE_HANG_METHOD) return;
		send({ jsonrpc: "2.0", id: message.id, result: true });
	}
}

stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
	input += chunk;
	while (true) {
		const boundary = input.indexOf("\r\n\r\n");
		if (boundary < 0) break;
		const header = input.slice(0, boundary);
		const length = Number(header.match(/Content-Length: (\d+)/i)?.[1]);
		if (!Number.isInteger(length) || input.length < boundary + 4 + length) break;
		const body = input.slice(boundary + 4, boundary + 4 + length);
		input = input.slice(boundary + 4 + length);
		handle(JSON.parse(body));
	}
});
