import { describe, expect, it } from "vitest";
import { renderWorkspaceEdit, validateWorkspaceEdit } from "../../../src/preview/workspace-edit.js";

const root = "/workspace";
const readFile = async (path: string): Promise<string | undefined> => path === "/workspace/a.txt" ? "old\nsecond line\nlast" : undefined;
const textEdit = (overrides: Record<string, unknown> = {}) => ({
	range: { start: { line: 0, character: 1 }, end: { line: 1, character: 4 } },
	newText: "new",
	...overrides,
});
const textDocumentEdit = (uri = "file:///workspace/a.txt", edits: unknown[] = [textEdit()], version?: number) => ({
	textDocument: { uri, ...(version === undefined ? {} : { version }) },
	edits,
});
const validate = (edit: unknown, options: { canonicalRoot?: string; readFile?: typeof readFile; openVersions?: ReadonlyMap<string, number> } = {}) =>
	validateWorkspaceEdit(edit, { canonicalRoot: options.canonicalRoot ?? root, readFile: options.readFile ?? readFile, ...(options.openVersions ? { openVersions: options.openVersions } : {}) });

describe("validateWorkspaceEdit", () => {
	it("rejects non-objects and edits without document changes", async () => {
		expect(await validate(null)).toMatchObject({ verdict: "rejected", reasons: ["edit is not an object"] });
		expect(await validate({})).toMatchObject({ verdict: "rejected", reasons: ["edit contains no document changes"] });
	});

	it.each(["https://workspace/a", "file://x/%zz"]) ("rejects invalid URI %s", async (uri) => {
		const result = await validate({ changes: { [uri]: [textEdit()] } });
		expect(result.verdict).toBe("rejected");
	});

	it("rejects outside-root targets in changes, TextDocumentEdit, and rename", async () => {
		for (const edit of [
			{ changes: { "file:///outside/a": [textEdit()] } },
			{ documentChanges: [textDocumentEdit("file:///outside/a")] },
			{ documentChanges: [{ kind: "rename", oldUri: "file:///workspace/a", newUri: "file:///outside/b" }] },
		]) expect((await validate(edit)).verdict).toBe("rejected");
	});

	it("collects every malformed text edit and resource operation reason", async () => {
		const result = await validate({
			changes: { "file:///workspace/a.txt": [{ range: { start: { line: 0, character: 0 }, end: { line: 0 } }, newText: "x" }] },
			documentChanges: [{ kind: "rename", newUri: "file:///workspace/b" }, { kind: "mystery" }],
		});
		expect(result).toMatchObject({ verdict: "rejected", reasons: [
			"malformed text edit in /workspace/a.txt", "malformed resource operation", "unknown resource operation kind: mystery",
		] });
	});

	it("accepts decoded changes paths, TextDocumentEdit and resource operations", async () => {
		const changesResult = await validate({ changes: { "file:///workspace/My%20File.txt": [textEdit()] } }, { readFile: async () => "x" });
		expect(changesResult).toMatchObject({ verdict: "ok", files: [{ path: "/workspace/My File.txt" }] });
		const documentResult = await validate({ documentChanges: [textDocumentEdit(), { kind: "create", uri: "file:///workspace/new.txt" }] });
		expect(documentResult).toMatchObject({ verdict: "ok", ops: [{ kind: "create", path: "/workspace/new.txt" }] });
		const combined = await validate({ changes: { "file:///workspace/a.txt": [textEdit()] }, documentChanges: [textDocumentEdit("file:///workspace/other.txt")] });
		expect(combined.verdict).toBe("ok");
	});

	it("reports stale versions, unavailable content, and out-of-bounds ranges", async () => {
		const stale = await validate({ documentChanges: [textDocumentEdit("file:///workspace/a.txt", [textEdit()], 2)] }, { openVersions: new Map([["file:///workspace/a.txt", 3]]) });
		expect(stale).toMatchObject({ verdict: "ok", warnings: ["stale: document version 3, edit targets 2"] });
		const unavailable = await validate({ changes: { "file:///workspace/missing": [textEdit()] } });
		expect(unavailable).toMatchObject({ warnings: ["current content unavailable for /workspace/missing; ranges unverified"] });
		const bounds = await validate({ changes: { "file:///workspace/a.txt": [textEdit({ range: { start: { line: 10, character: 0 }, end: { line: 10, character: 0 } } })] } });
		expect(bounds).toMatchObject({ warnings: ["range out of bounds in /workspace/a.txt"] });
	});

	it("skips bounds reads and warnings when rejected", async () => {
		let reads = 0;
		const result = await validate({ changes: { "file:///workspace/a.txt": [textEdit()], "file:///outside": [textEdit()] } }, { readFile: async () => { reads++; return undefined; } });
		expect(result).toMatchObject({ verdict: "rejected", warnings: [] });
		expect(reads).toBe(0);
	});

	const rangeEdit = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => textEdit({
		range: { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } },
	});

	it.each([
		["same-line intersecting ranges", [rangeEdit(0, 1, 0, 4), rangeEdit(0, 3, 0, 5)]],
		["an insert inside a range", [rangeEdit(0, 1, 0, 4), rangeEdit(0, 2, 0, 2)]],
		["ranges crossing line boundaries", [rangeEdit(0, 3, 1, 2), rangeEdit(1, 1, 1, 3)]],
	])("rejects %s", async (_label, edits) => {
		expect(await validate({ changes: { "file:///workspace/a.txt": edits } })).toMatchObject({
			verdict: "rejected", reasons: ["overlapping text edits in /workspace/a.txt"], warnings: [],
		});
	});

	it("allows adjacent ranges and identical-position insertions", async () => {
		for (const edits of [
			[rangeEdit(0, 1, 0, 3), rangeEdit(0, 3, 0, 5)],
			[rangeEdit(0, 2, 0, 2), rangeEdit(0, 2, 0, 2)],
		]) expect((await validate({ changes: { "file:///workspace/a.txt": edits } })).verdict).toBe("ok");
	});

	it("collects overlap once per offending file and checks versioned document edits", async () => {
		const overlap = [rangeEdit(0, 1, 0, 4), rangeEdit(0, 3, 0, 5)];
		const result = await validate({ changes: {
			"file:///workspace/a.txt": overlap,
			"file:///workspace/other.txt": overlap,
			"file:///workspace/clean.txt": [rangeEdit(0, 1, 0, 2)],
		} });
		expect(result).toMatchObject({ verdict: "rejected", reasons: ["overlapping text edits in /workspace/a.txt", "overlapping text edits in /workspace/other.txt"], warnings: [] });
		const versioned = await validate({ documentChanges: [textDocumentEdit("file:///workspace/a.txt", overlap, 7)] });
		expect(versioned).toMatchObject({ verdict: "rejected", reasons: ["overlapping text edits in /workspace/a.txt"] });
	});
});

