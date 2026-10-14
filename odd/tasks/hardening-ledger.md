# Feature: hardening-ledger

Retires the post-finding-fixes hardening ledger (user-approved full
scope, audit-first, one slice with work-unit commits): the two
rust-analyzer interaction findings that have a product-side fix path
(F9 push-stream clobbering, F8 rustc-context code actions), both
smoke-harness R3-001 advisories, a definitive F5 codeLens
classification, and an audit of the older per-slice advisory tail.
Evidence: `odd/tasks/finding-fixes.md` (L4 F8/F9), `odd/tasks/
rust-analyzer-smoke.md` (L4 F5, review record R3-001),
`odd/tasks/real-server-smoke.md` (review record R3-001).

## Design decisions (settled before implementation)

- **F9 merge key = diagnostic `source`** — the store keeps per-(server,
  uri) push *slots* keyed by the push report's dominant `source` field
  (rust-analyzer native vs rustc/flycheck) and replaces only the same
  slot; pull-preservation semantics from finding-fixes are unchanged.
  A union view is materialized at read time with `version = max(slot
  versions)` so freshness rules keep working; baselines keep recording
  the previous union so delta semantics are unchanged. **Step 1 is a
  discriminant spike**: confirm via rawItems (unit fixture + one RA
  observe) exactly which `source` values arrive on each stream before
  the key is finalized. If no stable discriminant exists, record that
  honestly and F9 stays a finding (no speculative merge).
- **F8 rides F9** — `session.codeActions` already builds context from
  the current snapshot's rawItems; once the snapshot is the merged
  union, rust-analyzer's assist engine sees its native items again.
  Work = verification on real RA (S5 may flip to real previews; the
  harness auto-tightens by design) plus any ordering/dedup the union
  view needs. If RA still returns nothing for a native-bearing
  context, F8 is re-classified server-side and stays recorded.
- **One standalone RA probe covers F5 + the F8 hypothesis** — framed
  LSP probe in /tmp on a temp fixture: (a) codeLens with the exact
  settings our client sends AND with corrected settings keys — wrong
  keys means a client-side fix; empty under both means server-side
  (documented finding); (b) codeActions with a native-only context —
  validates the F8 hypothesis before the store work lands.
- **Bin defaults flip to PATH resolution** — `?? "rust-analyzer"` /
  `?? "gopls"` (both verified resolvable on PATH here at the exact
  smoke-tested versions: rust-analyzer 1.95.0, gopls v0.23.0); env
  overrides stay. Fixes the rust R3-001 and the identical unflagged
  gopls hardcode symmetrically.
- **S5 wording-brittleness fix = shared markers, not looser strings** —
  gopls S5 asserts against the renderer's actual marker constants
  (imported from the tool layer where they exist; add exports if
  missing) instead of inline prose substrings; structural regexes
  stay. The wording contract stays enforced — drift now fails loudly
  at the single definition point instead of silently at N literals.
- **Audit-first** — the seed list below comes from receipts; each item
  is classified against current source as stale/fixed/live (receipt
  line numbers are historical; several families were already retired:
  navigation-completion R3-001 by advisory-sweep-2 S1,
  inlay-hints-tool.ts:74 by S2, extension.ts:102-104 by gap-closure,
  session.ts:209 by b3776b7, activation.ts:81 by 76dc220). Live items
  with a deterministic RED→GREEN path get fixed in-slice at the
  advisory-cleanup bar; the rest are left with reasons; the
  authoritative final ledger lands in this doc.

## Tasks

| # | Work | Route | Verification | Status |
|---|------|-------|--------------|--------|
| T0 | Advisory-tail audit: classify seed list, fix trivially-live items | inline (reads) + worker if fixes span files | fixed/stale/live table below; unit green | **done** — docs-only; no live item met the RED→GREEN bar (table below) |
| T1 | Smoke hygiene: PATH-default bins (both tests), gopls S5 shared-marker assertions | worker | both gated smokes 8/8; bare test spawns nothing | **done** — `0ff03f9` (smoke hygiene); both gated smokes 8/8 in L4 and re-verified by every subsequent slice battery; bare suite spawns nothing |
| T2 | F9 store merge + F8 context verification (one coherent product commit; shared store/session/fixture surfaces) | worker (RED→GREEN) | unit: interleaved two-source pushes preserve both; rust smoke S3 delta always-assertable (auto-tighten) or F9 honestly stays recorded; S5 flip on RA asserted; gopls 8/8 | **done — honesty gate fired**: probe found no stable discriminant (native pushes are empty; items all `source:"rustc"`); no store change made; harness settings-shape fix landed instead; rust smoke 8/8 |
| T3 | F5 probe + disposition | inline (probe) + docs | probe evidence verbatim in Log; client-side fix or documented server-side finding | **done — superseded classification**: recorded "server-side confirmed" at the time (0 lenses under valid settings, both shapes, `codeLensProvider:{resolveProvider:true}` advertised) — reclassified by the rust-compatibility-investigation (R4) as a **client-side capability gap** and closed by `ra-capability-fix` (`3ebce14`); see Final disposition ledger |
| T4 | Closure: full battery, README wording where behavior text changed, assess + review per RDD | inline + native | all green; slice review burned | **done** — L4 battery all green; RDD reminder claimed the slice: `review-c527e94ae95b35dd` APPROVED zero findings (burned `sha256:4b13d5cd…`) |

