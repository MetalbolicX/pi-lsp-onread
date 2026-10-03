import { join, resolve } from "node:path";
import type { Addition } from "./generate.js";

export function printPlan(additions: Addition[], path: string, hasExistingConfig: boolean): void {
	const added = additions.filter((item) => item.status === "NEW").map((item) => item.serverId);
	const noops = additions.filter((item) => item.status === "NOOP").map((item) => item.serverId);
	console.log(`Target: ${path}`);
	console.log(`Added: ${added.length ? added.join(", ") : "none"}; no-op: ${noops.length ? noops.join(", ") : "none"}.`);
	if (!hasExistingConfig) console.log(`A schema companion will be created at ${join(resolve(path, ".."), "lsp.schema.json")}.`);
}

export function printConflict(addition: Extract<Addition, { status: "CONFLICT" }>): void {
	console.error(`Conflict for '${addition.serverId}':`);
	console.error(`Existing: ${JSON.stringify(addition.existing, null, 2)}`);
	console.error(`Incoming: ${JSON.stringify(addition.incoming, null, 2)}`);
}