describe("renderWorkspaceEdit", () => {
	const render = async (edit: unknown, options: { maxChars?: number; maxEdits?: number; readFile?: typeof readFile } = {}) => {
		const result = await validate(edit, { readFile: options.readFile ?? readFile });
		return renderWorkspaceEdit(result, { readFile: options.readFile ?? readFile, maxChars: options.maxChars ?? 10000, ...(options.maxEdits === undefined ? {} : { maxEdits: options.maxEdits }) });
	};

	it("renders one-based labels and properly sliced old/new lines", async () => {
		expect(await render({ changes: { "file:///workspace/a.txt": [textEdit()] } })).toBe([
			"/workspace/a.txt", "L1:2-2:5", "- ld", "- seco", "+ new",
		].join("\n"));
	});

	it("renders insertions without old lines and drops the trailing newText segment", async () => {
		const output = await render({ changes: { "file:///workspace/a.txt": [
			textEdit({ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "insert\n" }),
		] } });
		expect(output).toContain("+ insert");
		expect(output).not.toContain("+ \n");
		expect(output).not.toContain("- ");
	});

	it("prints warnings and resource operations", async () => {
		const result = await validate({ documentChanges: [textDocumentEdit("file:///workspace/missing", [textEdit()], 2), { kind: "create", uri: "file:///workspace/new" }] }, { openVersions: new Map([["file:///workspace/missing", 3]]) });
		expect(await renderWorkspaceEdit(result, { readFile: async () => undefined, maxChars: 1000 })).toContain([
			"warning: stale: document version 3, edit targets 2",
			"warning: current content unavailable for /workspace/missing; ranges unverified",
			"resource operation: create /workspace/new",
		].join("\n"));
	});

	it("caps edits with the correct omission count", async () => {
		const output = await render({ changes: { "file:///workspace/a.txt": [
			textEdit({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }),
			textEdit({ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } } }),
			textEdit({ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } }),
		] } }, { maxEdits: 1 });
		expect(output).toContain("… 2 more edits not shown");
	});

	it("reserves omission space and never exceeds maxChars", async () => {
		const full = await render({ changes: { "file:///workspace/a.txt": [
			textEdit({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }),
			textEdit({ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } } }),
		] } }, { maxChars: 44 });
		expect(full.length).toBeLessThanOrEqual(44);
		expect(full).toContain("more edits not shown");
	});

	it("returns empty output for rejected results", async () => {
		const result = await validate({ changes: { "file:///outside/a": [textEdit()] } });
		expect(await renderWorkspaceEdit(result, { readFile, maxChars: 1000 })).toBe("");
	});
});
