import { describe, expect, it } from "vitest";
import { fromFileUri, toFileUri } from "../../../src/workspace/paths.js";

describe("workspace file paths", () => {
	it("round-trips absolute paths containing spaces, Unicode, #, and ?", () => {
		const filePath = "/workspace/space dir/雪 #draft?.ts";
		const uri = toFileUri(filePath);

		expect(uri).toBe("file:///workspace/space%20dir/%E9%9B%AA%20%23draft%3F.ts");
		expect(fromFileUri(uri)).toBe(filePath);
	});
});
