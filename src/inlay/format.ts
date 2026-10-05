/** Format valid inlay hints in source order within hint and character budgets. */
export function formatInlayHints(hints: unknown[], maxChars: number, maxHints = 200): string {
	const readable = hints.flatMap((hint, index) => {
		if (!isRecord(hint) || !isRecord(hint.position)) return [];
		const { line, character } = hint.position;
		if (!isCoordinate(line) || !isCoordinate(character)) return [];
		const label = formatLabel(hint.label);
		if (!label) return [];
		const marker = hint.kind === 1 ? "[type] " : hint.kind === 2 ? "[param] " : "";
		return [{ index, line, character, text: `L${line + 1}:C${character + 1}  ${marker}${label}` }];
	}).sort((left, right) => left.line - right.line || left.character - right.character || left.index - right.index);
	const capped = readable.slice(0, Math.max(0, maxHints));
	const lines = capped.map(({ text }) => text);
	const dropped = readable.length - capped.length;
	if (dropped > 0) lines.push(`... ${dropped} more hint(s) omitted`);
	return lines.join("\n").slice(0, Math.max(0, maxChars));
}

function formatLabel(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value.map((part) => {
		if (!isRecord(part)) return "";
		if (typeof part.text === "string") return part.text;
		return typeof part.value === "string" ? part.value : "";
	}).join("");
}
function isCoordinate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
