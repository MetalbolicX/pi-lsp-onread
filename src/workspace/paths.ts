import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Convert an absolute filesystem path to an encoded file URI. */
export function toFileUri(absolutePath: string): string {
	return pathToFileURL(absolutePath).href;
}

/** Convert a file URI back to its absolute filesystem path. */
export function fromFileUri(uri: string): string {
	return fileURLToPath(uri);
}

/** Normalize a path to an absolute path using the current working directory. */
export function canonicalize(absolutePath: string): string {
	return resolve(absolutePath);
}
