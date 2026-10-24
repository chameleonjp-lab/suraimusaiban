import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
const localEnvPath = "/tmp/slime-trial-db/public.env";
const localEnv = existsSync(localEnvPath)
  ? Object.fromEntries(readFileSync(localEnvPath, "utf8").trim().split("\n").map((line) => {
      const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)];
    })) : {};
export const url = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:54321";
export const key = process.env.SUPABASE_TEST_ANON_KEY ?? localEnv.SUPABASE_TEST_ANON_KEY ?? "";
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
for (const address of [url, dbUrl]) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname)) throw new Error("Database tests are LOCAL ONLY");
}
export const ids = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0")).flatMap((s) => [`H${s}`, `K${s}`]);
export const answers = (score = 5) => Object.fromEntries(ids.map((id) => [id, score]));
export const wire = (values: Record<string, number>) => Object.entries(values).map(([caseId, score]) => ({ caseId, score }));
export const sourceKey = (value = 1) => value.toString(16).padStart(64, "0");
export async function sql() { const client = new Client({ connectionString: dbUrl }); await client.connect(); return client; }
export function browser() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
// SQL's local service role exercises the real permission boundary without creating Auth users.
export async function collect(p_answers: unknown = wire(answers()), requestId: string | null = randomUUID(), source: string | null = sourceKey(), version: string | null = "v1", previousSource: string | null = null, nextSource: string | null = null) {
  const c = await sql();
  try {
    await c.query("begin"); await c.query("set local role service_role");
    const args: unknown[] = [version, JSON.stringify(p_answers), requestId, source];
    if (previousSource !== null || nextSource !== null) args.push(previousSource);
    if (nextSource !== null) args.push(nextSource);
    const optionalArgs = nextSource !== null ? ",$5,$6" : previousSource !== null ? ",$5" : "";
    const { rows } = await c.query(`select public.slime_trial_collect_response($1,$2::jsonb,$3::uuid,$4${optionalArgs}) as result`, args);
    await c.query("commit");
    return { data: rows[0].result, error: null };
  } catch (error) {
    await c.query("rollback");
    return { data: null, error: error as Error };
  } finally { await c.end(); }
}
export async function submit(values = answers(), requestId = randomUUID(), source = sourceKey(), version = "v1", previousSource: string | null = null, nextSource: string | null = null) { return collect(wire(values), requestId, source, version, previousSource, nextSource); }
export async function reset() {
  const c = await sql();
  try {
    const migrated = (await c.query("select to_regclass('slime_trial_private.aggregate_totals') as name")).rows[0].name;
    if (migrated) {
      await c.query("truncate slime_trial_private.request_receipts, slime_trial_private.request_limits");
      await c.query("update slime_trial_private.aggregate_totals set revision=0,pending_count=0,updated_at=now(),payload=slime_trial_private.empty_snapshot(version)");
    } else { await c.query("truncate public.slime_trial_ballots,slime_trial_private.submissions,slime_trial_private.submit_limits"); }
    await c.query("update public.slime_trial_content_versions set active=(id='v1')");
    await c.query("update public.slime_trial_aggregate_snapshots set revision=0,updated_at=now(),payload=slime_trial_private.empty_snapshot(version)");
  } finally { await c.end(); }
}
export async function snapshot() {
  const { data, error } = await browser().from("slime_trial_aggregate_snapshots").select("payload").eq("version", "v1").single();
  if (error) throw error; return data.payload;
}
export async function internalSnapshot() { const c = await sql(); try { return (await c.query("select payload from slime_trial_private.aggregate_totals where version='v1'")).rows[0].payload; } finally { await c.end(); } }
export async function roleQuery(role: "anon" | "authenticated" | "service_role", id: string | null, statement: string, params: unknown[] = []) {
  const c = await sql();
  try { await c.query("begin"); await c.query(`set local role ${role}`); await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id ?? "", JSON.stringify({ sub: id, role })]); return await c.query(statement, params); }
  finally { await c.query("rollback"); await c.end(); }
}
