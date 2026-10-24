# Anonymous Aggregate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Remove persistent identity and personal answer history; append anonymous responses into aggregate-only storage and publish the game.

**Architecture:** Browser state stays in memory. A public Edge Function validates and rate-limits submission through a service-only SQL RPC. Private totals publish a safe snapshot every 10 responses; no raw answer or per-person row is retained.

**Tech Stack:** Existing TypeScript/Vite/Three.js, Supabase Postgres/Edge Functions/Realtime, Vitest/Playwright, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-24-anonymous-aggregate-design.md`

## Global Constraints

- Scope is this game's objects only; preserve existing ranking objects and published aggregate count.
- No Supabase Auth, participant IDs, individual ballots, durable browser state, or recovery API.
- Current answers in memory only. Manual X/PNG share uses only the current result.
- Payload: `{version,requestId,answers:[{caseId,score},...20]}`. Edge success: `{accepted:true,duplicate:boolean,snapshot:Snapshot}`; snapshot is public only.
- DB entrypoint: `public.slime_trial_collect_response(p_version text,p_answers jsonb,p_request_id uuid,p_source_key text,p_previous_source_key text default null,p_next_source_key text default null)`, service_role only. Edge sends current/previous/next hourly epochs so rolling limits survive rotation and arrival reordering.
- Internal aggregate table `slime_trial_private.aggregate_totals`; receipts `request_receipts` contain UUID/time only; limits `request_limits` contain short-lived HMAC counters only.
- 10-response batches; network 30 accepted requests/600 seconds; global 120/60 seconds; replayed request ID not counted again within 24 hours.
- The server scores validated answers; no client totals are trusted. Keep migration history, add a migration.
- Shared hosting credentials stay in Edge environment. No secrets in VITE values, public config, logs, or artifacts.

## Review Focus

- A retry after response loss and two simultaneous copies count only once.
- Public SELECT, Realtime and submit responses never expose the partial unpublished batch.
- Reload/navigation/bfcache do not restore answers/results from memory or legacy storage.
- Network/DB failure and limits retain only the current pending request; they never create a fresh request ID implicitly.
- Switching away from trial during an in-flight request cannot display the departed result or submit again.

### Task 1: Database and privacy boundary

Files: new `supabase/migrations/20261024205153_slime_trial_anonymous_aggregate.sql`; `tests/integration/*`.

- [ ] Write failing tests for service-only collect RPC, no personal tables, preserved totals, append-only scoring, replay/concurrency, 10-item batches, invalid inputs, rates, cleanup, existing schema permissions.
- [ ] Run on local DB and observe missing new behavior failures.
- [ ] Implement new migration. Revoke/remove legacy identity tables/RPC; add private totals/ephemeral receipt+limit tables; expose only public batched snapshots. Add service-only cleanup callable by cron where available.
- [ ] Run DB suite, scoring fixtures and concurrency checks. Record any harness work needed for root.

### Task 2: Public Edge gate

Files: `supabase/functions/slime-trial-submit/{index.ts,handler.ts}`, `tests/unit/edge-submit.test.ts`.

- [ ] Test method/CORS/key/body limits, strict validation, no leaked secret/error details, network key rotation and public response contract before implementation.
- [ ] Implement injectable Request/Response handler and thin Deno entrypoint. Read configured project public/secret keys from built-in env. POST validated body to service-only RPC with timeout. Never log incoming body or IP.
- [ ] Run focused unit tests and report exact deployment file set/environment requirements.

### Task 3: Anonymous, memory-only browser flow

Files: `src/domain/types.ts`, `src/app.ts`, `src/features/{trial,vote,results,status,share}/*`, `src/platform/*`, related unit tests.

- [ ] Replace participant/ballot/revision contracts with `SubmitRequest={version,answers,requestId}`; keep local-only `Ballot` for current receipt if it avoids disrupting result/chart rendering, with no identity/revision requirement. Define client `SubmitReceipt` containing local answers plus public Snapshot only.
- [ ] Add tests for fresh in-memory trial, no restored identity/drafts, same-request retry, and zero-public-count result display before changing code.
- [ ] Remove participant service, own-ballot reads, persistent draft/result stores and Auth paths. Purge only old game-prefixed local/session keys on start.
- [ ] Submit via Edge, build current receipt locally, show last public aggregate or pending-batch message. Use 回答数/回答回数 everywhere; no replacement/recovery language.
- [ ] Keep current X/PNG export and 3D/accessibility behavior. Run related unit tests and typecheck; coordinate any shared-interface changes explicitly.

### Task 4: Integration, CI and publication

Files: local harness, E2E suite, CI/Pages workflows, production browser checker, operation/QA docs.

- [ ] Wire the real Edge handler into a loopback local HTTP test service that uses local service JWT (server side only). Do not put service credentials in public.env or Vite.
- [ ] Update E2E for append counts, no Auth/storage/recovery, batch visibility, retry, errors, X/PNG and existing scene/accessibility.
- [ ] Update production checker to verify anonymous Auth is unnecessary; use a non-mutating gate rejection and public aggregate read in CI/Pages readiness.
- [ ] Run full type/unit/DB/build/publication/doc/browser checks; fresh independent security/spec review and fixes.
- [ ] Apply reviewed migration to hosted project, schedule cleanup, deploy only `slime-trial-submit`, verify permissions/API/batches without retaining test responses in production.
- [ ] Create PR, wait for CI, merge, wait for Pages. Verify public SHA, social image, no Auth calls, public aggregate and gate. Report residual risks and separate existing shared DB issue.
