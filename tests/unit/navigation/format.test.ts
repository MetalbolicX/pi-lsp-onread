import { describe, expect, it } from "vitest";
import { formatLocations } from "../../../src/navigation/format.js";

const unlimited = Number.MAX_SAFE_INTEGER;
const range = {
	start: { line: 0, character: 2 },
	end: { line: 4, character: 8 },
};

const location = (uri: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	uri,
	...overrides,
});

describe("formatLocations", () => {
	it("decodes file URIs and prints one-based range coordinates", () => {
		expect(formatLocations([location("file:///workspace/My%20Project/file.ts", { range })], unlimited))
			.toBe("/workspace/My Project/file.ts:1:3-5:9");
	});

	it("formats LocationLinks using targetUri and targetSelectionRange", () => {
		expect(formatLocations([{ targetUri: "file:///workspace/linked.ts", targetSelectionRange: range }], unlimited))
			.toBe("/workspace/linked.ts:1:3-5:9");
	});

	it("prints non-file URIs unchanged", () => {
		expect(formatLocations([location("https://example.test/a%20b", { range })], unlimited))
			.toBe("https://example.test/a%20b:1:3-5:9");
	});

	it("marks a URI without a readable range as unknown", () => {
		expect(formatLocations([location("file:///tmp/a")], unlimited)).toBe("/tmp/a (range unknown)");
	});

	it("counts LocationLinks without a usable URI as unreadable", () => {
		expect(formatLocations([{ targetSelectionRange: range }], unlimited))
			.toBe("… 1 unreadable locations omitted");
	});

	it("counts entries with a missing URI as unreadable", () => {
		expect(formatLocations([{}, location("file:///ok")], unlimited)).toBe([
			"/ok (range unknown)",
			"… 1 unreadable locations omitted",
		].join("\n"));
	});

	it("truncates after 300 readable entries and reports the rest", () => {
		const output = formatLocations(Array.from({ length: 301 }, (_unused, index) => location(`file:///path/${index + 1}`)), unlimited).split("\n");
		expect(output).toHaveLength(301);
		expect(output[0]).toBe("/path/1 (range unknown)");
		expect(output[299]).toBe("/path/300 (range unknown)");
		expect(output[300]).toBe("… 1 locations not shown");
	});

	it("respects the exact character budget including omission-line reservation", () => {
		const firstLine = "/a (range unknown)";
		const omitted = "… 1 locations not shown";
		const maxChars = firstLine.length + 1 + omitted.length;
		const output = formatLocations([location("file:///a"), location("file:///a-very-long-location-that-will-not-fit")], maxChars);
		expect(output).toBe(`${firstLine}\n${omitted}`);
		expect(output.length).toBe(maxChars);
	});

	it("returns an empty string for empty input", () => {
		expect(formatLocations([], unlimited)).toBe("");
	});

	it("uses unknown ranges for negative or non-numeric coordinates", () => {
		expect(formatLocations([
			location("file:///negative", { range: { ...range, start: { line: -1, character: 0 } } }),
			location("file:///nonnumeric", { range: { ...range, end: { line: "4", character: 0 } } }),
		], unlimited)).toBe([
			"/negative (range unknown)",
			"/nonnumeric (range unknown)",
		].join("\n"));
	});
});
