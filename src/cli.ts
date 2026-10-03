import { realpathSync } from "node:fs";
import { main } from "./cli/main.js";

export { main } from "./cli/main.js";

const [, entryArg] = process.argv;
if (entryArg) {
	try {
		const entry = realpathSync(entryArg);
		const self = realpathSync(import.meta.filename);
		if (entry === self) {
			process.exitCode = main(process.argv.slice(2));
		}
	} catch {
		// Entry resolution failed (e.g. unusual symlink setup); fall through so
		// an importing host is never affected.
	}
}
