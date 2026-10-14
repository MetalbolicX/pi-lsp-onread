import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Layer-2 real-Pi-host smoke fixture: a stdlib-only Go module plus an isolated temp HOME.
 *
 * The module mirrors the layer-1 `go-smoke-fixture.ts` shapes that matter for the host smoke:
 * `main.go` carries a deliberate `undefinedHelper()` compile error, `lib.go` carries an unused
 * stdlib import, and `go.mod` sits at the project root so real root-marker discovery works.
 *
 * Unlike layer-1, this fixture does NOT write a trust store. The host smoke authors config and
 * trust with the real CLI under `homeDir`; `homeDir/.pi/agent` is the extension's `homedir()`
 * derived trust/global-config location, so every write stays inside the temp tree.
 */

export const goMod = `module pi-lsp-pi-host-smoke

go 1.21
`;

export const brokenMainGo = `package main

import "fmt"

func main() {
	fmt.Println(greeting())
	fmt.Println(undefinedHelper())
}

func greeting() string {
	return "hello"
}
`;

/** Deliberate unused import: `os` is never referenced, so gopls reports an error here too. */
export const libGo = `package main

import "os"

func libHelper() string {
	return "lib"
}
`;

export interface PiHostSmokeProject {
  projectRoot: string;
  canonicalRoot: string;
  homeDir: string;
  agentDir: string;
  authPath: string;
  modelsPath: string;
  goModPath: string;
  mainPath: string;
  libPath: string;
}

/**
 * Create an isolated Go module plus an isolated temp HOME that owns the SDK agent dir,
 * credential/model storage, and the extension's `homedir()`-derived trust/global config.
 */
export async function createPiHostProject(): Promise<PiHostSmokeProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-lsp-pi-host-project-"));
  const homeDir = await mkdtemp(join(tmpdir(), "pi-lsp-pi-host-home-"));
  const canonicalRoot = await realpath(projectRoot);
  const agentDir = join(homeDir, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  const goModPath = join(projectRoot, "go.mod");
  const mainPath = join(projectRoot, "main.go");
  const libPath = join(projectRoot, "lib.go");
  await writeFile(goModPath, goMod);
  await writeFile(mainPath, brokenMainGo);
  await writeFile(libPath, libGo);
  return {
    projectRoot,
    canonicalRoot,
    homeDir,
    agentDir,
    authPath: join(homeDir, "auth.json"),
    modelsPath: join(homeDir, "models.json"),
    goModPath,
    mainPath,
    libPath,
  };
}

export async function removePiHostProject(project: PiHostSmokeProject): Promise<void> {
  await rm(project.projectRoot, { recursive: true, force: true });
  await rm(project.homeDir, { recursive: true, force: true });
}

/**
 * Read-only ownership oracle for gopls servers spawned by this fixture.
 *
 * The extension spawns gopls as exactly `["gopls"]` with `cwd = projectRoot`
 * (src/runtime/session.ts), so `/proc/<pid>/cwd` is a stable ownership signal
 * even when unrelated gopls instances exist on the machine. A process is owned
 * iff its resolved cwd equals the resolved `projectRoot`. An unreadable
 * `/proc/<pid>` entry (race, permissions, already exited) is not owned.
 *
 * Strictly read-only: pids are enumerated and inspected, never signalled.
 */
export async function listOwnedGopls(projectRoot: string): Promise<number[]> {
  let pids: number[];
  try {
    const output = execFileSync("pgrep", ["-x", "gopls"], { encoding: "utf8" });
    pids = output.split("\n").filter(Boolean).map(Number);
  } catch {
    // pgrep exits non-zero when there are no matches.
    return [];
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    canonicalRoot = projectRoot;
  }

  const owned: number[] = [];
  for (const pid of pids) {
    if (!Number.isInteger(pid)) continue;
    try {
      const cwd = await readlink(`/proc/${pid}/cwd`);
      if ((await realpath(cwd)) === canonicalRoot) owned.push(pid);
    } catch {
      /* unreadable /proc entry => not owned */
    }
  }
  return owned;
}
