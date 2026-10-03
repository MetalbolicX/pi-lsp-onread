/**
 * pi-lsp-onread extension entry point (scaffold).
 *
 * Planned responsibilities (implemented in upcoming tasks):
 * - load layered config: global ~/.pi/agent/lsp.json -> project .pi/lsp.json
 * - activate matching servers in the background on the first source read
 * - append cached diagnostics (with freshness labels) to read results
 * - wait bounded on edit/write and append fresh diagnostics
 *
 * The scaffold registers nothing yet: hooks arrive together with the config
 * loader and activation engine, so the extension never loads half-wired
 * behavior.
 */

/** Structural subset of Pi's extension API used by this extension. */
export interface PiExtensionHost {
	on(event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>): unknown;
}

export default function extension(_pi: PiExtensionHost): void {
	// Intentionally minimal until the configuration loader, activation engine,
	// and diagnostic pipeline land.
}
