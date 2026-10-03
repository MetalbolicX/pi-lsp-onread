export default [
	{
		input: "src/extension.ts",
		platform: "node",
		output: {
			file: "dist/extension.js",
			format: "esm",
			minify: false,
		},
		external: [/^node:/],
	},
	{
		input: "src/cli.ts",
		platform: "node",
		output: {
			file: "dist/cli.js",
			format: "esm",
			minify: false,
			banner: "#!/usr/bin/env node",
		},
		external: [/^node:/],
	},
];
