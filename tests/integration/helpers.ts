import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
const localEnvPath='/tmp/slime-trial-db/public.env';
const localEnv=existsSync(localEnvPath) ? Object.fromEntries(readFileSync(localEnvPath,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];})) : {};
export const url = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
export const key = process.env.SUPABASE_TEST_ANON_KEY ?? localEnv.SUPABASE_TEST_ANON_KEY ?? '';
const dbUrl = process.env.SUPABASE_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
for (const address of [url, dbUrl]) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname)) throw new Error('Database tests are LOCAL ONLY');
}
export const ids = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0')).flatMap(s => [`H${s}`, `K${s}`]);
export const answers = (score = 5) => Object.fromEntries(ids.map(id => [id, score]));
export const wire = (values: Record<string, number>) => Object.entries(values).map(([caseId, score]) => ({ caseId, score }));
export async function sql() { const client = new Client({ connectionString: dbUrl }); await client.connect(); return client; }
export function browser() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
export async function participant() { const client = browser(); const { data, error } = await client.auth.signInAnonymously(); if (error) throw error; return { client, id: data.user!.id }; }
export async function submit(client: ReturnType<typeof browser>, values = answers(), revision = '0', requestId = randomUUID(), version = 'v1') {
  return client.rpc('submit_ballot', { p_version: version, p_answers: wire(values), p_request_id: requestId, p_expected_revision: revision });
}
export async function reset() {
  const c = await sql();
  try { await c.query('truncate public.ballots, private.submissions, private.submit_limits'); await c.query("update public.aggregate_snapshots set revision=0, updated_at=now(), payload=private.empty_snapshot(version)"); }
  finally { await c.end(); }
}
export async function snapshot() { const { data, error } = await browser().from('aggregate_snapshots').select('payload').eq('version', 'v1').single(); if (error) throw error; return data.payload; }
export async function roleQuery(role: 'anon' | 'authenticated', id: string | null, statement: string, params: unknown[] = []) {
  const c = await sql();
  try { await c.query('begin'); await c.query(`set local role ${role}`); await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [id ?? '', JSON.stringify({ sub: id, role, is_anonymous: true })]); return await c.query(statement, params); }
  finally { await c.query('rollback'); await c.end(); }
}