## Audit seed list (from receipts; line numbers historical)

- session.ts family: R3-001 :215 (workspace-symbol era), :358
  (hover-inlay), :395 (formatting-preview) — pull/parse validation era;
  much reworked by finding-fixes.
- preview/workspace-edit.ts: R3-001 :70-74, R3-002 :219
  (edit-preview-engine).
- lsp-organize-imports-tool.ts:58 (organize-imports-preview).
- lsp-code-actions-tool.ts:105 (code-action-tool; context rework in
  finding-fixes may have retired it).
- lsp-navigation-tools.ts:89 (navigation-tools).
- diagnostics/format.ts:52-53 family (on-demand-diagnostics,
  diagnostic-deltas, cross-file-awareness).
- runtime/activation.ts family: :100-113, :162, :166, :207
  (timer/cleanup class; advisory-cleanup verified :100-113 present).
- RETIRED (verify, don't re-fix): navigation-tools.ts:260 (sweep-2
  S1), inlay-hints-tool.ts:74 (sweep-2 S2), extension.ts:102-104
  (gap-closure), session.ts:209 (b3776b7), activation.ts:81 (76dc220),
  the 13-item CLI batch (advisory-cleanup).

## Audit result (T0)

Classification = current-source read of each pattern family (receipt
prose was not preserved verbatim for most items; historical line
numbers only locate the era).

| Seed item | Class | Evidence |
|---|---|---|
| session.ts :209/:215 (pull-report validation) | fixed | b3776b7 (malformed pull rejected before state updates); recordPull preservation reworked in finding-fixes |
| session.ts :358 (hover), :395 (formatting), :215-era symbols | stale | current hover/formatting/workspaceSymbols/documentSymbol paths all use the uniform outcome-guard pattern (capability → unsupported, timeout ≤ 0 → failed, response-shape validation → failed, catch → failed); unit-tested |
| preview/workspace-edit.ts:70-74 | stale | validation rewritten: try/catch URI decode, out-of-root rejection, malformed-edit reasons, overlap detection, range-bounds warnings |
| preview/workspace-edit.ts:219 | live-minor, left with reason | renderWorkspaceEdit char-budget arithmetic is hard to read (`candidateWithReserve` names a length; `omitted += totalEdits - renderedEdits - omitted`); bounds are covered by existing tests and no deterministic failure is reproducible — below the RED→GREEN bar |
| lsp-organize-imports-tool.ts:58 | stale | outcome-explicit loop (failed/unsupported/no-actions/omissions) with exact+prefix action matching and omission counting; reworked and tested since |
| lsp-code-actions-tool.ts:105 | live-by-design, left with reason | index-based selection between a listing call and a later preview call is inherent to the stateless list-then-select contract (documented via footer); deterministic within one result sequence |
| lsp-navigation-tools.ts:89 | stale | navigation tools rewritten in navigation-completion (1-based validation, bounded formatters); the :260 malformed-hierarchy concern retired by advisory-sweep-2 S1 |
| diagnostics/format.ts:52-53 family | stale | explicit pending/stale-behind/current/unknown freshness branches, truncation marker, dropped-count lines; format tests cover |
| runtime/activation.ts :81 | fixed | 76dc220 (waiter registered only after successful sync; message renamed) |
| runtime/activation.ts :100-113 | verified sound | advisory-cleanup verified timer+waiter cleanup present; re-confirmed: clearTimeout after every race, waiters cancelled |
| runtime/activation.ts :162/:166/:207 | stale | publication-wait / pull-reserve / workspace-pull paths reworked with explicit budgets and cleanup |
| RETIRED batch | verified | sweep-2 S1 + S2, gap-closure (extension.ts:102-104), b3776b7, 76dc220, advisory-cleanup (13 CLI items) |

