import { describe, expect, it } from "vitest";
import { formatHover } from "../../../src/hover/format.js";

describe("formatHover", () => {
	it("formats markdown and plaintext content", () => {
		expect(formatHover({ contents: { kind: "markdown", value: " **bold** " } }, 100)).toBe("**bold**");
		expect(formatHover({ contents: { kind: "plaintext", value: " plain " } }, 100)).toBe("plain");
	});
	it("formats MarkedString strings and language values as fenced code", () => {
		expect(formatHover({ contents: "plain string" }, 100)).toBe("plain string");
		expect(formatHover({ contents: { language: "ts", value: "const x = 1;" } }, 100)).toBe("```ts\nconst x = 1;\n```");
	});
	it("joins array parts with a blank line", () => {
		expect(formatHover({ contents: ["first", { kind: "plaintext", value: "second" }] }, 100)).toBe("first\n\nsecond");
	});
	it("echoes valid ranges using 1-based coordinates", () => {
		expect(formatHover({ contents: "info", range: { start: { line: 0, character: 1 }, end: { line: 2, character: 3 } } }, 100))
			.toBe("info\nrange: line 1, character 2 to line 3, character 4");
	});
	it("truncates the total output and rejects unusable hover values", () => {
		expect(formatHover({ contents: "abcdef" }, 3)).toBe("abc");
		expect(formatHover(null, 100)).toBe("");
		expect(formatHover({ contents: 42 }, 100)).toBe("");
	});
});
