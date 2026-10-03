import { stdin, stdout } from "node:process";

let input = "";
const documents = new Map();
const delayMs = Number.parseInt(process.env.FAKE_DELAY_MS ?? "0", 10);

function send(message) {
	const body = Buffer.from(JSON.stringify(message));
	stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	stdout.write(body);
}

function publish(uri, version, text) {
	const diagnostics = text.split("\n").flatMap((line, index) => {
		if (!line.includes("error:")) return [];
		return [{
			range: { start: { line: index, character: 0 }, end: { line: index, character: line.length } },
			severity: 1,
			source: "fake-lsp",
			message: line,
		}];
	});
	const params = { uri, diagnostics };
	if (Number.isInteger(version)) params.version = version;
	send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
}

function handle(message) {
	if (message.method === "initialize") {
		send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
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
	} else if (message.method === "exit") {
		process.exit(0);
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
