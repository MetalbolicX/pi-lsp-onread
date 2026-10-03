import { PRESETS } from "../../presets/catalog.js";

export function list(): number {
	console.log("Available language presets:\n");
	const width = Math.max(...PRESETS.map((preset) => preset.id.length));
	for (const preset of PRESETS) {
		const marker = preset.guided ? "*" : " ";
		const cmd = preset.command.join(" ");
		console.log(`  ${preset.id.padEnd(width)}  ${marker} ${preset.label}  [${cmd}]`);
	}
	console.log(
		"\n* guided preset: needs toolchain-specific onboarding; commands shown are typical defaults.",
	);
	console.log("Presets are configuration templates only — nothing is downloaded or installed.");
	return 0;
}