**Ledger conclusion:** the tail is retired. Two live items remain
by documented design/readability reasons (workspace-edit render
budget; code-action index stability) — neither admits a
deterministic RED→GREEN fix. The active ledger after this audit is
exactly F5 / F8 / F9 + the two smoke advisories (T1–T3).

## Probe evidence and dispositions (T2/T3)

Instruments: (1) a standalone framed-LSP probe replicating the exact
client handshake (auto `-32601` for unhandled server requests, matching
the real protocol connection), and (2) a temporary env-gated harness
test running the REAL stack (RuntimeSession + real rust-analyzer +
real fixture) with store-transition polling and raw client requests —
deleted after evidence capture. Verbatim key lines:

- `P1-open +1204ms :: v=1 origin=push items=[rustc:E0425:s1:cannot
  find function \`undefined_helper\` …] rawSources=[rustc]` — the
  flycheck stream pushes items with `source:"rustc"`.
- `P2-edit +0ms :: v=2 origin=push items=[] rawSources=[]` followed by
  `P2-edit +199ms :: v=2 origin=push items=[rustc:E0432:…]` — the
  interleaving is real: an EMPTY push (the native stream's clear)
  lands between flycheck pushes of the same version.
- `P4 context pool: total=3 native=0 flycheck=3` and all four context
  variants (`empty`/`all`/`native-only`/`flycheck-only`) →
  `result=null` — **F8 disposition: server-side.** rust-analyzer
  offers no actions at flycheck-error positions regardless of context;
  no product change can fix this. *(Superseded: the null was the
  missing `codeActionLiteralSupport` capability, not context
  blindness — see Final disposition ledger.)*
- `P3 [F5] valid-unwrapped: 0 lenses` and `P5 [F5] wrapped: 0 lenses`
  with `codeLensProvider={"resolveProvider":true}` — **F5
  disposition: server-side.** Zero lenses under correct settings
  through both configuration shapes; the settings shape is ruled out.
  *(Superseded: lens emission is gated on the client's
  `experimental.commands.commands` capability — see Final disposition
  ledger.)*
- Standalone probe: `showMessage[2] invalid config value:
  /checkOnSave: invalid type: map, expected a boolean` (×3) — the
  smoke's `checkOnSave: { command: "check" }` shape has been silently
  rejected by rust-analyzer 1.95 all along (flycheck ran on
  defaults). Fixed in the harness: modern `check: { command: "check" }`
  + `lens.enable: true`; rust smoke 8/8 after the fix.

**F9 disposition: stays a recorded finding.** The planned merge-by-
`source` has no stable discriminant: every pushed ITEM carries
`source:"rustc"` (flycheck), while the native stream's pushes are
EMPTY (no items, no source key) — an empty push cannot be attributed
to a stream, so slot-merging would preserve stale flycheck items
after a genuine clear (false positives worse than the timing artifact
being fixed). The harm is also transient and self-healing (~200 ms–2 s
convergence, already asserted honestly by the S3 dual-form contract).
No speculative store change was made — exactly the plan's honesty
c gate. The store's finding-fixes semantics (pull-preserves-push,
version monotonicity) are untouched.

## Final disposition ledger (ledger-followup-closure)

Authoritative current state for every retained finding and advisory.
Historical dispositions above are preserved verbatim as receipts of
what the then-current evidence showed; this table supersedes them
where they conflict. Each row names the identifier, original
observation, current scope, result, source evidence, and the next
action with its revisit condition.

