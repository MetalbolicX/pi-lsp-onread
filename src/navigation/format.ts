const MAX_ENTRIES = 300;

interface ReadableRange {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

export function formatLocations(locations: unknown[], maxChars: number): string {
	const readable: string[] = [];
	let unreadableCount = 0;

	for (const value of locations) {
		if (!isRecord(value)) {
			unreadableCount++;
			continue;
		}

		const uriValue = "uri" in value ? value.uri : value.targetUri;
		if (typeof uriValue !== "string" || uriValue.length === 0) {
			unreadableCount++;
			continue;
		}

		const isLocationLink = !("uri" in value);
		const range = readableRange(isLocationLink ? value.targetSelectionRange : value.range);
		const path = formatPath(uriValue);
		readable.push(range
			? `${path}:${range.startLine + 1}:${range.startCharacter + 1}-${range.endLine + 1}:${range.endCharacter + 1}`
			: `${path} (range unknown)`);
	}

	const maxEmitted = Math.min(MAX_ENTRIES, readable.length);
	for (let emitted = maxEmitted; emitted >= 0; emitted--) {
		const omittedReadable = readable.length - emitted;
		const lines = readable.slice(0, emitted);
		if (omittedReadable > 0) lines.push(`… ${omittedReadable} locations not shown`);
		if (unreadableCount > 0) lines.push(`… ${unreadableCount} unreadable locations omitted`);
		const output = lines.join("\n");
		if (output.length <= maxChars) return output;
	}
	return "";
}

function formatPath(uri: string): string {
	if (!uri.startsWith("file://")) return uri;
	try {
		return decodeURIComponent(uri.slice("file://".length));
	} catch {
		return uri;
	}
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
