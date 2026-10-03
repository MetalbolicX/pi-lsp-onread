import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export interface SpawnServerOptions {
	command: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type ServerProcess = ChildProcess;

export type SpawnServerResult =
	| { ok: true; child: ServerProcess }
	| { ok: false; error: { kind: "spawn"; code?: string; message: string } };

export function spawnServer(options: SpawnServerOptions): Promise<SpawnServerResult> {
	const [binary, ...args] = options.command;
	if (!binary) {
		return Promise.resolve({ ok: false, error: { kind: "spawn", message: "Server command is empty" } });
	}

	return new Promise((resolve) => {
		let settled = false;
		const child = nodeSpawn(binary, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		child.once("spawn", () => {
			if (settled) return;
			settled = true;
			resolve({ ok: true, child });
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			resolve({
				ok: false,
				error: { kind: "spawn", ...(error.code ? { code: error.code } : {}), message: error.message },
			});
		});
	});
}

export async function terminateServer(child: ServerProcess, graceMs = 500): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	child.kill("SIGTERM");
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		exited,
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, graceMs);
		}),
	]);
	if (timer) clearTimeout(timer);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
	}
}