| ID | Original observation | Current scope | Result | Source evidence | Next action / revisit trigger |
|---|---|---|---|---|---|
| F5 | `codeLens → []` from rust-analyzer (empty lens list) | rust-analyzer 1.95.0 + this client's initialize capabilities | **fixed** — client capability gap: Run/Debug lenses gated on `experimental.commands.commands` | investigation L3 probe B (real `▶︎ Run Tests` / `rust-analyzer.runSingle` lens) + L5; `3ebce14` advertises the commands; rust smoke S6 asserts a real rendered lens (`nonTrivial`) | none — reopen only if RA changes lens gating or a new RA version is smoke-tested |
| F8 | `codeAction → null` at rustc-error positions | rust-analyzer 1.95.0 + client caps | **fixed** — client capability gap: `handle_code_action` returns null without `codeActionLiteralSupport` and never reads `context.diagnostics` | investigation L2 upstream research + L3 probe B (`Generate undefined_helper function` at the original error position) + L5; `3ebce14` advertises the literal support; rust smoke S5 reaches the previewable preview path | none — same trigger as F5 |
| F9 | empty native push transiently clobbers rustc items at the same version | push diagnostics store; RA native + flycheck streams | **unresolved — server/protocol limitation, intentionally retained**; merge-by-source rejected (empty pushes carry no `source`, so slots cannot be attributed); harm is transient and self-healing (~0.2 s–2 s+ convergence) | T2 probe evidence (above); unit pins `dd4b08b` (same-version replace + version-advanced genuine clear, 15/15); timeline: genuine errors=0 clear at v=3 | none locally — revisit on protocol/stream-identity evidence (e.g. empty pushes gaining an attributable source) |
| S5 raw-dispose leak (pi-host-smoke finding) | raw `AgentSession.dispose()` never emits `session_shutdown`; one gopls + telemetry child outlive it (exit when the worker's stdio closes; no lasting leak) | raw SDK path only — NOT the production path | **recorded SDK limitation, no fix** — identical in devDependency 1.1.0 and host 1.2.0; production `AgentSessionRuntime.dispose()` emits `{reason:"quit"}`, and hardening S5 asserts owned gopls → 0 within 10 s (passed first green) | pi-host-smoke L2 finding; hardening H0 discovery + L2 (`886c415`) | none — revisit if the SDK changes raw dispose semantics or the fixture adopts raw sessions (tested: `@earendil-works/pi-coding-agent` 1.1.0 / host 1.2.0) |
| R3-001 (pi-host-smoke review, `pi-host.smoke.test.ts:372`) | reliability WARNING advisory | location predates the hardening slice's harness restructure (`886c415`) | **historical — prose unknown**: only id/lens/location/severity/disposition survived (session closure event); the original review remains approved; text unrecoverable | pi-host-smoke review record (`review-e7a90f5b816e346f`, burned `sha256:f50cec5f…`) | none — acting on an unknown recommendation would mean inventing prose |
| R3-001 + R4-001 (hardening review, both `pi-host.smoke.test.ts:247`) | reliability + resilience WARNING, session-registry teardown area; informational, non-blocking | current harness file; unchanged since the review | **open — deferred as separate later work per their receipts**; neither reopens the review | hardening review record (`review-f995e08839aff9db`, burned `sha256:3639776c…`) | revisit when `pi-host.smoke.test.ts` is next substantively edited |
| R3-001 (capability-fix review, `src/lsp/client.ts:233-235`) | CRITICAL reliability entry raised by the refuter | adjudicated inside the review | **refuted** — non-blocking per the closure statement; does not reopen | ra-capability-fix review record (`review-afe3535f790e5fa4`, burned `sha256:e9310f95…`) | none |
| render-budget readability (`preview/workspace-edit.ts:219` era) | char-budget arithmetic hard to read; no reproducible failure | intentionally deferred | **intentionally retained** — not a proven defect; below the RED→GREEN bar | T0 audit table (above) | revisit only with a deterministic failing case |
| stateless code-action index selection (`lsp-code-actions-tool.ts:105` era) | list-then-select index inherent to the stateless contract | intentionally deferred | **intentionally retained** — deterministic within one result sequence; documented via footer | T0 audit table (above) | revisit only if the list-then-select contract changes |
| prewarm session_start flake (`tests/unit/runtime/prewarm.test.ts:137`) | `expect(attempts).toBe(1)` after a single `setTimeout(0)` tick intermittently observes `0` | the unit test itself — reproduces in isolation and under full-suite parallel load | **newly observed test-infra timing flake — unresolved, deferred**: first observed during this slice's closure battery; test and source untouched since `60e1951`/`d62f17b` (prewarm era, long predating this branch); no product change involved | closure battery verbatim: full-suite 3× hunt = green / 1 failed / green (+ one earlier failure); focused 10× on the file alone = 9 green / 1 failed | fix in a separate authorized test-infra slice (replace the single tick with a bounded poll); revisit at the next touch of the prewarm test |

Closure notes:

- **Upstream reports: none warranted, none published.** F5/F8: the
  server behaved per its declared capabilities, so no upstream issue
  is warranted. The Run/Debug lens capability requirement is already
  documented upstream (rust-analyzer #18126, cited by investigation
  L2 research); no new issue was filed, and identifiers would be
  linked here only after an approved publication actually exists.
- **Versions pinned at closure:** rust-analyzer 1.95.0, gopls v0.23.0,
  `@earendil-works/pi-coding-agent` devDependency 1.1.0 (repo smoke)
  and host 1.2.0. Revisit triggers above are conditioned on these.
- **README:** checked for stale F5/F8/limitation claims — none found;
  the code-lens and code-action tool contracts remain accurate, so no
  README correction was needed in this slice.
- **Bare-suite battery (closure, verbatim):** full-suite 3× hunt =
  green / 1 failed / green (plus one earlier observed failure); focused
  stress on the flagged file alone = 9× green / 1 failed in 10; all
  three gated smokes deterministic green (gopls 8/8, rust-analyzer 8/8,
  pi-host 5/5) with 0 orphan processes; lint/typecheck/build/format
  clean. The single flaky unit test is dispositioned in the table
  above; docs closure is not gated on it.

## Verification commands

- `pnpm test` (bare — both smokes skip, no servers spawn)
- `GOPLS_SMOKE=1 pnpm vitest run tests/smoke`
- `RUST_ANALYZER_SMOKE=1 pnpm vitest run tests/smoke/rust-analyzer.smoke.test.ts`
- `pnpm lint && pnpm typecheck && pnpm build && pnpm format:check`

## Non-goals

Layer-2 Pi-host smoke; push; recorded non-goals (config hot-reload,
half-open session recovery, incremental document sync, subtree trust,
`codeLens/resolve`, `typeHierarchy/resolve`); changing
rust-analyzer-side behavior for F5; merging this slice (user decides).

## Log

- L1 (plan): scope settled with user — full ledger scope (F9 + F8 +
  both smoke advisories + F5 probe), audit-first with trivial-live
  fixes in-slice, one branch `feature/hardening-ledger` with
  work-unit commits. PATH resolution verified for both servers
  (`gopls` v0.23.0, `rust-analyzer` 1.95.0) before committing to the
  bin-default flip.
- L2 (T0 audit): classification table above. Honest outcome: the
  advisory tail is retired by later rework; NO live item met the
  RED→GREEN bar, so T0 stayed docs-only (no speculative "fixes").
  Reviewer prose was not preserved for most historical items, so
  classification is by pattern family against current source.
- L3 (T2/T3 probe dispositions): two instruments (replicated-protocol
  standalone probe + temporary real-stack harness test, both deleted
  after capture). All three findings land server-side or stay
  recorded: F8 `result=null` for every context variant; F5 zero
  lenses under valid settings in both shapes; F9 no stable
  discriminant (empty native pushes; items all `rustc`) → honesty
  gate fires, no store merge. Bonus harness fix: the smoke's
  `checkOnSave` map shape was silently rejected by RA 1.95 —
  corrected to `check` (+ `lens.enable`); rust smoke 8/8 after.
  No product (src/) change in this slice.

- L4 (T4 closure): battery on final content — bare `pnpm test`
  **506 passed | 16 skipped** (49 files; both smokes skip), lint,
  typecheck, build, `format:check` all clean, **gopls smoke 8/8**
  (PATH-default binary), **rust-analyzer smoke 8/8** (PATH-default
  binary + corrected settings shape), tree clean. README unchanged —
  no product behavior changed in this slice. Branch:
  `c2bb060` plan → `811c731` audit → `0ff03f9` smoke hygiene →
  `40720e5` settings fix + dispositions (4 commits over main
  `dd4fa97`).

## Review record

- Post-implementation assess (committed range, base
  `dd4fa97fcd6ae28dc370d4ede29244954ab531d9`): **medium risk**
  (`executable_change`: tests/smoke/gopls.smoke.test.ts), 3 paths /
  265 lines, **reviewDue: false (`under_budget`)** — writer
  self-verification stands (workers' verbatim outcomes + parent
  spot-checks + full battery both smokes). No native review started
  per entry rule; if a later reminder claims this target, the tight
  base above applies.
- RDD reminder (target `sha256:0a6e95e5…`) later claimed the slice:
  **APPROVED — ZERO findings, no advisories** — lineage
  `review-c527e94ae95b35dd`, medium (`executable_change`:
  tests/smoke/gopls.smoke.test.ts), `review-reliability` lens, 3
  paths / 282 lines, correction budget 141, tight base
  `dd4fa97fcd6…` (committedOnly). Reviewer forecast (1 host-relay
  run) acknowledged; approved on the last admitted event;
  acknowledgement burned (consumed revision `sha256:4b13d5cd…`).
  Delivery: ordinary repository policy.
