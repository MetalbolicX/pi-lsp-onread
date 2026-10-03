/**
 * Language preset catalog shared by the CLI and the extension.
 *
 * Commands are typical ecosystem defaults, not live-verified installs; the CLI
 * never downloads or installs anything. "Guided" presets need toolchain-
 * specific onboarding text that arrives in a later task.
 */

export type LanguageIdSpec = string | Record<string, string>;

export interface LspPreset {
	/** Stable preset id used by `pi-lsp-onread init --languages`. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** Server argv; executed without a shell. */
	command: string[];
	/** File extensions (leading dot) or whole filenames without an extension (e.g. "Dockerfile"). */
	extensions: string[];
	/** LSP languageId, or a per-extension map for multi-language servers. */
	languageId: LanguageIdSpec;
	/** File/directory names used to detect the nearest project root. */
	rootMarkers?: string[];
	/** True when the server needs toolchain-specific onboarding beyond a plain command. */
	guided?: boolean;
	notes?: string;
}

export const PRESETS: readonly LspPreset[] = [
	{
		id: "typescript",
		label: "TypeScript / JavaScript",
		command: ["typescript-language-server", "--stdio"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		languageId: {
			".ts": "typescript",
			".tsx": "typescriptreact",
			".js": "javascript",
			".jsx": "javascriptreact",
			".mjs": "javascript",
			".cjs": "javascript",
			".mts": "typescript",
			".cts": "typescript",
		},
		rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
	},
	{
		id: "python",
		label: "Python",
		command: ["pyright-langserver", "--stdio"],
		extensions: [".py", ".pyi"],
		languageId: "python",
		rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
	},
	{
		id: "go",
		label: "Go",
		command: ["gopls"],
		extensions: [".go"],
		languageId: "go",
		rootMarkers: ["go.mod"],
	},
	{
		id: "rust",
		label: "Rust",
		command: ["rust-analyzer"],
		extensions: [".rs"],
		languageId: "rust",
		rootMarkers: ["Cargo.toml"],
	},
	{
		id: "clangd",
		label: "C / C++",
		command: ["clangd"],
		extensions: [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh"],
		languageId: {
			".c": "c",
			".h": "c",
			".cpp": "cpp",
			".cc": "cpp",
			".cxx": "cpp",
			".hpp": "cpp",
			".hh": "cpp",
		},
		rootMarkers: ["compile_commands.json", "compile_flags.txt", "CMakeLists.txt", "Makefile"],
	},
	{
		id: "rescript",
		label: "ReScript",
		command: ["rescript-language-server", "--stdio"],
		extensions: [".res", ".resi"],
		languageId: "rescript",
		rootMarkers: ["rescript.json", "bsconfig.json"],
		notes:
			"Needs the project's ReScript compiler in node_modules and a buildable project; the server manages the compiler's editor-mode build.",
	},
	{
		id: "bash",
		label: "Bash",
		command: ["bash-language-server", "--stdio"],
		extensions: [".sh", ".bash", ".zsh", ".ksh"],
		languageId: "bash",
	},
	{
		id: "lua",
		label: "Lua",
		command: ["lua-language-server"],
		extensions: [".lua"],
		languageId: "lua",
	},
	{
		id: "php",
		label: "PHP",
		command: ["intelephense", "--stdio"],
		extensions: [".php"],
		languageId: "php",
		rootMarkers: ["composer.json"],
	},
	{
		id: "html",
		label: "HTML",
		command: ["vscode-html-language-server", "--stdio"],
		extensions: [".html", ".htm"],
		languageId: "html",
	},
	{
		id: "css",
		label: "CSS / SCSS / Less",
		command: ["vscode-css-language-server", "--stdio"],
		extensions: [".css", ".scss", ".less"],
		languageId: { ".css": "css", ".scss": "scss", ".less": "less" },
	},
	{
		id: "json",
		label: "JSON / JSONC",
		command: ["vscode-json-language-server", "--stdio"],
		extensions: [".json", ".jsonc"],
		languageId: { ".json": "json", ".jsonc": "jsonc" },
	},
	{
		id: "yaml",
		label: "YAML",
		command: ["yaml-language-server", "--stdio"],
		extensions: [".yaml", ".yml"],
		languageId: "yaml",
	},
	{
		id: "toml",
		label: "TOML",
		command: ["taplo", "lsp"],
		extensions: [".toml"],
		languageId: "toml",
	},
	{
		id: "markdown",
		label: "Markdown",
		command: ["marksman"],
		extensions: [".md", ".markdown"],
		languageId: "markdown",
	},
	{
		id: "dockerfile",
		label: "Dockerfile",
		command: ["docker-langserver", "--stdio"],
		extensions: ["Dockerfile", ".dockerfile"],
		languageId: "dockerfile",
		notes: "Matched by whole filename; the config matcher also accepts extension-less filenames.",
	},
	{
		id: "vue",
		label: "Vue",
		command: ["vue-language-server", "--stdio"],
		extensions: [".vue"],
		languageId: "vue",
	},
	{
		id: "svelte",
		label: "Svelte",
		command: ["svelteserver", "--stdio"],
		extensions: [".svelte"],
		languageId: "svelte",
	},
	{
		id: "astro",
		label: "Astro",
		command: ["astro-ls", "--stdio"],
		extensions: [".astro"],
		languageId: "astro",
		notes: "Works best with the project's Astro toolchain installed.",
	},
	{
		id: "java",
		label: "Java",
		command: ["jdtls"],
		extensions: [".java"],
		languageId: "java",
		guided: true,
		rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts"],
		notes: "Eclipse JDT LS needs a launcher script and workspace directory; onboarding arrives in a later task.",
	},
	{
		id: "csharp",
		label: "C#",
		command: ["csharp-ls"],
		extensions: [".cs"],
		languageId: "csharp",
		guided: true,
		rootMarkers: ["*.sln", "*.csproj"],
		notes: ".NET SDK required; alternative servers exist (e.g. OmniSharp).",
	},
	{
		id: "kotlin",
		label: "Kotlin",
		command: ["kotlin-lsp"],
		extensions: [".kt", ".kts"],
		languageId: { ".kt": "kotlin", ".kts": "kotlin" },
		guided: true,
		notes: "Kotlin LSP distributions are still evolving; verify your toolchain version.",
	},
	{
		id: "ruby",
		label: "Ruby",
		command: ["ruby-lsp"],
		extensions: [".rb", ".rake"],
		languageId: "ruby",
		rootMarkers: ["Gemfile"],
		notes: "Requires Ruby and the ruby-lsp gem.",
	},
	{
		id: "dart",
		label: "Dart / Flutter",
		command: ["dart", "language-server"],
		extensions: [".dart"],
		languageId: "dart",
		rootMarkers: ["pubspec.yaml"],
		notes: "Requires the Dart/Flutter SDK on PATH.",
	},
	{
		id: "swift",
		label: "Swift",
		command: ["sourcekit-lsp"],
		extensions: [".swift"],
		languageId: "swift",
		rootMarkers: ["Package.swift"],
		notes: "Requires the Swift toolchain (Xcode on macOS).",
	},
	{
		id: "elixir",
		label: "Elixir",
		command: ["elixir-ls"],
		extensions: [".ex", ".exs"],
		languageId: { ".ex": "elixir", ".exs": "elixir" },
		guided: true,
		rootMarkers: ["mix.exs"],
		notes: "Elixir LS usually needs a manually built release; onboarding arrives in a later task.",
	},
	{
		id: "zig",
		label: "Zig",
		command: ["zls"],
		extensions: [".zig", ".zon"],
		languageId: { ".zig": "zig", ".zon": "zig" },
		guided: true,
		rootMarkers: ["build.zig.zon"],
		notes: "Install ZLS matching your Zig version.",
	},
	{
		id: "ocaml",
		label: "OCaml",
		command: ["ocamllsp"],
		extensions: [".ml", ".mli"],
		languageId: { ".ml": "ocaml", ".mli": "ocaml" },
		guided: true,
		rootMarkers: ["dune-project"],
		notes: "Requires an opam switch; verify the interface languageId for your setup.",
	},
];
