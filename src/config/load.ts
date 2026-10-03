import { readFile } from "node:fs/promises";
import type { SourceConfig } from "./types.js";
import { validateSourceConfig } from "./schema.js";

export type LoadConfigResult =
	| { status: "skipped" }
	| { status: "loaded"; config: SourceConfig }
	| { status: "error"; errors: string[] };

export async function loadConfig(path: string): Promise<LoadConfigResult> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return { status: "skipped" };
		}
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "error", errors: [`${path}: unable to read configuration: ${detail}`] };
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "error", errors: [`${path}: malformed JSON: ${detail}`] };
	}

	const validation = validateSourceConfig(value);
	if (!validation.ok) return { status: "error", errors: validation.errors.map((message) => `${path}: ${message}`) };
	return { status: "loaded", config: value as SourceConfig };
}
