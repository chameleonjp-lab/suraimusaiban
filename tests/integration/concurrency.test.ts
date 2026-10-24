import { beforeEach, describe, expect, it } from "vitest";
import { answers, internalSnapshot, reset, snapshot, sourceKey, sql, submit } from "./helpers";
describe("real concurrent aggregate transactions", () => {
  beforeEach(reset);
  it("accepts simultaneous copies of one request only once", async () => {
    const id = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: 12 }, () => submit(answers(), id)));
    expect(responses.every(r => !r.error)).toBe(true);
    expect(responses.filter(r => r.data.duplicate === false)).toHaveLength(1);
    expect(responses.filter(r => r.data.duplicate === true)).toHaveLength(11);
    expect((await internalSnapshot()).count).toBe("1"); expect((await snapshot()).count).toBe("0");
  });
  it("preserves twenty concurrent responses and every distribution", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => submit(answers(i % 2 ? -5 : 5), crypto.randomUUID(), sourceKey(i + 1))));
    expect(responses.every(r => !r.error)).toBe(true);
    expect(responses.every(r => ["0", "10", "20"].includes(r.data.snapshot.count))).toBe(true);
    const s = await snapshot(); expect(s.count).toBe("20"); expect(s.scoreSum).toBe("0"); expect(s.revision).toBe("20");
    for (const counts of Object.values(s.caseCounts) as Record<string,string>[]) {
      expect(counts["5"]).toBe("10"); expect(counts["-5"]).toBe("10");
      expect(Object.values(counts).reduce((a,n) => a + BigInt(n), 0n)).toBe(20n);
    }
    expect(s.verdictCounts.P5).toBe("10"); expect(s.verdictCounts.N5).toBe("10");
  });
  it("enforces network limit across concurrent new requests", async () => {
    const responses = await Promise.all(Array.from({ length: 35 }, () => submit()));
    expect(responses.filter(r => !r.error)).toHaveLength(30);
    expect(responses.filter(r => r.error?.message.includes("RATE_LIMITED"))).toHaveLength(5);
    expect((await internalSnapshot()).count).toBe("30");
  });
  it("bounds an ingest lock wait without accepting the queued response", async () => {
    const c = await sql();
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(1936483693,42)");
    const pending = submit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        pending,
        new Promise<null>(resolve => { timer=setTimeout(() => resolve(null),5000); }),
      ]);
      expect(result).not.toBeNull();
      expect(result?.error?.message).toContain("lock timeout");
      expect((await internalSnapshot()).count).toBe("0");
      expect((await c.query("select count(*)::int as n from slime_trial_private.request_receipts")).rows[0].n).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      await c.query("rollback");
      await pending;
      await c.end();
    }
  });
  it("rolls totals, receipt, limits and public publication back together", async () => {
    for (let i=0; i<9; i++) expect((await submit()).error).toBeNull();
    const before = await snapshot(), c = await sql();
    try {
      await c.query("create function slime_trial_private.test_fail_snapshot() returns trigger language plpgsql as $$ begin raise exception 'INTENTIONAL_ROLLBACK'; end $$; create trigger test_fail before update on public.slime_trial_aggregate_snapshots for each row execute function slime_trial_private.test_fail_snapshot()");
      expect((await submit()).error?.message).toContain("INTENTIONAL_ROLLBACK");
    } finally {
      await c.query("drop trigger test_fail on public.slime_trial_aggregate_snapshots; drop function slime_trial_private.test_fail_snapshot()");
    }
    try {
      expect((await internalSnapshot()).count).toBe("9"); expect(await snapshot()).toEqual(before);
      expect((await c.query("select count(*)::int as n from slime_trial_private.request_receipts")).rows[0].n).toBe(9);
      expect((await c.query("select cardinality(operations) as n from slime_trial_private.request_limits order by limit_key")).rows.map(r => r.n)).toEqual([9,9]);
    } finally { await c.end(); }
    expect((await submit()).data.snapshot.count).toBe("10");
  });
});
