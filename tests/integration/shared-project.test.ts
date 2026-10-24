import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "./helpers";

it("migration preserves published totals, shared private permissions and other game data", async () => {
  const db=await sql();
  try {
    await db.query("begin");
    await db.query("create schema if not exists private; create table private.other_game_fixture(value text); insert into private.other_game_fixture values('keep'); grant usage on schema private to anon,authenticated; grant select on private.other_game_fixture to anon,authenticated");
    const existing = await db.query("select to_regclass('public.slime_trial_ballots') as name");
    if (!existing.rows[0].name) {
      await db.query("drop function if exists public.slime_trial_collect_response(text,jsonb,uuid,text,text,text); drop function if exists public.slime_trial_cleanup_requests(); drop schema slime_trial_private cascade; drop table public.slime_trial_aggregate_snapshots,public.slime_trial_content_versions cascade");
      await db.query(readFileSync("supabase/migrations/20261023125449_trial_schema.sql","utf8"));
      await db.query(readFileSync("supabase/migrations/20261023125450_trial_submit.sql","utf8"));
    }
    // A previous public snapshot is the trusted aggregate baseline. Migration must not recompute or erase it.
    await db.query("update public.slime_trial_aggregate_snapshots set revision=37,payload=jsonb_set(jsonb_set(payload,'{count}','\"37\"'),'{revision}','\"37\"')");
    const before=(await db.query("select * from public.slime_trial_aggregate_snapshots")).rows;
    await db.query(readFileSync("supabase/migrations/20261024205153_slime_trial_anonymous_aggregate.sql","utf8"));
    expect((await db.query("select * from public.slime_trial_aggregate_snapshots")).rows).toEqual(before);
    expect((await db.query("select payload from slime_trial_private.aggregate_totals")).rows[0].payload).toEqual(before[0].payload);
    expect((await db.query("select has_schema_privilege('anon','private','usage') as anon,has_schema_privilege('authenticated','private','usage') as authenticated,has_table_privilege('anon','private.other_game_fixture','select') as reads,(select value from private.other_game_fixture) as value")).rows[0]).toEqual({anon:true,authenticated:true,reads:true,value:"keep"});
    expect((await db.query("select to_regclass('public.slime_trial_ballots') as name")).rows[0].name).toBeNull();
  } finally { await db.query("rollback"); await db.end(); }
});
