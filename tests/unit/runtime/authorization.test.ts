import { describe, expect, it } from "vitest";
import { authorize, untrustedGuidance } from "../../../src/runtime/authorization.js";

describe("runtime authorization", () => {
	it("allows only an exact canonical root match", () => {
		expect(authorize({ projectRoot: "/workspace/project", trustedRoots: ["/workspace/project"] })).toEqual({ allowed: true });
		expect(authorize({ projectRoot: "/workspace/other", trustedRoots: ["/workspace/project"] })).toMatchObject({
			allowed: false,
			reason: "untrusted_root",
		});
	});

	it("does not trust nested projects through a parent root", () => {
		expect(authorize({ projectRoot: "/workspace/project/nested", trustedRoots: ["/workspace/project"] })).toMatchObject({
			allowed: false,
			reason: "untrusted_root",
		});
	});

	it("provides exact trust-add guidance naming the project root", () => {
		const root = "/workspace/project";
		expect(untrustedGuidance(root)).toContain("pi-lsp-onread trust add");
		expect(untrustedGuidance(root)).toContain(root);
		expect(authorize({ projectRoot: root, trustedRoots: [] })).toEqual({
			allowed: false,
			reason: "untrusted_root",
			guidance: untrustedGuidance(root),
		});
	});
});
