import { pathToFileURL } from "node:url";
import { formatForEdit, formatForRead } from "../diagnostics/format.js";
import { computeDelta } from "../diagnostics/delta.js";
import { apply, itemLine } from "../diagnostics/policy.js";
import type { PolicyItem, SnapshotInput } from "../diagnostics/types.js";
import { matchServers } from "../workspace/match.js";
import { resolveRoot } from "../workspace/roots.js";
import { authorize, untrustedGuidance } from "./authorization.js";
import { canonicalizeRoot } from "./trust-store.js";
import type { ClientFactoryOptions, RuntimeSession } from "./session.js";

export type ActivationEvent = "read" | "edit";
export type ActivationResult =
	| { kind: "inactive"; reason: string }
	| { kind: "no-match" }
	| { kind: "untrusted"; guidance: string }
	| { kind: "ok"; formatted: string; matchedServers: string[]; skipped?: string[] };

export async function activate(session: RuntimeSession, absoluteFilePath: string, event: ActivationEvent): Promise<ActivationResult> {
	const { configResult } = session;
	if (!configResult.ok) return { kind: "inactive", reason: configResult.errors.join("\n") };
	const { config } = configResult;
	const { lsp } = config;
	if (lsp === false) return { kind: "inactive", reason: "LSP is disabled" };

	const matches = matchServers(config, absoluteFilePath);
	if (matches.length === 0) return { kind: "no-match" };
	const matchedConfigs = matches.map(({ serverId }) => [serverId, lsp[serverId]] as const);
	const markers = matchedConfigs.flatMap(([, server]) => server?.rootMarkers ?? []);
	const resolvedRoot = await resolveRoot({ filePath: absoluteFilePath, markers, projectRoot: session.projectRoot });
	const canonicalRoot = await canonicalizeRoot(resolvedRoot);
	if (!session.trustResult.ok) return { kind: "inactive", reason: session.trustResult.errors.join("\n") };
	const authorization = authorize({ projectRoot: canonicalRoot, trustedRoots: session.trustResult.store.trustedRoots });
	if (!authorization.allowed) return { kind: "untrusted", guidance: untrustedGuidance(canonicalRoot) };

	const startedAt = session.clock();
	const uri = pathToFileURL(absoluteFilePath).href;
	let text: string;
	try {
		text = await session.fsReadFile(absoluteFilePath, "utf8");
	} catch (error) {
		return { kind: "inactive", reason: `Unable to read ${absoluteFilePath}: ${error instanceof Error ? error.message : String(error)}` };
	}

	const policy = config.diagnostics;
	const waitMs = Math.max(0, policy.waitMs);
	// Capture retained baselines before this activation can record a publication; a wait may
	// replace the store's baseline, but comparison must use the pre-edit retained snapshot.
	const editBaselines = event === "edit"
		? new Map(matches.map(({ serverId }) => [serverId, session.diagnostics.baseline(serverId, uri)]))
		: new Map();
	const failures: string[] = [];
	let waited = false;
	const getOutcomes = async () => Promise.all(matches.map(async (match) => {
		const server = lsp[match.serverId];
		if (!server) return { match, error: "server configuration is unavailable" };
		const options: ClientFactoryOptions = { serverId: match.serverId, server, root: canonicalRoot, projectRoot: session.projectRoot };
		const created = await session.getOrCreateClient(session.getPoolKey(match.serverId, canonicalRoot), options);
		if (!created.ok) return { match, error: created.message };
		return { match, server, client: created.client };
	}));
	let outcomes: Awaited<ReturnType<typeof getOutcomes>> = [];
	const processActivation = async () => {
		outcomes = await getOutcomes();
		const waiters = [];
		for (const outcome of outcomes) {
			if (!("client" in outcome) || !outcome.client) {
				failures.push(`failed to start ${outcome.match.serverId}: ${outcome.error}`);
				continue;
			}
			const { client, match } = outcome;
			const ensured = await client.ensure();
			const poolKey = session.getPoolKey(match.serverId, canonicalRoot);
			if (!ensured.ok) {
				await session.recordStartFailure(poolKey, client);
				failures.push(`failed to start ${match.serverId}: ${ensured.error.message}`);
				continue;
			}
			session.recordStartSuccess(poolKey, client);
			const version = client.documents.version(uri);
			const nextVersion = version === undefined ? 1 : version + (event === "edit" ? 1 : 0);
			try {
				if (version === undefined) await client.documents.open(uri, match.languageId, text);
				else if (event === "edit") await client.documents.change(uri, text);
				session.documentState.set(`${match.serverId}::${uri}`, { languageId: match.languageId, text });
				if (event === "edit") {
					const ticket = session.watchPublication(match.serverId, uri, nextVersion);
					waiters.push(ticket);
				}
			} catch (error) {
				// Defensive: a connection drop between ensure() and the document sync can leave the
			// server unresponsive. Not deterministically reproducible with the stdio fixture
			// server (pipe writes buffer before the teardown event arrives), so intentionally
			// not covered by a focused test. Message names the sync, not the start, and no
			// publication waiter is registered here (waiter moved inside the try on success).
			failures.push(`failed to sync document to ${match.serverId}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (event === "edit" && waitMs > 0 && waiters.length > 0) {
			const remaining = Math.max(0, waitMs - (session.clock() - startedAt));
			if (remaining > 0) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const publication = (async () => {
					await Promise.all(waiters.map((waiter) => waiter.promise));
					return true;
				})();
				const timedOut = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), remaining); });
				waited = await Promise.race([publication, timedOut]);
				if (timer) clearTimeout(timer);
			}
		}
		for (const waiter of waiters) waiter.cancel();
	};
	const work = processActivation();
	if (event === "edit") {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, Math.max(0, waitMs - (session.clock() - startedAt)));
		});
		await Promise.race([work, deadline]);
		if (timer) clearTimeout(timer);
	} else {
		await work;
	}

	const snapshots: SnapshotInput[] = matches.flatMap((match) => {
		const outcome = outcomes.find((candidate) => candidate.match.serverId === match.serverId);
		if (outcome && !("client" in outcome)) return [];
		if (!outcome && event === "read") return [];
		const client = outcome && "client" in outcome ? outcome.client : session.pool.get(session.getPoolKey(match.serverId, canonicalRoot));
		const version = client?.documents.version(uri);
		return [{
			serverId: match.serverId,
			currentVersion: version ?? 1,
			snapshot: session.diagnostics.get(match.serverId, uri),
		}];
	});
	const results = apply({ snapshots, policy });
	let delta: { serverId: string; newlyObserved: PolicyItem[]; resolved: PolicyItem[]; unchangedCount: number } | undefined;
	if (event === "edit") {
		const newlyObservedInputs: SnapshotInput[] = [];
		const resolvedInputs: SnapshotInput[] = [];
		let unchangedCount = 0;
		const deltaServerIds: string[] = [];
		for (const current of snapshots) {
			const baseline = editBaselines.get(current.serverId);
			if (!baseline || !current.snapshot) continue;
			deltaServerIds.push(current.serverId);
			const computed = computeDelta(baseline, current.snapshot);
			unchangedCount += computed.unchangedCount;
			newlyObservedInputs.push({
				serverId: current.serverId,
				currentVersion: current.currentVersion,
				snapshot: { ...current.snapshot, items: computed.newlyObserved },
			});
			resolvedInputs.push({
				serverId: current.serverId,
				currentVersion: current.currentVersion,
				snapshot: { ...baseline, items: computed.resolved },
			});
		}
		if (deltaServerIds.length > 0) {
			const orderedServerIds = [...deltaServerIds].sort((a, b) => a.localeCompare(b));
			const newlyObserved = apply({ snapshots: newlyObservedInputs, policy }).items
				.sort((a, b) => a.serverId.localeCompare(b.serverId));
			const resolved = apply({
				snapshots: resolvedInputs,
				policy: { ...policy, maxChars: Number.MAX_SAFE_INTEGER },
			}).items.sort((a, b) => a.serverId.localeCompare(b.serverId));
			delta = {
				serverId: orderedServerIds.join(", "),
				newlyObserved,
				resolved,
				unchangedCount,
			};
		}
	}
	let formatted = event === "read"
		? formatForRead({ uri, results })
		: formatForEdit({ uri, results, waited, waitedMs: waitMs > 0 ? Math.min(waitMs, Math.max(0, session.clock() - startedAt)) : 0, ...(delta ? { delta } : {}) });
	if (delta) {
		const fallbackServerIds = new Set(snapshots
			.filter((snapshot) => !editBaselines.get(snapshot.serverId))
			.map((snapshot) => snapshot.serverId));
		const fallbackLines = results.items
			.filter((item) => fallbackServerIds.has(item.serverId))
			.map((item) => itemLine(item, item.serverId));
		if (fallbackLines.length > 0) {
			const lines = formatted.split("\n");
			lines.splice(Math.max(0, lines.length - 1), 0, ...fallbackLines);
			formatted = lines.join("\n");
		}
	}
	return {
		kind: "ok",
		formatted: [...failures, formatted].join("\n"),
		matchedServers: matches.map((match) => match.serverId),
	};
}

