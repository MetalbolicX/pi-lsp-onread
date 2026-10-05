import { resolve, sep } from "node:path";

export type PreviewProblem = { severity: "warn" | "reject"; message: string };

export type ValidationOk = {
	verdict: "ok";
	warnings: string[];
	files: Array<{ uri: string; path: string; edits: Array<{ startLine: number; startCharacter: number; endLine: number; endCharacter: number; newText: string }> }>;
	ops: Array<{ kind: "create" | "delete" | "rename"; path: string; newPath?: string }>;
};
export type ValidationRejected = { verdict: "rejected"; reasons: string[]; warnings: string[] };
export type ValidationResult = ValidationOk | ValidationRejected;

type Coordinates = { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
type NormalizedEdit = Coordinates & { newText: string };
type UriTarget = { uri: string; path?: string };

export async function validateWorkspaceEdit(
	edit: unknown,
	options: { canonicalRoot: string; readFile: (absPath: string) => Promise<string | undefined>; openVersions?: ReadonlyMap<string, number> },
): Promise<ValidationResult> {
	if (!isRecord(edit)) return { verdict: "rejected", reasons: ["edit is not an object"], warnings: [] };

	const reasons: string[] = [];
	const warnings: string[] = [];
	const files: ValidationOk["files"] = [];
	const ops: ValidationOk["ops"] = [];
	const fileByPath = new Map<string, ValidationOk["files"][number]>();
	const canonicalRoot = resolve(options.canonicalRoot);
	const addTarget = (raw: unknown): UriTarget => {
		if (typeof raw !== "string" || !raw.startsWith("file://")) {
			const value = typeof raw === "string" ? raw : String(raw);
			reasons.push(`invalid file uri: ${value}`);
			return { uri: typeof raw === "string" ? raw : "" };
		}
		let decoded: string;
		try {
			decoded = decodeURIComponent(raw.slice("file://".length));
		} catch {
			reasons.push(`unparseable uri: ${raw}`);
			return { uri: raw };
		}
		const path = resolve(decoded);
		if (path !== canonicalRoot && !path.startsWith(canonicalRoot + sep)) reasons.push(`targets path outside trusted root: ${decoded}`);
		return { uri: raw, path };
	};
	const getFile = (target: UriTarget): ValidationOk["files"][number] | undefined => {
		if (!target.path) return undefined;
		let file = fileByPath.get(target.path);
		if (!file) {
			file = { uri: target.uri, path: target.path, edits: [] };
			fileByPath.set(target.path, file);
			files.push(file);
		}
		return file;
	};
	const addEdits = (target: UriTarget, rawEdits: unknown): void => {
		const file = getFile(target);
		if (!Array.isArray(rawEdits)) {
			if (target.path) reasons.push(`malformed text edit in ${target.path}`);
			return;
		}
		for (const rawEdit of rawEdits) {
			const parsed = parseEdit(rawEdit);
			if (!parsed) {
				if (target.path) reasons.push(`malformed text edit in ${target.path}`);
			} else file?.edits.push(parsed);
		}
	};

	let hasEntries = false;
	if (isRecord(edit.changes)) {
		for (const uri of Object.keys(edit.changes).sort()) {
			hasEntries = true;
			const target = addTarget(uri);
			addEdits(target, edit.changes[uri]);
		}
	}
	if (Array.isArray(edit.documentChanges)) {
		for (const entry of edit.documentChanges) {
			if (!isRecord(entry)) continue;
			if ("kind" in entry) {
				hasEntries = true;
				if (entry.kind !== "create" && entry.kind !== "delete" && entry.kind !== "rename") {
					reasons.push(`unknown resource operation kind: ${String(entry.kind)}`);
					continue;
				}
				if (entry.kind === "rename") {
					if (typeof entry.oldUri !== "string" || typeof entry.newUri !== "string") {
						reasons.push("malformed resource operation");
						continue;
					}
					const oldTarget = addTarget(entry.oldUri);
					const newTarget = addTarget(entry.newUri);
					if (oldTarget.path && newTarget.path) ops.push({ kind: "rename", path: oldTarget.path, newPath: newTarget.path });
				} else {
					if (typeof entry.uri !== "string") {
						reasons.push("malformed resource operation");
						continue;
					}
					const target = addTarget(entry.uri);
					if (target.path) ops.push({ kind: entry.kind, path: target.path });
				}
			} else if (isRecord(entry.textDocument)) {
				hasEntries = true;
				const target = addTarget(entry.textDocument.uri);
				if (typeof entry.textDocument.version === "number" && options.openVersions?.has(target.uri)) {
					const openVersion = options.openVersions.get(target.uri);
					if (openVersion !== entry.textDocument.version) warnings.push(`stale: document version ${openVersion}, edit targets ${entry.textDocument.version}`);
				}
				addEdits(target, entry.edits);
			}
		}
	}
	if (!hasEntries) reasons.push("edit contains no document changes");
	for (const file of files) {
		if (file.edits.length < 2) continue;
		const sorted = [...file.edits].sort((left, right) =>
			comparePosition(left.startLine, left.startCharacter, right.startLine, right.startCharacter)
			|| comparePosition(right.endLine, right.endCharacter, left.endLine, left.endCharacter));
		let furthestEnd: { line: number; character: number } | undefined;
		for (const item of sorted) {
			if (furthestEnd && comparePosition(item.startLine, item.startCharacter, furthestEnd.line, furthestEnd.character) < 0) {
				reasons.push(`overlapping text edits in ${file.path}`);
				break;
			}
			if (!furthestEnd || comparePosition(item.endLine, item.endCharacter, furthestEnd.line, furthestEnd.character) > 0) {
				furthestEnd = { line: item.endLine, character: item.endCharacter };
			}
		}
	}
	if (reasons.length > 0) return { verdict: "rejected", reasons, warnings: [] };

	const pathsWithEdits = new Set<string>();
	for (const file of files) if (file.edits.length > 0) pathsWithEdits.add(file.path);
	for (const filePath of pathsWithEdits) {
		const content = await options.readFile(filePath);
		if (content === undefined) {
			warnings.push(`current content unavailable for ${filePath}; ranges unverified`);
			continue;
		}
		const lines = content.split("\n");
		if (files.find((file) => file.path === filePath)?.edits.some((item) =>
			item.startLine >= lines.length || item.endLine >= lines.length ||
			item.startCharacter > (lines[item.startLine]?.replace(/\r$/, "").length ?? 0) ||
			item.endCharacter > (lines[item.endLine]?.replace(/\r$/, "").length ?? 0))) warnings.push(`range out of bounds in ${filePath}`);
	}
	return { verdict: "ok", warnings, files, ops };
}

export async function renderWorkspaceEdit(
	result: ValidationResult,
	options: { readFile: (absPath: string) => Promise<string | undefined>; maxChars: number; maxEdits?: number },
): Promise<string> {
	if (result.verdict === "rejected") return "";
	const prefix = [
		...result.warnings.map((message) => `warning: ${message}`),
		...result.ops.map((op) => op.kind === "rename"
			? `resource operation: rename ${op.path} -> ${op.newPath ?? ""}`
			: `resource operation: ${op.kind} ${op.path}`),
	];
	const limit = options.maxEdits ?? 100;
	const files = dedupeFiles(result.files);
	const totalEdits = files.reduce((total, file) => total + file.edits.length, 0);
	let renderedEdits = 0;
	let omitted = Math.max(0, totalEdits - limit);
	const blocks: string[] = [];
	const base = prefix.join("\n");
	if (prefix.length > 0) blocks.push(base);
	let stopped = false;

	for (let index = 0; index < files.length; index++) {
		const file = files.at(index)!;
		const allowance = Math.max(0, limit - renderedEdits);
		const count = Math.min(file.edits.length, allowance);
		const fileLines = [file.path];
		const content = count > 0 ? await options.readFile(file.path) : undefined;
		for (const edit of file.edits.slice(0, count)) {
			fileLines.push(`L${edit.startLine + 1}:${edit.startCharacter + 1}-${edit.endLine + 1}:${edit.endCharacter + 1}`);
			fileLines.push(...oldLines(content, edit).map((line) => `- ${line}`));
			fileLines.push(...newLines(edit.newText).map((line) => `+ ${line}`));
		}
		const block = fileLines.join("\n");
		const candidate = [...blocks, block].join("\n");
		const omissionCount = totalEdits - renderedEdits - count;
		const reserve = omissionCount > 0 ? `… ${omissionCount} more edits not shown` : "";
		const candidateWithReserve = candidate.length + (reserve ? (candidate.length > 0 ? 1 : 0) + reserve.length : 0);
		if (candidateWithReserve > options.maxChars) {
			omitted += totalEdits - renderedEdits - omitted;
			stopped = true;
			break;
		}
		blocks.push(block);
		renderedEdits += count;
		if (count < file.edits.length) {
			stopped = true;
			break;
		}
	}
	if (stopped && omitted === 0) omitted = totalEdits - renderedEdits;
	const output = blocks.join("\n");
	const omission = omitted > 0 ? `… ${omitted} more edits not shown` : "";
	const finalOutput = omission ? `${output}${output ? "\n" : ""}${omission}` : output;
	if (finalOutput.length <= options.maxChars) return finalOutput;
	if (omission.length <= options.maxChars) return omission;
	return "";
}

function oldLines(content: string | undefined, edit: NormalizedEdit): string[] {
	if (edit.startLine === edit.endLine && edit.startCharacter === edit.endCharacter) return [];
	if (content === undefined) return ["(current text unavailable)"];
	const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
	if (edit.startLine >= lines.length || edit.endLine >= lines.length || edit.startCharacter > lines[edit.startLine]!.length || edit.endCharacter > lines[edit.endLine]!.length) return ["(current text unavailable)"];
	const selected = lines.slice(edit.startLine, edit.endLine + 1);
	selected[0] = selected[0]!.slice(edit.startCharacter);
	const lastLine = selected.pop()!;
	selected.push(lastLine.slice(0, edit.endCharacter));
	return selected;
}

function newLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function dedupeFiles(files: ValidationOk["files"]): ValidationOk["files"] {
	const seen = new Set<string>();
	return files.filter((file) => {
		if (seen.has(file.path)) return false;
		seen.add(file.path);
		return true;
	});
}

function parseEdit(value: unknown): NormalizedEdit | undefined {
	if (!isRecord(value) || !isRecord(value.range) || !isRecord(value.range.start) || !isRecord(value.range.end) || typeof value.newText !== "string") return undefined;
	const startLine = value.range.start.line;
	const startCharacter = value.range.start.character;
	const endLine = value.range.end.line;
	const endCharacter = value.range.end.character;
	if (!isCoordinate(startLine) || !isCoordinate(startCharacter) || !isCoordinate(endLine) || !isCoordinate(endCharacter)) return undefined;
	return { startLine, startCharacter, endLine, endCharacter, newText: value.newText };
}

/** Compare zero-based LSP positions lexicographically by line, then character. */
function comparePosition(leftLine: number, leftCharacter: number, rightLine: number, rightCharacter: number): number {
	return leftLine - rightLine || leftCharacter - rightCharacter;
}

function isCoordinate(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
