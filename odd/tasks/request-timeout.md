# Feature: request-timeout

## Objective

Implement the approved request-timeout policy: bounded outbound LSP requests,
typed timeout errors, retry with 60s cooldown and circuit-break after 3
consecutive failures, and safe handling of server-initiated requests.

## Authority (user-approved plan, this session)

- request() default timeout 10s; initialize 15s; both injectable via
  ClientOptions for deterministic tests; new error kind "timeout".
- Timed-out initialize disposes the child AND clears the cached
  initialization promise so a later ensure() can retry (today a hang is
  permanent for the session).
- Retry policy (user decision): 60s cooldown between restart attempts;
  3 consecutive failures → server disabled for the session; honest
  per-server failure lines.
- Server→client requests: window/showMessageRequest → decline (server
  messages never auto-authorize builds — recorded ReScript decision);
  workspace/applyEdit → decline v1; client/registerCapability → ack;
  workspace/configuration → configured settings. Verify default
  MethodNotFound behavior first; explicit handlers where needed.
- No schema/config exposure in v1; no edit-waitMs changes; no new deps.

## Checklist

### T1 — Bounded requests (test-first) [done]
- [x] RED observed (hang test hit test timeout); GREEN: withTimeout,
      ClientOptions {initializeTimeoutMs 15000, requestTimeoutMs 10000},
      kind:"timeout" naming method+budget, connection usable after abandoned
      request, initialize failure disposes child AND clears cached promise;
      fixture FAKE_HANG_INITIALIZE + FAKE_HANG_METHOD; same-client post-failure
      ensure → disposed (retry lives at session layer, T2)
- [x] Checks: typecheck, lint, test (124 passing), build
- [ ] withTimeout; ClientOptions timeoutMs fields; kind:"timeout"; initialize
      bound; cached-promise clearing on failure; fixture FAKE_HANG_INITIALIZE
- Route: delegated.

### T2 — Cooldown + circuit-break (test-first) [done]
- [x] RED observed; GREEN: session retry policy — injectable
      {retryCooldownMs 60000, maxConsecutiveStartFailures 3} + clock;
      per-pool-key failure state; in-cooldown → no spawn + retry-countdown
      line; disabled-for-session after max; success resets; failed clients
      removed+disposed from pool; reasons flow through activation verbatim;
      fixture integration proves no second spawn during cooldown
- [x] Checks: typecheck, lint, test (128 passing), build
- [ ] Session failure state per pool key; 60s cooldown; disable after 3;
      failure lines flow through activation; injectable constants
- Route: delegated.

### T3 — Safe server-initiated request handlers (test-first) [pending]
- [ ] Verify default; explicit decline/ack/configuration handlers; README note
- Route: delegated.

## Constraints

- Baseline 122 tests / 25 files green; zero regressions.
- Branch feat/request-timeout off main (54374b5). RDD on: assess per commit,
  review at close. Merge to main per standing user preference after approval.

## Progress log

- 2026-10-02: plan approved (cooldown + circuit-break chosen); feature opened
  before first write.
