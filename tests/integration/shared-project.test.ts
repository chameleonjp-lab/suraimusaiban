import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "./helpers";

it("installing this game's schema preserves another game's private schema access", async () => {
  const db = await sql();
  try {
    await db.query("begin");
    await db.query(
      "create schema if not exists private; create table private.other_game_fixture(value text); insert into private.other_game_fixture values ('keep'); grant usage on schema private to anon, authenticated",
    );
    await db.query(
      "drop table public.slime_trial_ballots, public.slime_trial_aggregate_snapshots, public.slime_trial_content_versions cascade; drop schema slime_trial_private cascade",
    );
    await db.query(
      readFileSync(
        "supabase/migrations/20261023125449_trial_schema.sql",
        "utf8",
      ),
    );
    const result = await db.query(
      "select has_schema_privilege('anon','private','usage') as anon, has_schema_privilege('authenticated','private','usage') as authenticated, (select value from private.other_game_fixture) as value",
    );
    expect(result.rows[0]).toEqual({
      anon: true,
      authenticated: true,
      value: "keep",
    });
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
