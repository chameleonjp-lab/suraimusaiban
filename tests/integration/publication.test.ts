import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "./helpers";
const migration = readFileSync(
  "supabase/migrations/20261023131952_trial_realtime.sql",
  "utf8",
);

describe("optional Realtime publication migration (metadata only)", () => {
  it("adds only aggregate_snapshots to an existing publication and is idempotent", async () => {
    const c = await sql();
    try {
      await c.query("begin");
      const existing = await c.query(
        "select 1 from pg_catalog.pg_publication where pubname='supabase_realtime'",
      );
      if (!existing.rowCount)
        await c.query("create publication supabase_realtime");
      const membership = async () =>
        (
          await c.query(
            "select schemaname || '.' || tablename as name from pg_catalog.pg_publication_tables where pubname='supabase_realtime' order by name",
          )
        ).rows.map((row) => row.name as string);
      // Exercise the add path even when the migration already ran in a full
      // Supabase stack. Rollback restores this table's original membership.
      if ((await membership()).includes("public.aggregate_snapshots"))
        await c.query(
          "alter publication supabase_realtime drop table public.aggregate_snapshots",
        );
      const before = await membership();
      expect(before).not.toContain("public.aggregate_snapshots");
      await c.query(migration);
      const first = await membership();
      expect(first).toContain("public.aggregate_snapshots");
      expect(first.filter((name) => !before.includes(name))).toEqual([
        "public.aggregate_snapshots",
      ]);
      await c.query(migration);
      expect(await membership()).toEqual(first);
    } finally {
      await c.query("rollback");
      await c.end();
    }
  });
  it("does nothing when the publication is absent", async () => {
    const c = await sql();
    try {
      await c.query("begin");
      const existing = await c.query(
        "select 1 from pg_catalog.pg_publication where pubname='supabase_realtime'",
      );
      // Transaction rollback restores any existing publication; other sessions do
      // not see this uncommitted fixture rename. No vote/aggregate rows change.
      if (existing.rowCount)
        await c.query(
          `alter publication supabase_realtime rename to "slime_trial_${randomUUID().replaceAll("-", "")}"`,
        );
      await c.query(migration);
      expect(
        (
          await c.query(
            "select 1 from pg_catalog.pg_publication where pubname='supabase_realtime'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await c.query("rollback");
      await c.end();
    }
  });
});
