# Local database verification

All commands here target a disposable localhost database. Do not point integration tests at a hosted project. Tests reject HTTP and PostgreSQL endpoints whose hostname is not `localhost`, `127.0.0.1`, or `[::1]`. No remote project has been created or changed.

## Reproduce

Requires Node 24+, dependencies from `npm ci`, and Docker access. Run from the repository root:

```sh
node scripts/test-db-local.mjs start
node scripts/test-db-local.mjs migrate
npm run test:db
```

The harness writes `/tmp/slime-trial-db/public.env`, containing only local public Auth/API client configuration. Integration tests load its public key automatically; explicit `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, and `SUPABASE_TEST_DB_URL` variables can select another **local** Supabase instance. A browser dev server can use:

```sh
set -a
. /tmp/slime-trial-db/public.env
set +a
npm run dev
```

The harness does not modify repository `.env` files. Its fixed signing secret and PostgreSQL passwords are disposable local fixtures, never real project credentials. The signing secret stays in the Node harness and Docker server configuration, and is not a Vite environment variable. Only the public `anon` JWT goes to the browser. The test gateway omits production API-key enforcement; Auth JWT signature/role checks and database RLS are real. Never deploy this harness.

`node scripts/test-db-local.mjs reset` drops **only this local harness's public/private application schemas**, reapplies both migrations, and clears ballots. Do not run it concurrently with browser tests. `node scripts/test-db-local.mjs stop` removes this task's four named containers, their anonymous volumes, and its Docker network. A second `start` with existing container names intentionally fails instead of replacing an existing database.

## Runtime and migration evidence

Supabase CLI **2.122.0** was inspected using `--version`, top-level help, and command-specific help. Both files were generated with the required CLI commands:

```sh
supabase migration new trial_schema
supabase migration new trial_submit
```

The full CLI stack was attempted first. Pulling `supabase/postgres:17.11.0.006` failed with `failed to register layer: no space left on device` under the managed Docker `vfs` driver. The working harness uses stock **PostgreSQL 17.11** (digest-pinned `postgres:17-alpine`), official Supabase **GoTrue v2.197.0**, **PostgREST v16.5**, and **Kong 2.8.1**. Auth creates actual anonymous users and issues JWTs; PostgREST validates the JWT and changes database role. This is a reduced local Supabase service stack, not a complete CLI-stack verification.

Both migration files applied successfully, the application schemas were dropped and reapplied successfully, and the same tests passed again. The CLI recorded the applied local migration history and listed both versions. Local CLI advisors ran successfully with `--db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --type all --level warn --fail-on warn`: **no issues found**. Version foreign keys have covering indexes. The two private tables intentionally have RLS and no policies (default client denial); the INFO-level advisor describes this expected configuration.

## Access and submission design

Public `content_versions` and `aggregate_snapshots` permit SELECT for `anon` and `authenticated`; `ballots` permits SELECT only for `authenticated` with non-null `auth.uid() = participant_id`. No client has direct INSERT, UPDATE, DELETE, or other DML privileges on any application table. `private` is excluded from the Data API schema list.

`public.submit_ballot(text,jsonb,uuid,bigint)` is a SQL `SECURITY INVOKER` forwarding function. `private.apply_ballot` is the only elevated client-callable function: `SECURITY DEFINER`, owned by `postgres`, fixed `search_path = pg_catalog`, fully qualified application references, explicit non-null `auth.uid()` validation. Its owner intentionally bypasses table RLS and can atomically update ballots, aggregates, replay records, and rate records. PUBLIC/anon have no EXECUTE on either function. Authenticated receives only the schema USAGE and function EXECUTE needed for the call, alongside the SELECT grants described above. Helper functions have no client EXECUTE.

Submissions lock the version's aggregate row first, then read the caller's ballot and replay record. The wire format is a 20-element `{caseId, score}` array; validation rejects missing/extra/duplicate/unknown IDs and non-integer, zero, string, null, or out-of-range scores. Scores and ten axes are recomputed on the server. A replacement subtracts the old contributions and adds the new contributions in the same transaction. Every integer aggregate and revision is returned as a decimal string. Timestamps are UTC ISO 8601 with milliseconds.

The replay hash covers normalized answers. Identical request IDs consume no additional operation allowance and return a current snapshot only if the saved ballot revision remains current. A newer ballot causes `STALE_REVISION`; a changed payload causes `REQUEST_ID_REUSED`. A new unchanged submission consumes one operation, records replay protection, and leaves ballot/aggregate revisions unchanged. Limits allow ten new successful operations per anonymous identity in a rolling 60-second window, across versions. Failed transactions consume no operation allowance.

## Verified and remaining scope

The integration suite verifies empty snapshots, owner-only reads, all direct DML denials, private API invisibility, function privilege metadata, first/replacement/second-person votes, unchanged submissions, retries, stale and reused request IDs, invalid inputs, version mismatches, the shared TypeScript scoring fixtures, rate limits including window expiry, simultaneous changes, and injected failures after ballot update. Every case distribution and verdict distribution is checked against the vote count after concurrent writes.

Realtime is not running in this reduced stack. Frontend fallback polling can be exercised here; live Realtime delivery cannot. Mobile Safari, production CAPTCHA and Auth abuse settings, hosted-project configuration, and production load remain separate release checks. `supabase/config.toml` enables anonymous Auth locally and increases the local anonymous signup allowance for automated tests; production must explicitly configure CAPTCHA and suitable Auth limits. The RPC's per-identity rolling operation limit remains active during tests. Public content/scoring versions are fixed and client read-only; meaningful changes require a new version and matching scoring implementation/migration.
