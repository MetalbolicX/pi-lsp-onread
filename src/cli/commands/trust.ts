import { resolve } from "node:path";
import {
	addToStore,
	canonicalizeRoot,
	defaultTrustStorePath,
	loadTrustStore,
	removeFromStore,
	saveTrustStore,
} from "../../runtime/trust-store.js";

export interface TrustOptions {
	storePath?: string;
}

function trustUsage(): string {
	return "Usage: pi-lsp-onread trust [list] | trust add [path] | trust remove [path]";
}

function reportStoreErrors(errors: string[]): number {
	for (const error of errors) console.error(error);
	return 1;
}

async function persistStore(storePath: string, store: Parameters<typeof saveTrustStore>[0]["store"]): Promise<boolean> {
	try {
		await saveTrustStore({ path: storePath, store });
		return true;
	} catch (error) {
		console.error(`Unable to save trust store "${storePath}": ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

export async function trust(args: readonly string[], options: TrustOptions = {}): Promise<number> {
	const [subcommand = "list", path] = args;
	if ((subcommand !== "list" && subcommand !== "add" && subcommand !== "remove") || args.length > (subcommand === "list" ? 1 : 2)) {
		console.error(trustUsage());
		return 1;
	}

	const storePath = options.storePath ?? defaultTrustStorePath();
	const loaded = await loadTrustStore({ path: storePath });
	if (!loaded.ok) return reportStoreErrors(loaded.errors);

	if (subcommand === "list") {
		if (loaded.store.trustedRoots.length === 0) {
			console.log("No trusted roots.");
		} else {
			console.log(`${loaded.store.trustedRoots.join("\n")}\n${loaded.store.trustedRoots.length} trusted roots.`);
		}
		return 0;
	}

	const root = await canonicalizeRoot(resolve(path ?? process.cwd()));
	if (subcommand === "add") {
		const result = addToStore(loaded.store, root);
		if (!result.changed) {
			console.log(`Already trusted: ${root}`);
			return 0;
		}
		if (!(await persistStore(storePath, result.store))) return 1;
		console.log(`Trusted: ${root}\nStore: ${storePath}`);
		return 0;
	}

	const result = removeFromStore(loaded.store, root);
	if (!result.changed) {
		console.error(`Not trusted: ${root}`);
		return 1;
	}
	if (!(await persistStore(storePath, result.store))) return 1;
	console.log(`Removed trust: ${root}`);
	return 0;
}
