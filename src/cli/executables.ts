import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";

async function isAvailable(path: string): Promise<boolean> {
	try {
		if (process.platform === "win32") await access(path);
		else await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function hasPathSeparator(command: string): boolean {
	return command.includes("/") || command.includes("\\");
}

export async function findExecutable(command: string, projectRoot: string, pathEnv = process.env.PATH ?? ""): Promise<string | undefined> {
	if (hasPathSeparator(command)) {
		const candidate = isAbsolute(command) ? command : resolve(projectRoot, command);
		return await isAvailable(candidate) ? candidate : undefined;
	}

	for (const directory of pathEnv.split(delimiter)) {
		if (!directory) continue;
		const candidate = resolve(directory, command);
		if (await isAvailable(candidate)) return candidate;
	}
	return undefined;
}
