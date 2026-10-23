import { beforeEach, describe, expect, it } from "vitest";
import {
  answers,
  browser,
  participant,
  reset,
  roleQuery,
  snapshot,
  sql,
  submit,
} from "./helpers";
describe("local Supabase access", () => {
  beforeEach(reset);
  it("publishes a complete zero snapshot without creating an anonymous user", async () => {
    const s = await snapshot();
    expect(s.count).toBe("0");
    expect(s.scoreSum).toBe("0");
    expect(s.revision).toBe("0");
    expect(Object.keys(s.caseCounts)).toHaveLength(20);
    expect(Object.keys(s.axisSums)).toHaveLength(10);
    expect(Object.keys(s.verdictCounts)).toHaveLength(11);
    expect(
      Object.values(s.caseCounts)
        .flatMap((c) => Object.values(c as object))
        .every((n) => n === "0"),
    ).toBe(true);
    expect(Object.values(s.axisSums).every((n) => n === "0")).toBe(true);
    expect(Object.values(s.verdictCounts).every((n) => n === "0")).toBe(true);
    expect((await browser().auth.getSession()).data.session).toBeNull();
  });
  it("denies unauthenticated ballot reads and A reading B; owner can select", async () => {
    const a = await participant(),
      b = await participant();
    expect((await submit(a.client)).error).toBeNull();
    expect((await browser().from("slime_trial_ballots").select("*")).error).not.toBeNull();
    expect(
      (await b.client.from("slime_trial_ballots").select("*").eq("participant_id", a.id))
        .data,
    ).toEqual([]);
    expect((await a.client.from("slime_trial_ballots").select("*")).data).toHaveLength(1);
  });
  it("authenticated_rpc_succeeds_direct_dml_denied", async () => {
    const a = await participant();
    expect((await submit(a.client)).error).toBeNull();
    for (const table of [
      "public.slime_trial_ballots",
      "public.slime_trial_aggregate_snapshots",
      "slime_trial_private.submissions",
      "slime_trial_private.submit_limits",
    ]) {
      await expect(
        roleQuery("authenticated", a.id, `insert into ${table} default values`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        roleQuery("authenticated", a.id, `delete from ${table}`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        roleQuery(
          "authenticated",
          a.id,
          `update ${table} set participant_id=participant_id`.replace(
            "update public.slime_trial_aggregate_snapshots set participant_id=participant_id",
            "update public.slime_trial_aggregate_snapshots set revision=revision",
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    expect(
      (
        await a.client.from("slime_trial_ballots").insert({
          participant_id: a.id,
          version: "v1",
          answers: answers(),
          revision: 1,
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await a.client
          .from("slime_trial_aggregate_snapshots")
          .update({ revision: 9 })
          .eq("version", "v1")
      ).error,
    ).not.toBeNull();
    await expect(
      roleQuery(
        "authenticated",
        null,
        "select public.slime_trial_submit_ballot($1,$2,$3,$4)",
        ["v1", "[]", crypto.randomUUID(), "0"],
      ),
    ).rejects.toThrow("UNAUTHENTICATED");
    expect(
      (
        await a.client
          .from("slime_trial_content_versions")
          .update({ active: false })
          .eq("id", "v1")
      ).error,
    ).not.toBeNull();
    expect(
      (await a.client.schema("slime_trial_private").from("submissions").select("*")).error,
    ).not.toBeNull();
    expect(
      (
        await browser().rpc("slime_trial_submit_ballot", {
          p_version: "v1",
          p_answers: [],
          p_request_id: crypto.randomUUID(),
          p_expected_revision: "0",
        })
      ).error,
    ).not.toBeNull();
  });
  it("restricts elevation to fixed-path slime_trial_private function and keeps every public table under RLS", async () => {
    const c = await sql();
    try {
      const functions = await c.query(
        "select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('slime_trial_submit_ballot','apply_ballot')",
      );
      expect(
        functions.rows.find((r) => r.proname === "apply_ballot").prosecdef,
      ).toBe(true);
      expect(
        functions.rows.find((r) => r.proname === "slime_trial_submit_ballot").prosecdef,
      ).toBe(false);
      expect(
        functions.rows.every((r) =>
          r.proconfig.includes("search_path=pg_catalog"),
        ),
      ).toBe(true);
      const rls = await c.query(
        "select relrowsecurity from pg_class where oid in ('public.slime_trial_content_versions'::regclass,'public.slime_trial_ballots'::regclass,'public.slime_trial_aggregate_snapshots'::regclass)",
      );
      expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
      expect(
        (
          await c.query(
            "select has_function_privilege('anon','slime_trial_private.apply_ballot(text,jsonb,uuid,bigint)','EXECUTE') as allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      expect(
        (
          await c.query(
            "select has_function_privilege('anon','public.slime_trial_submit_ballot(text,jsonb,uuid,bigint)','EXECUTE') as allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    } finally {
      await c.end();
    }
  });
});
