# Feature: advisory-cleanup

## Objective

Address the 13 advisory (non-blocking) findings recorded by the four approved
native reviews. Targeted robustness/readability fixes only — no redesigns.

## Advisory inventory (id, location, lens, severity)

1. CF R3-001 — src/workspace/match.ts:23 — reliability — WARNING
2. CI R4-001 — src/cli/generate.ts:105-107 — resilience — WARNING
3. CI R3-002 — src/cli/generate.ts:106-108 — reliability — WARNING
4. CI R1-001 — src/cli/generate.ts:107 — risk — WARNING
5. CI R3-001 — src/cli/executables.ts:5-9 — reliability — WARNING
6. CI R2-001 — src/cli/commands/add.ts:28 — readability — SUGGESTION
7. TG R3-001 — src/runtime/authorization.ts:3 — reliability — WARNING
8. TG R3-002 — src/runtime/trust-store.ts:55-56 — reliability — WARNING
9. RS R2-001 — src/runtime/session.ts:27-28 — readability — WARNING
10. RS R4-002 — src/runtime/session.ts:76-99 — resilience — WARNING
11. RS R3-001 — src/runtime/activation.ts:100-113 — reliability — WARNING
12. RS R4-001 — src/lsp/client.ts:94-104 — resilience — WARNING
13. RS R2-002 — src/lsp/documents.ts:8-12 — readability — SUGGESTION

(Original closure envelopes carried location+severity only; the worker
diagnoses each site by lens intent and reports the mapping. Any advisory
whose safe fix would be a redesign stays unchanged and reported.)

## Task

### T1 — Sweep all 13 advisories [done]
- [x] RED→GREEN fixes (4): CI R4-001+R3-002+R1-001 generate.ts write path
      (fsync temp before rename + temp cleanup on failure); CI R3-001
      executables.ts (non-string PATH guard); RS R4-002 session.ts
      (Promise.allSettled disposal — one rejection no longer starves siblings)
- [x] Left unchanged with reasons (9): CF R3-001 match.ts (validation+
      normalization already bound inputs); CI R2-001 add.ts:28 (no clear
      minimal correction); TG R3-001 authorization.ts:3 (canonical contract
      documented+enforced); TG R3-002 trust-store.ts:55-56 (fallback narrowing
      = behavior change without deterministic test); RS R2-001 session.ts:27-28
      (naming change would alter interface); RS R3-001 activation.ts:100-113
      (timer+waiter cleanup verified present); RS R4-001 client.ts:94-104
      (timeout = new policy decision, not a fix); RS R2-002 documents.ts:8-12
      (rationale already documented)
- [x] Checks: typecheck, lint, test (122 passing: 119 + 3 regression), build

## Constraints

- Behavior-preserving except targeted robustness improvements at the exact
  flagged sites; test-first for any behavior change; no new dependencies.
- Branch feat/advisory-cleanup off main (f4aef93). RDD on: assess per
  commit, review at close. Push/PR/merge user decisions.

## Progress log

- 2026-10-02: feature opened before first write; inventory compiled from the
  four feature documents' Follow-ups sections.
