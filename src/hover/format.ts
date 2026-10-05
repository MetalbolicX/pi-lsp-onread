/** Format LSP hover contents and an optional source range within a character budget. */
export function formatHover(hover: unknown, maxChars: number): string {
	if (!isRecord(hover)) return "";
	const contents = formatContents(hover.contents);
	if (!contents) return "";
	const range = readableRange(hover.range);
	const lines = [contents];
	if (range) lines.push(`range: line ${range.startLine + 1}, character ${range.startCharacter + 1} to line ${range.endLine + 1}, character ${range.endCharacter + 1}`);
	return lines.join("\n").slice(0, Math.max(0, maxChars));
}

function formatContents(value: unknown): string {
	if (Array.isArray(value)) return value.map(formatPart).filter((part): part is string => part !== undefined).join("\n\n");
	return formatPart(value) ?? "";
}

function formatPart(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (!isRecord(value)) return undefined;
	if ((value.kind === "markdown" || value.kind === "plaintext") && typeof value.value === "string") return value.value.trim() || undefined;
	if (typeof value.language === "string" && typeof value.value === "string") return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
	return undefined;
}

function readableRange(value: unknown): { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined {
	if (!isRecord(value) || !isRecord(value.start) || !isRecord(value.end)) return undefined;
	const { line: startLine, character: startCharacter } = value.start;
	const { line: endLine, character: endCharacter } = value.end;
	if (!isCoordinate(startLine) || !isCoordinate(startCharacter) || !isCoordinate(endLine) || !isCoordinate(endCharacter)) return undefined;
	return { startLine, startCharacter, endLine, endCharacter };
}
function isCoordinate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
