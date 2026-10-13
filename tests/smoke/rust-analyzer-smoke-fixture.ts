import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Layer-1 real-rust-analyzer smoke fixture: a dependency-free cargo package created in a
 * runtime temp dir. `main.rs` carries a deliberate compile error (undefined identifier), a
 * launch function whose `callee` call follows a 🚀 string literal on the same line (UTF-16
 * astral probe), deliberately unformatted indentation, and call sites for the navigation and
 * hierarchy observations. `lib.rs` carries the callee/greeting functions, an unused import
 * (code-action candidate), a trait + struct impl for type-hierarchy probes, and a `#[test]`
 * function for code-lens probes.
 *
 * The manifest declares no dependencies so `cargo check` (rust-analyzer's flycheck) never
 * needs the network.
 */

export const cargoToml = `[package]
name = "pi-lsp-rust-analyzer-smoke"
version = "0.0.0"
edition = "2021"

[dependencies]
`;

export const brokenMainRs = `use pi_lsp_rust_analyzer_smoke::{callee, greeting};

fn main() {
    println!("{}", greeting());
    println!("{}", callee("world"));
    println!("{}", launch());
    undefined_helper();
}

fn launch() -> String {
        format!("🚀 {}", callee("world"))
}
`;

/** Broken variant used to force a second publication so an edit delta has a baseline. */
export const warmupMainRs = `// warm-up publication for the edit-delta baseline
use pi_lsp_rust_analyzer_smoke::{callee, greeting};

fn main() {
    println!("{}", greeting());
    println!("{}", callee("world"));
    println!("{}", launch());
    undefined_helper();
}

fn launch() -> String {
        format!("🚀 {}", callee("world"))
}
`;

/** Same as `brokenMainRs` except the undefined identifier is replaced with a real call. */
export const fixedMainRs = `use pi_lsp_rust_analyzer_smoke::{callee, greeting};

fn main() {
    println!("{}", greeting());
    println!("{}", callee("world"));
    println!("{}", launch());
    println!("{}", callee("again"));
}

fn launch() -> String {
        format!("🚀 {}", callee("world"))
}
`;

export const libRs = `use std::collections::HashMap;

pub fn callee(name: &str) -> String {
    name.to_uppercase()
}

pub fn greeting() -> String {
    return    "hello".to_string()
}

pub trait Speaker {
    fn speak(&self) -> String;
}

pub struct Dog;

impl Speaker for Dog {
    fn speak(&self) -> String {
        "woof".to_string()
    }
}

#[test]
fn test_greeting() {
    assert!(!greeting().is_empty());
}
`;

export interface RustAnalyzerSmokeProject {
  projectRoot: string;
  canonicalRoot: string;
  trustStorePath: string;
  cargoTomlPath: string;
  mainPath: string;
  libPath: string;
}

/** Create an isolated cargo package plus an isolated trust store that trusts only this root. */
export async function createRustAnalyzerProject(): Promise<RustAnalyzerSmokeProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-lsp-rust-analyzer-smoke-"));
  const canonicalRoot = await realpath(projectRoot);
  const trustStorePath = join(projectRoot, "lsp.trust.json");
  await writeFile(
    trustStorePath,
    `${JSON.stringify({ version: 1, trustedRoots: [canonicalRoot] })}\n`,
  );
  const srcDir = join(projectRoot, "src");
  await mkdir(srcDir, { recursive: true });
  const cargoTomlPath = join(projectRoot, "Cargo.toml");
  const mainPath = join(srcDir, "main.rs");
  const libPath = join(srcDir, "lib.rs");
  await writeFile(cargoTomlPath, cargoToml);
  await writeFile(mainPath, brokenMainRs);
  await writeFile(libPath, libRs);
  return { projectRoot, canonicalRoot, trustStorePath, cargoTomlPath, mainPath, libPath };
}

export async function removeRustAnalyzerProject(projectRoot: string): Promise<void> {
  await rm(projectRoot, { recursive: true, force: true });
}
