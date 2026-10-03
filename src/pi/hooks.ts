import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { combineResult } from "./results.js";

export type HookActivationEvent = "read" | "edit";
export interface HookBindingsHandlers {
	activate(absoluteFilePath: string, event: HookActivationEvent, projectRoot: string): Promise<string | undefined>;
	logError?(message: string, error: unknown): void;
}

/** Bind successful built-in file tool results to the runtime, using only Pi's documented result transformer. */
export function createHookBindings(piApi: Pick<ExtensionAPI, "on">, handlers: HookBindingsHandlers): void {
	piApi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
		try {
			if (event.isError) return;
			const { toolName } = event;
			const activationEvent: HookActivationEvent = toolName === "read" ? "read" : "edit";
			if (toolName !== "read" && toolName !== "edit" && toolName !== "write") return;
			const { path } = event.input;
			if (typeof path !== "string") return;
			const diagnostics = await handlers.activate(resolve(ctx.cwd, path), activationEvent, ctx.cwd);
			if (!diagnostics) return;
			return { content: combineResult(event.content as never, diagnostics) };
		} catch (error) {
			(handlers.logError ?? ((message, reason) => console.warn(message, reason)))("pi-lsp-onread: tool result diagnostics failed", error);
		}
	});
}
