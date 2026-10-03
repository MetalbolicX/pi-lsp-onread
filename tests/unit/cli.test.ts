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

	it("rejects add without presets as a usage error", async () => {
		expect(await main(["add"])).toBe(1);
	});

	it("reports no check configuration as an error", async () => {
		expect(await main(["check", "--project", process.cwd()])).toBe(1);
	});

	it("keeps install as an unimplemented command", async () => {
		expect(await main(["install"])).toBe(2);
	});
});
