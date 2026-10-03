import { freshnessOf } from "./store.js";
import { itemLine } from "./policy.js";
import type { PolicyResults } from "./types.js";

export interface FormatInput {
	uri: string;
	results: PolicyResults;
}

export interface EditFormatInput extends FormatInput {
	waited: boolean;
	waitedMs: number;
}

export function formatForRead(input: FormatInput): string {
	return format(input);
}

export function formatForEdit(input: EditFormatInput): string {
	const waitLine = input.waited
		? `waited ${input.waitedMs}ms; freshest available attached`
		: "wait budget exhausted; freshest available attached";
	return `${format(input)}\n${waitLine}`;
}

function format(input: FormatInput): string {
	const lines = [`Diagnostics for ${fileName(input.uri)}:`];
	for (const result of input.results.snapshots) {
		if (!result.snapshot) {
			lines.push(`pending — no diagnostics received yet from ${result.serverId}`);
			continue;
		}
		const freshness = freshnessOf(result.snapshot, result.currentVersion);
		if (freshness === "stale" && result.snapshot.version !== null) {
			const behind = result.currentVersion - result.snapshot.version;
			lines.push(`${result.serverId}: stale (${behind} ${behind === 1 ? "version" : "versions"} behind)`);
		} else if (freshness === "current") {
			lines.push(`${result.serverId}: fresh: current`);
		} else {
			lines.push(`${result.serverId}: unknown`);
		}
	}

	for (const item of input.results.items) lines.push(itemLine(item, item.serverId));
	if (input.results.truncationMarker) lines.push(input.results.truncationMarker);
	if (input.results.items.length === 0 && input.results.snapshots.every((result) => result.snapshot?.items.length === 0)) {
		lines.push("no diagnostics received to report from the available snapshots");
	} else if (input.results.items.length === 0 && input.results.snapshots.length === 0) {
		lines.push("no diagnostics received from matched servers");
	}
	if (input.results.dropped.items > 0 || input.results.dropped.characters > 0) {
		lines.push(`Dropped ${input.results.dropped.items} items (${input.results.dropped.characters} characters).`);
	}
	return lines.join("\n");
}

function fileName(uri: string): string {
	try {
		const url = new URL(uri);
		const segment = url.pathname.split("/").filter(Boolean).at(-1);
		return segment ? decodeURIComponent(segment) : uri;
	} catch {
		const segment = uri.split(/[\\/]/).filter(Boolean).at(-1);
		return segment ?? uri;
	}
}
