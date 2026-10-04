const MAX_ENTRIES = 300;
const MAX_DEPTH = 10;

const KIND_LABELS: readonly string[] = [
	"symbol",
	"file",
	"module",
	"namespace",
	"package",
	"class",
	"method",
	"property",
	"field",
	"constructor",
	"enum",
	"interface",
	"function",
	"variable",
	"constant",
	"string",
	"number",
	"boolean",
	"array",
	"object",
	"key",
	"null",
	"enum-member",
	"struct",
	"event",
	"operator",
	"type-parameter",
];

interface SymbolLine {
	depth: number;
	text: string;
}

export function formatDocumentSymbols(symbols: unknown[], maxChars: number): string {
	const readable: SymbolLine[] = [];
	let unreadableCount = 0;

	const visit = (items: unknown[], depth: number): void => {
		for (const entry of items) {
			if (!isRecord(entry) || typeof entry.name !== "string") {
				unreadableCount++;
			} else {
				readable.push({ depth, text: formatLine(entry, depth) });
			}
			if (isRecord(entry) && Array.isArray(entry.children)) visit(entry.children, depth + 1);
		}
	};
	visit(symbols, 0);

	const eligible = readable.filter((entry) => entry.depth <= MAX_DEPTH);
	const maxEmitted = Math.min(MAX_ENTRIES, eligible.length);
	for (let emitted = maxEmitted; emitted >= 0; emitted--) {
		const omittedReadable = readable.length - emitted;
		const lines = eligible.slice(0, emitted).map((entry) => entry.text);
		if (omittedReadable > 0) lines.push(`… ${omittedReadable} symbol entries not shown`);
		if (unreadableCount > 0) lines.push(`… ${unreadableCount} unreadable symbol entries omitted`);
		const output = lines.join("\n");
		if (output.length <= maxChars) return output;
	}
	return "";
}

function formatLine(entry: Record<string, unknown>, depth: number): string {
	const kind = typeof entry.kind === "number" ? KIND_LABELS[entry.kind] ?? "symbol" : "symbol";
	const range = readableRange(entry.range);
	const location = range
		? ` L${range.startLine + 1}:${range.startCharacter + 1}-${range.endLine + 1}:${range.endCharacter + 1}`
		: " (location unknown)";
	return `${"  ".repeat(depth)}${entry.name as string} [${kind}]${location}`;
}

interface ReadableRange {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

function readableRange(value: unknown): ReadableRange | undefined {
	if (!isRecord(value) || !isRecord(value.start) || !isRecord(value.end)) return undefined;
	const { line: startLine, character: startCharacter } = value.start;
	const { line: endLine, character: endCharacter } = value.end;
	if (!isCoordinate(startLine) || !isCoordinate(startCharacter) || !isCoordinate(endLine) || !isCoordinate(endCharacter)) {
		return undefined;
	}
	return { startLine, startCharacter, endLine, endCharacter };
}

function isCoordinate(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
