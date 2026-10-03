export interface DocumentSync {
	sendNotification(method: string, params: Record<string, unknown>): Promise<void>;
}

interface TrackedDocument {
	languageId: string;
	text: string;
	version: number;
}

export class DocumentTracker {
	private readonly documents = new Map<string, TrackedDocument>();

	constructor(private readonly sync: DocumentSync) {}

	version(uri: string): number | undefined {
		return this.documents.get(uri)?.version;
	}

	async open(uri: string, languageId: string, text: string): Promise<void> {
		const document = { languageId, text, version: 1 };
		this.documents.set(uri, document);
		await this.sync.sendNotification("textDocument/didOpen", {
			textDocument: { uri, languageId, version: document.version, text },
		});
	}

	// Full-text synchronization keeps the v1 tracker simple and deterministic.
	async change(uri: string, text: string): Promise<void> {
		const document = this.documents.get(uri);
		if (!document) throw new Error(`Document is not open: ${uri}`);
		document.version += 1;
		document.text = text;
		await this.sync.sendNotification("textDocument/didChange", {
			textDocument: { uri, version: document.version },
			contentChanges: [{ text }],
		});
	}

	async close(uri: string): Promise<void> {
		if (!this.documents.has(uri)) return;
		this.documents.delete(uri);
		await this.sync.sendNotification("textDocument/didClose", { textDocument: { uri } });
	}
}
