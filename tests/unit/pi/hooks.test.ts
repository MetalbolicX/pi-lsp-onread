import { describe, expect, it, vi } from "vitest";
import { createHookBindings } from "../../../src/pi/hooks.js";
import { createExtension } from "../../../src/extension.js";

type Handler = (event: unknown, ctx: { cwd: string }) => unknown;

function fakePiApi() {
	const handlers = new Map<string, Handler[]>();
	return {
		handlers,
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
			return () => {};
		},
	};
}

describe("createHookBindings", () => {
	it("registers one tool_result handler and maps read/edit/write paths", async () => {
		const piApi = fakePiApi();
		const activate = vi.fn(async () => "diagnostics");
		const api = piApi as unknown as Parameters<typeof createHookBindings>[0];
		createHookBindings(api, { activate });
		const handlers = piApi.handlers.get("tool_result");
		expect(handlers).toHaveLength(1);
		const handler = handlers![0]!;
		for (const [toolName, path, event] of [
			["read", "src/a.ts", "read"],
			["edit", "src/b.ts", "edit"],
			["write", "src/c.ts", "edit"],
		] as const) {
			const result = await handler({ type: "tool_result", toolName, input: { path }, content: [{ type: "text", text: "original" }], isError: false }, { cwd: "/project" }) as { content: unknown[] };
			expect(activate).toHaveBeenLastCalledWith(`/project/${path}`, event, "/project");
			expect(result.content).toEqual([{ type: "text", text: "original" }, { type: "text", text: "\n\ndiagnostics" }]);
		}
	});

	it("keeps the extension lazy until the first file result", async () => {
		const piApi = fakePiApi();
		const createSession = vi.fn(async () => ({
			configResult: { ok: true, config: { lsp: false } },
			dispose: async () => {},
		}));
		createExtension({ createSession: createSession as never })(piApi as never);
		expect(createSession).not.toHaveBeenCalled();
		const handler = piApi.handlers.get("tool_result")![0]!;
		await handler({ toolName: "write", input: { path: "a.ts" }, content: [{ type: "text", text: "wrote" }], isError: false }, { cwd: "/project" });
		expect(createSession).toHaveBeenCalledWith("/project");
	});

	it("does not activate failed or unrelated tool results", async () => {
		const piApi = fakePiApi();
		const activate = vi.fn();
		createHookBindings(piApi as unknown as Parameters<typeof createHookBindings>[0], { activate });
		const handler = piApi.handlers.get("tool_result")![0]!;
		await handler({ toolName: "read", input: { path: "bad.ts" }, content: [], isError: true }, { cwd: "/project" });
		await handler({ toolName: "grep", input: { path: "bad.ts" }, content: [], isError: false }, { cwd: "/project" });
		expect(activate).not.toHaveBeenCalled();
	});
});
