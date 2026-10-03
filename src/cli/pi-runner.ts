import { spawn } from "node:child_process";

export interface PiRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export type PiRunner = (args: readonly string[]) => Promise<PiRunResult>;

export const runPi: PiRunner = (args) => new Promise((resolve, reject) => {
	const child = spawn("pi", [...args], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => { stdout += chunk; });
	child.stderr.on("data", (chunk: string) => { stderr += chunk; });
	child.once("error", reject);
	child.once("close", (code) => resolve({ code, stdout, stderr }));
});
