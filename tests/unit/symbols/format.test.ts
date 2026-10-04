import { describe, expect, it } from "vitest";
import { formatDocumentSymbols } from "../../../src/symbols/format.js";

const symbol = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	name,
	...overrides,
});

const unlimited = Number.MAX_SAFE_INTEGER;

describe("formatDocumentSymbols", () => {
	it("flattens nested symbols in pre-order with depth indentation", () => {
		const symbols = [symbol("Parent", { children: [symbol("Child", { children: [symbol("Grandchild")] })] }), symbol("Next")];
		expect(formatDocumentSymbols(symbols, unlimited)).toBe([
			"Parent [symbol] (location unknown)",
			"  Child [symbol] (location unknown)",
			"    Grandchild [symbol] (location unknown)",
			"Next [symbol] (location unknown)",
		].join("\n"));
	});

	it("labels known kinds and uses symbol for unknown kinds", () => {
		expect(formatDocumentSymbols([
			symbol("Widget", { kind: 5 }),
			symbol("run", { kind: 12 }),
			symbol("other", { kind: 99 }),
			symbol("invalid", { kind: 0 }),
			symbol("missing"),
		], unlimited)).toBe([
			"Widget [class] (location unknown)",
			"run [function] (location unknown)",
			"other [symbol] (location unknown)",
			"invalid [symbol] (location unknown)",
			"missing [symbol] (location unknown)",
		].join("\n"));
	});

	it("prints readable ranges using one-based raw coordinates", () => {
		expect(formatDocumentSymbols([symbol("located", {
			range: { start: { line: 0, character: 2 }, end: { line: 4, character: 8 } },
		})], unlimited)).toBe("located [symbol] L1:3-5:9");
	});

	it("marks a missing range as unknown", () => {
		expect(formatDocumentSymbols([symbol("unlocated")], unlimited)).toBe("unlocated [symbol] (location unknown)");
	});

	it("skips and counts malformed entries separately", () => {
		expect(formatDocumentSymbols([null, 3, {}, { name: 4 }, symbol("readable")], unlimited)).toBe([
			"readable [symbol] (location unknown)",
			"… 4 unreadable symbol entries omitted",
		].join("\n"));
	});

	it("truncates after 300 emitted entries and reports the rest", () => {
		const output = formatDocumentSymbols(Array.from({ length: 301 }, (_unused, index) => symbol(`S${index + 1}`)), unlimited).split("\n");
		expect(output).toHaveLength(301);
		expect(output[0]).toBe("S1 [symbol] (location unknown)");
		expect(output[299]).toBe("S300 [symbol] (location unknown)");
		expect(output[300]).toBe("… 1 symbol entries not shown");
	});

	it("omits symbols beyond depth 10 and counts them", () => {
		let nested: Record<string, unknown> = symbol("at-depth-11");
		for (let depth = 10; depth >= 0; depth--) nested = symbol(`at-depth-${depth}`, { children: [nested] });
		const lines = formatDocumentSymbols([nested], unlimited).split("\n");
		expect(lines).toHaveLength(12);
		expect(lines[10]).toBe(`${"  ".repeat(10)}at-depth-10 [symbol] (location unknown)`);
		expect(lines[11]).toBe("… 1 symbol entries not shown");
	});

	it("reserves room for the omission line before accepting a symbol line", () => {
		const firstLine = "A [symbol] (location unknown)";
		const omitted = "… 1 symbol entries not shown";
		const maxChars = firstLine.length + 1 + omitted.length;
		expect(formatDocumentSymbols([symbol("A"), symbol("B")], maxChars)).toBe(`${firstLine}\n${omitted}`);
		expect(formatDocumentSymbols([symbol("A"), symbol("B")], maxChars).length).toBe(maxChars);
	});

	it("returns only a readable omission line when no symbol line fits", () => {
		const omitted = "… 1 symbol entries not shown";
		expect(formatDocumentSymbols([symbol("too long")], omitted.length)).toBe(omitted);
	});

	it("treats negative and non-finite range coordinates as absent", () => {
		expect(formatDocumentSymbols([
			symbol("negative", { range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } } }),
			symbol("infinite", { range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: 0 } } }),
		], unlimited)).toBe([
			"negative [symbol] (location unknown)",
			"infinite [symbol] (location unknown)",
		].join("\n"));
	});

	it("returns an empty string for empty input or only unreadable entries", () => {
		expect(formatDocumentSymbols([], unlimited)).toBe("");
		expect(formatDocumentSymbols([null, {}], unlimited)).toBe("… 2 unreadable symbol entries omitted");
	});
});
