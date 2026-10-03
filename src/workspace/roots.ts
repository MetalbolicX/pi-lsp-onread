import { access } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalize } from "./paths.js";

export interface ResolveRootOptions {
	filePath: string;
	markers: string[];
	projectRoot: string;
	exists?: (path: string) => Promise<boolean>;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isWithinProject(path: string, projectRoot: string): boolean {
	const rel = relative(projectRoot, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Find the nearest ancestor containing a configured marker, bounded by projectRoot. */
export async function resolveRoot(options: ResolveRootOptions): Promise<string> {
	const projectRoot = canonicalize(options.projectRoot);
	const filePath = canonicalize(options.filePath);
	if (!isWithinProject(filePath, projectRoot)) return projectRoot;

	const exists = options.exists ?? pathExists;
	let directory = dirname(filePath);

	while (isWithinProject(directory, projectRoot)) {
		for (const marker of options.markers) {
			if (await exists(resolve(directory, marker))) return directory;
		}
		if (directory === projectRoot) break;
		directory = dirname(directory);
	}

	return projectRoot;
}
