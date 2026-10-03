import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const MANIFEST_PRESETS: Readonly<Record<string, string[]>> = {
	"pyproject.toml": ["python"],
	"setup.py": ["python"],
	"setup.cfg": ["python"],
	"requirements.txt": ["python"],
	"go.mod": ["go"],
	"Cargo.toml": ["rust"],
	"bsconfig.json": ["rescript"],
	"rescript.json": ["rescript"],
	"CMakeLists.txt": ["clangd"],
	"compile_commands.json": ["clangd"],
	"compile_flags.txt": ["clangd"],
	"composer.json": ["php"],
	"Gemfile": ["ruby"],
	"pom.xml": ["java"],
	"build.gradle": ["java", "kotlin"],
	"build.gradle.kts": ["java", "kotlin"],
	"pubspec.yaml": ["dart"],
	"Package.swift": ["swift"],
	"mix.exs": ["elixir"],
	"build.zig.zon": ["zig"],
	"dune-project": ["ocaml"],
};

const PACKAGE_TOOLCHAINS: Readonly<Record<string, string[]>> = {
	typescript: ["typescript"],
	"@types/node": ["typescript"],
	tsc: ["typescript"],
	rescript: ["rescript"],
	"@rescript/core": ["rescript"],
	vue: ["vue"],
	"vue-language-server": ["vue"],
	"vue-tsc": ["vue"],
	svelte: ["svelte"],
	"svelte-language-server": ["svelte"],
	"svelte-check": ["svelte"],
	astro: ["astro"],
};

export async function detectManifestPresets(projectRoot: string): Promise<string[]> {
	const suggestions = new Set<string>();
	for (const [manifest, presets] of Object.entries(MANIFEST_PRESETS)) {
		try {
			await access(join(projectRoot, manifest));
			for (const preset of presets) suggestions.add(preset);
		} catch {
			// Missing marker files are expected.
		}
	}
	try {
		const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
			dependencies?: Record<string, unknown>;
			devDependencies?: Record<string, unknown>;
			scripts?: Record<string, unknown>;
		};
		const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
		for (const tool of Object.keys(dependencies)) {
			for (const preset of PACKAGE_TOOLCHAINS[tool] ?? []) suggestions.add(preset);
		}
		for (const script of Object.values(packageJson.scripts ?? {})) {
			if (typeof script !== "string") continue;
			for (const [tool, presets] of Object.entries(PACKAGE_TOOLCHAINS)) {
				if (script.includes(tool)) for (const preset of presets) suggestions.add(preset);
			}
		}
	} catch {
		// A package manifest is only a hint source; malformed JSON doesn't block init.
	}
	return [...suggestions];
}
