import { freshnessOf } from "./store.js";
import type { Freshness, Snapshot } from "./types.js";

export interface PreflightStore {
	get(serverId: string, uri: string): Snapshot | undefined;
}

export interface PreflightServer {
	serverId: string;
	currentVersion?: number;
}

export interface PreflightResult {
	outcome: "no-data" | "unknown" | "stale" | "clear" | "errors";
	errorCount: number;
	freshness?: Freshness;
	messages: string[];
}

export function preflightCheck(input: {
	store: PreflightStore;
	servers: readonly (string | PreflightServer)[];
	uri: string;
	currentVersion?: number;
}): PreflightResult {
	let sawSnapshot = false;
	let sawUnknown = false;
	let sawStale = false;
	let errorCount = 0;
	const messages: string[] = [];

	for (const server of input.servers) {
		const serverId = typeof server === "string" ? server : server.serverId;
		const currentVersion = typeof server === "string" ? input.currentVersion : server.currentVersion ?? input.currentVersion;
		const snapshot = input.store.get(serverId, input.uri);
		if (!snapshot) continue;
		sawSnapshot = true;
		if (currentVersion === undefined) {
			sawUnknown = true;
			continue;
		}
		const freshness = freshnessOf(snapshot, currentVersion);
		if (freshness === "unknown") {
			sawUnknown = true;
			continue;
		}
		if (freshness === "stale") {
			sawStale = true;
			continue;
		}
		for (const item of snapshot.items) {
			if (item.severity !== 1) continue;
			errorCount++;
			if (messages.length < 3) messages.push(item.message.slice(0, 120));
		}
	}

	if (errorCount > 0) return { outcome: "errors", errorCount, freshness: "current", messages };
	if (sawStale) return { outcome: "stale", errorCount: 0, freshness: "stale", messages };
	if (sawUnknown) return { outcome: "unknown", errorCount: 0, freshness: "unknown", messages };
	if (!sawSnapshot) return { outcome: "no-data", errorCount: 0, messages };
	return { outcome: "clear", errorCount: 0, freshness: "current", messages };
}

export function preflightMessages(result: Pick<PreflightResult, "messages">): string[] {
	return result.messages.slice(0, 3).map((message) => message.slice(0, 120));
}
