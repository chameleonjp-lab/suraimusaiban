import { beforeEach, describe, expect, it } from "vitest";
import { browser, reset, roleQuery, snapshot, sql, submit, wire, answers, sourceKey } from "./helpers";
describe("aggregate privacy boundary", () => {
  beforeEach(reset);
  it("allows public complete zero snapshots without Auth", async () => {
    const s = await snapshot();
    expect(s.count).toBe("0"); expect(s.revision).toBe("0"); expect(s.scoreSum).toBe("0");
    expect(Object.keys(s.caseCounts)).toHaveLength(20); expect(Object.keys(s.axisSums)).toHaveLength(10); expect(Object.keys(s.verdictCounts)).toHaveLength(11);
    expect((await browser().auth.getSession()).data.session).toBeNull();
  });
  it("allows only service ingestion and denies public DML or private reads", async () => {
    expect((await submit()).error).toBeNull();
    for (const role of ["anon", "authenticated"] as const) {
      await expect(roleQuery(role, null, "select public.slime_trial_collect_response($1,$2,$3,$4)", ["v1", JSON.stringify(wire(answers())), crypto.randomUUID(), sourceKey()])).rejects.toThrow(/permission denied/);
      await expect(roleQuery(role, null, "select public.slime_trial_collect_response($1,$2,$3,$4,$5)", ["v1", JSON.stringify(wire(answers())), crypto.randomUUID(), sourceKey(), sourceKey(2)])).rejects.toThrow(/permission denied/);
      await expect(roleQuery(role, null, "select public.slime_trial_collect_response($1,$2,$3,$4,$5,$6)", ["v1", JSON.stringify(wire(answers())), crypto.randomUUID(), sourceKey(), sourceKey(2), sourceKey(3)])).rejects.toThrow(/permission denied/);
      await expect(roleQuery(role, null, "select public.slime_trial_cleanup_requests()")).rejects.toThrow(/permission denied/);
      for (const table of ["aggregate_totals", "request_receipts", "request_limits"]) {
        await expect(roleQuery(role, null, `select * from slime_trial_private.${table}`)).rejects.toThrow(/permission denied/);
        await expect(roleQuery(role, null, `delete from slime_trial_private.${table}`)).rejects.toThrow(/permission denied/);
      }
      for (const table of ["slime_trial_content_versions", "slime_trial_aggregate_snapshots"]) {
        expect((await roleQuery(role, null, `select * from public.${table}`)).rows.length).toBeGreaterThan(0);
        for (const statement of [`insert into public.${table} default values`, `delete from public.${table}`, `update public.${table} set ${table.endsWith("snapshots") ? "revision=revision" : "active=active"}`]) {
          await expect(roleQuery(role, null, statement)).rejects.toThrow(/permission denied/);
        }
      }
    }
  });
  it("removes personal rows and legacy RPCs; ephemeral receipts retain only random UUID and time", async () => {
    const c = await sql();
    try {
      for (const name of ["public.slime_trial_ballots", "slime_trial_private.submissions", "slime_trial_private.submit_limits"]) expect((await c.query("select to_regclass($1) as oid", [name])).rows[0].oid).toBeNull();
      for (const name of ["public.slime_trial_submit_ballot(text,jsonb,uuid,bigint)", "slime_trial_private.apply_ballot(text,jsonb,uuid,bigint)"]) expect((await c.query("select to_regprocedure($1) as oid", [name])).rows[0].oid).toBeNull();
      const columns = (await c.query("select column_name from information_schema.columns where table_schema='slime_trial_private' and table_name='request_receipts' order by ordinal_position")).rows.map(r => r.column_name);
      expect(columns).toEqual(["request_id", "created_at"]);
      const tables = (await c.query("select tablename,rowsecurity from pg_tables where schemaname='slime_trial_private' order by tablename")).rows;
      expect(tables.map(r => r.tablename)).toEqual(["aggregate_totals", "request_limits", "request_receipts"]);
      expect(tables.every(r => r.rowsecurity)).toBe(true);
      const functions = (await c.query("select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('slime_trial_collect_response','collect_response','slime_trial_cleanup_requests','cleanup_requests')")).rows;
      expect(functions).toHaveLength(4);
      expect(functions.every(r => r.proconfig.includes("search_path=pg_catalog"))).toBe(true);
      expect(functions.filter(r => r.prosecdef).every(r => r.nspname === "slime_trial_private")).toBe(true);
    } finally { await c.end(); }
  });
});
