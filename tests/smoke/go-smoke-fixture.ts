import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Layer-1 real-gopls smoke fixture: a stdlib-only Go module created in a runtime
 * temp dir. `main.go` carries a deliberate compile error, an astral-character line
 * whose symbol follows a 🚀 string literal (UTF-16 probe), gofmt-dirty spacing, and
 * call sites used by the navigation/tool observations. `lib.go` carries a callee
 * function, a small type hierarchy, and an unused import used to exercise
 * organize-imports and code actions.
 */

export const goMod = `module pi-lsp-gopls-smoke

go 1.21
`;

export const brokenMainGo = `package main

import "fmt"

func main() {
	fmt.Println(greeting())
	fmt.Println("🚀", callee("world"))
	fmt.Println(undefinedHelper())
	add(1, 2)
}

func greeting() string {
	return    "hello"
}
`;

/** Broken variant used to force a second publication so an edit delta has a baseline. */
export const warmupMainGo = `// warm-up publication for the edit-delta baseline
package main

import "fmt"

func main() {
	fmt.Println(greeting())
	fmt.Println("🚀", callee("world"))
	fmt.Println(undefinedHelper())
	add(1, 2)
}

func greeting() string {
	return    "hello"
}
`;

/** Same as `brokenMainGo` except the undefined identifier is replaced with a real call. */
export const fixedMainGo = `package main

import "fmt"

func main() {
	fmt.Println(greeting())
	fmt.Println("🚀", callee("world"))
	fmt.Println(callee("world"))
	add(1, 2)
}

func greeting() string {
	return    "hello"
}
`;

export const libGo = `package main

import (
	"os"
	"strings"
)

// callee returns an upper-cased copy of name.
func callee(name string) string {
	return strings.ToUpper(name)
}

// add returns the sum of two ints.
func add(left int, right int) int {
	sum := left + right
	return sum
}

// Speaker is implemented by Dog.
type Speaker interface {
	Speak() string
}

// Dog is a Speaker.
type Dog struct{}

// Speak satisfies Speaker.
func (d Dog) Speak() string {
	return "woof"
}
`;

export const mainTestGo = `package main

import "testing"

func TestGreeting(t *testing.T) {
	if greeting() == "" {
		t.Fatal("empty greeting")
	}
}
`;

export interface GoSmokeProject {
  projectRoot: string;
  canonicalRoot: string;
  trustStorePath: string;
  goModPath: string;
  mainPath: string;
  libPath: string;
  testPath: string;
}

/** Create an isolated Go module plus an isolated trust store that trusts only this root. */
export async function createGoProject(): Promise<GoSmokeProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-lsp-gopls-smoke-"));
  const canonicalRoot = await realpath(projectRoot);
  const trustStorePath = join(projectRoot, "lsp.trust.json");
  await writeFile(
    trustStorePath,
    `${JSON.stringify({ version: 1, trustedRoots: [canonicalRoot] })}\n`,
  );
  const goModPath = join(projectRoot, "go.mod");
  const mainPath = join(projectRoot, "main.go");
  const libPath = join(projectRoot, "lib.go");
  const testPath = join(projectRoot, "main_test.go");
  await writeFile(goModPath, goMod);
  await writeFile(mainPath, brokenMainGo);
  await writeFile(libPath, libGo);
  await writeFile(testPath, mainTestGo);
  return { projectRoot, canonicalRoot, trustStorePath, goModPath, mainPath, libPath, testPath };
}

export async function removeGoProject(projectRoot: string): Promise<void> {
  await rm(projectRoot, { recursive: true, force: true });
}
