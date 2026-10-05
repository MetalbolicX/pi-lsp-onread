import { describe, expect, it } from "vitest";
import { formatInlayHints } from "../../../src/inlay/format.js";

describe("formatInlayHints", () => {
	it("formats string labels with kind markers and exact separators", () => {
		expect(formatInlayHints([
			{ position: { line: 0, character: 1 }, kind: 1, label: "string" },
			{ position: { line: 1, character: 2 }, kind: 2, label: "arg" },
			{ position: { line: 2, character: 3 }, label: "plain" },
		], 100)).toBe("L1:C2  [type] string\nL2:C3  [param] arg\nL3:C4  plain");
	});
	it("concatenates label parts with text and value fallback", () => {
		expect(formatInlayHints([{ position: { line: 0, character: 0 }, label: [{ text: "one" }, { value: "two" }, null] }], 100))
			.toBe("L1:C1  onetwo");
	});
	it("sorts by position stably", () => {
		expect(formatInlayHints([
			{ position: { line: 1, character: 0 }, label: "later" },
			{ position: { line: 0, character: 2 }, label: "second" },
			{ position: { line: 0, character: 2 }, label: "third" },
		], 100)).toBe("L1:C3  second\nL1:C3  third\nL2:C1  later");
	});
	it("reports hints dropped by maxHints", () => {
		expect(formatInlayHints(Array.from({ length: 3 }, (_, line) => ({ position: { line, character: 0 }, label: "x" })), 100, 1))
			.toBe("L1:C1  x\n... 2 more hint(s) omitted");
	});
	it("truncates output and skips malformed entries and labels", () => {
		expect(formatInlayHints([{ position: { line: 0, character: 0 }, label: "abcdef" }], 4)).toBe("L1:C");
		expect(formatInlayHints([null, { position: {}, label: "bad" }, { position: { line: 0, character: 0 }, label: [] }], 100)).toBe("");
	});
});
