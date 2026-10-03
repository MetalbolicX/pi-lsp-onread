import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface TrustStore {
	version: 1;
	trustedRoots: string[];
}

export type LoadTrustStoreResult = { ok: true; store: TrustStore } | { ok: false; errors: string[] };

/** Return the user-owned default trust-store location. */
export function defaultTrustStorePath(): string {
	return join(homedir(), ".pi", "agent", "lsp.trust.json");
}

/** Load a store from an explicitly selected path without throwing on invalid input or I/O errors. */
export async function loadTrustStore({ path }: { path: string }): Promise<LoadTrustStoreResult> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return { ok: true, store: { version: 1, trustedRoots: [] } };
		}
		return { ok: false, errors: [`Unable to read trust store "${path}": ${errorMessage(error)}`] };
	}

	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch (error) {
		return { ok: false, errors: [`Trust store "${path}" contains malformed JSON: ${errorMessage(error)}`] };
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, errors: [`Trust store "${path}" must be an object with version 1 and a trustedRoots string array.`] };
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== 1) {
		return { ok: false, errors: [`Trust store "${path}" has unsupported or missing version; expected version 1.`] };
	}
	if (!Array.isArray(candidate.trustedRoots) || !candidate.trustedRoots.every((root) => typeof root === "string")) {
		return { ok: false, errors: [`Trust store "${path}" has invalid trustedRoots; expected an array of strings.`] };
	}

	return { ok: true, store: { version: 1, trustedRoots: candidate.trustedRoots } };
}

/** Canonicalize an existing path with realpath, or resolve a path that does not exist. */
export async function canonicalizeRoot(absolutePath: string): Promise<string> {
	try {
		return await realpath(absolutePath);
	} catch {
		return resolve(absolutePath);
	}
}

/** Return a copy with the root appended only when it is not already present. */
export function addToStore(store: TrustStore, canonicalRoot: string): { changed: boolean; store: TrustStore } {
	if (store.trustedRoots.includes(canonicalRoot)) return { changed: false, store };
	return { changed: true, store: { version: 1, trustedRoots: [...store.trustedRoots, canonicalRoot] } };
}

/** Return a copy with the root removed; absent roots leave the original store unchanged. */
export function removeFromStore(store: TrustStore, canonicalRoot: string): { changed: boolean; store: TrustStore } {
	if (!store.trustedRoots.includes(canonicalRoot)) return { changed: false, store };
	return { changed: true, store: { version: 1, trustedRoots: store.trustedRoots.filter((root) => root !== canonicalRoot) } };
}

/** Atomically persist a store by writing a temporary sibling and renaming it into place. */
export async function saveTrustStore({ path, store }: { path: string; store: TrustStore }): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	const contents = `${JSON.stringify(store, null, 2)}\n`;
	try {
		await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
		await rename(temporaryPath, path);
	} catch (error) {
		try {
			await unlink(temporaryPath);
		} catch {
			// The temporary file may not have been created or may already have been renamed.
		}
		throw error;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
