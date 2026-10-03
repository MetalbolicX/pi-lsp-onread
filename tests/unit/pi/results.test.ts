import { describe, expect, it } from "vitest";
import { combineResult } from "../../../src/pi/results.js";

describe("combineResult", () => {
	it("appends a diagnostic text block without changing existing content", () => {
		const original = [{ type: "text", text: "file contents" }, { type: "image", data: "abc", mimeType: "image/png" }] as const;
		expect(combineResult([...original], "diagnostics")).toEqual([
			...original,
			{ type: "text", text: "\n\ndiagnostics" },
		]);
	});

	it("leaves empty diagnostics unchanged", () => {
		const original = [{ type: "text", text: "file contents" }];
		expect(combineResult(original, "")).toBe(original);
	});
});
