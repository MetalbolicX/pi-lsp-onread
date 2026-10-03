import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";

describe("cli", () => {
	it("prints help and succeeds", async () => {
		expect(await main(["help"])).toBe(0);
		expect(await main(["--help"])).toBe(0);
	});

	it("prints the version", async () => {
		expect(await main(["--version"])).toBe(0);
	});

	it("lists presets", async () => {
		expect(await main(["list"])).toBe(0);
	});

	it("fails on unknown commands", async () => {
		expect(await main(["bogus"])).toBe(1);
	});

	it("keeps the remaining planned commands as unimplemented", async () => {
		for (const command of ["add", "check", "install"]) {
			expect(await main([command])).toBe(2);
		}
	});
});
