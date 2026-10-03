import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";

describe("cli", () => {
	it("prints help and succeeds", () => {
		expect(main(["help"])).toBe(0);
		expect(main(["--help"])).toBe(0);
	});

	it("prints the version", () => {
		expect(main(["--version"])).toBe(0);
	});

	it("lists presets", () => {
		expect(main(["list"])).toBe(0);
	});

	it("fails on unknown commands", () => {
		expect(main(["bogus"])).toBe(1);
	});

	it("marks planned commands as unimplemented", () => {
		for (const command of ["init", "add", "check", "install"]) {
			expect(main([command])).toBe(2);
		}
	});
});
