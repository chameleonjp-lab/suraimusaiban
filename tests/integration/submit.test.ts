import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scoreAnswers, validateAnswers } from "../../src/domain/scoring";
import { answers, collect, internalSnapshot, reset, snapshot, sourceKey, sql, submit, wire } from "./helpers";
describe("anonymous aggregate collection", () => {
  beforeEach(reset);
  it("appends every fresh response and returns only the unchanged public snapshot until ten", async () => {
    const initial = await snapshot(), id = crypto.randomUUID();
    const metadataDb = await sql();
    const initialRow = (await metadataDb.query("select * from public.slime_trial_aggregate_snapshots")).rows;
    await metadataDb.end();
    const first = await submit(answers(), id);
    expect(first.error).toBeNull(); expect(first.data).toEqual({ accepted:true,duplicate:false,snapshot:initial });
    const changedReplay = await submit(answers(-5), id, sourceKey(2));
    expect(changedReplay.data).toEqual({ accepted:true,duplicate:true,snapshot:initial });
    expect((await internalSnapshot()).scoreSum).toBe("100");
    for (let i=1; i<9; i++) expect((await submit(answers(i%2 ? -5 : 5))).data.snapshot).toEqual(initial);
    expect(await snapshot()).toEqual(initial);
    const unchangedDb = await sql();
    expect((await unchangedDb.query("select * from public.slime_trial_aggregate_snapshots")).rows).toEqual(initialRow);
    await unchangedDb.end();
    const tenth = await submit(answers(-5));
    expect(tenth.data.snapshot.count).toBe("10"); expect(tenth.data.snapshot.scoreSum).toBe("0");
    expect(tenth.data.snapshot.revision).toBe("10"); expect(await snapshot()).toEqual(tenth.data.snapshot);
    expect((await submit()).data.snapshot).toEqual(tenth.data.snapshot);
    const retry = await submit(answers(), id); expect(retry.data.duplicate).toBe(true); expect(retry.data.snapshot).toEqual(tenth.data.snapshot);
    expect((await internalSnapshot()).count).toBe("11");
  });
  it("rejects malformed or inactive requests without modifying any aggregate", async () => {
    const good = wire(answers());
    const invalid: unknown[] = [null,{},[],good.slice(1),[...good,good[0]],[...good.slice(1),good[1]],good.map((v,i)=>i?v:{...v,caseId:"X01"}),good.map((v,i)=>i?v:{...v,extra:true}),good.map((v,i)=>i?v:{score:v.score}),good.map((v,i)=>i?v:null),good.map((v,i)=>i?v:{...v,caseId:null}),...[0,1.5,6,-6,"5",null].map(score=>good.map((v,i)=>i?v:{...v,score}))];
    for (const values of invalid) expect((await collect(values)).error?.message).toContain("INVALID_ANSWERS");
    expect((await collect(good,null)).error?.message).toContain("INVALID_REQUEST");
    for (const source of [null,"", "a".repeat(63), "g".repeat(64), "A".repeat(64)]) expect((await collect(good,crypto.randomUUID(),source)).error?.message).toContain("INVALID_REQUEST");
    for (const version of [null,"v2"]) expect((await collect(good,crypto.randomUUID(),sourceKey(),version)).error?.message).toContain("VERSION_CHANGED");
    const c=await sql(); try { await c.query("update public.slime_trial_content_versions set active=false where id='v1'"); } finally { await c.end(); }
    expect((await submit()).error?.message).toContain("VERSION_CHANGED");
    expect((await internalSnapshot()).count).toBe("0"); expect((await snapshot()).count).toBe("0");
    const untouchedDb = await sql();
    try {
      for (const table of ["request_receipts", "request_limits"]) expect((await untouchedDb.query(`select count(*)::int as n from slime_trial_private.${table}`)).rows[0].n).toBe(0);
    } finally { await untouchedDb.end(); }
  });
  it("limits accepted requests to 30 per rolling ten minutes and exempts duplicates", async () => {
    const id=crypto.randomUUID(); expect((await submit(answers(),id)).error).toBeNull();
    for(let i=0;i<35;i++) expect((await submit(answers(),id)).data.duplicate).toBe(true);
    for(let i=1;i<30;i++) expect((await submit()).error).toBeNull();
    const before=await snapshot();
    expect((await submit()).error?.message).toContain("RATE_LIMITED"); expect(await snapshot()).toEqual(before);
    expect((await submit(answers(),id)).data.duplicate).toBe(true);
    const c=await sql(); try { await c.query("update slime_trial_private.request_limits set operations=array_fill(clock_timestamp()-interval '601 seconds',array[30]) where limit_key=$1",[sourceKey()]); } finally { await c.end(); }
    expect((await submit()).error).toBeNull(); expect((await internalSnapshot()).count).toBe("31");
  });
  it("carries the rolling network quota across an hourly source-key rollover", async () => {
    const previous = sourceKey(11), current = sourceKey(12);
    for (let i=0; i<30; i++) expect((await submit(answers(),crypto.randomUUID(),previous)).error).toBeNull();
    const before = await snapshot();
    expect((await submit(answers(),crypto.randomUUID(),current,"v1",previous)).error?.message).toContain("RATE_LIMITED");
    expect((await internalSnapshot()).count).toBe("30"); expect(await snapshot()).toEqual(before);
    const c = await sql();
    try {
      // Twenty-nine old operations have left the rolling window; one still counts.
      await c.query("update slime_trial_private.request_limits set operations=array_fill(clock_timestamp()-interval '601 seconds',array[29]) || array[clock_timestamp()-interval '300 seconds'] where limit_key=$1",[previous]);
      for (let i=0; i<29; i++) expect((await submit(answers(),crypto.randomUUID(),current,"v1",previous)).error).toBeNull();
      expect((await submit(answers(),crypto.randomUUID(),current,"v1",previous)).error?.message).toContain("RATE_LIMITED");
      // Prior operations remain in their original row rather than being copied on each request.
      expect((await c.query("select cardinality(operations) as n from slime_trial_private.request_limits where limit_key=$1",[current])).rows[0].n).toBe(29);
      await c.query("update slime_trial_private.request_limits set operations=array_fill(clock_timestamp()-interval '601 seconds',array[30]) where limit_key=$1",[previous]);
      expect((await submit(answers(),crypto.randomUUID(),current,"v1",previous)).error).toBeNull();
      expect((await submit(answers(),crypto.randomUUID(),current,"v1",previous)).error?.message).toContain("RATE_LIMITED");
      expect((await internalSnapshot()).count).toBe("60");
    } finally { await c.end(); }
  });
  it("enforces the same rolling quota for either arrival order across adjacent hours", async () => {
    for (const [firstHour,laterHour] of [[12,13],[13,12]]) {
      await reset();
      const first = sourceKey(firstHour), later = sourceKey(laterHour);
      const requestId = crypto.randomUUID();
      for (let i=0; i<30; i++) {
        expect((await submit(answers(),i===0 ? requestId : crypto.randomUUID(),first,"v1",sourceKey(firstHour-1),sourceKey(firstHour+1))).error).toBeNull();
      }
      const before = await snapshot();
      expect((await submit(answers(),crypto.randomUUID(),later,"v1",sourceKey(laterHour-1),sourceKey(laterHour+1))).error?.message).toContain("RATE_LIMITED");
      // Replays remain free even when their original request arrives out of order.
      expect((await submit(answers(),requestId,later,"v1",sourceKey(laterHour-1),sourceKey(laterHour+1))).data.duplicate).toBe(true);
      expect((await internalSnapshot()).count).toBe("30"); expect(await snapshot()).toEqual(before);
      const c = await sql();
      try {
        expect((await c.query("select cardinality(operations) as n from slime_trial_private.request_limits where limit_key=$1",[first])).rows[0].n).toBe(30);
        expect((await c.query("select 1 from slime_trial_private.request_limits where limit_key=$1",[later])).rowCount).toBe(0);
        await c.query("update slime_trial_private.request_limits set operations=array_fill(clock_timestamp()-interval '601 seconds',array[30]) where limit_key=$1",[first]);
        expect((await submit(answers(),crypto.randomUUID(),later,"v1",sourceKey(laterHour-1),sourceKey(laterHour+1))).error).toBeNull();
        expect((await c.query("select cardinality(operations) as n from slime_trial_private.request_limits where limit_key=$1",[later])).rows[0].n).toBe(1);
      } finally { await c.end(); }
    }
  });
  it("validates next-epoch keys and rejects every duplicate key pair", async () => {
    const current = sourceKey(12), previous = sourceKey(11);
    for (const next of ["", "a".repeat(63), "g".repeat(64), "A".repeat(64), current, previous]) {
      expect((await collect(wire(answers()),crypto.randomUUID(),current,"v1",previous,next)).error?.message).toContain("INVALID_REQUEST");
    }
    expect((await internalSnapshot()).count).toBe("0");
  });
  it("accepts service calls with four, five or six arguments using optional epoch defaults", async () => {
    expect((await submit()).error).toBeNull();
    expect((await submit(answers(),crypto.randomUUID(),sourceKey(12),"v1",sourceKey(11))).error).toBeNull();
    expect((await submit(answers(),crypto.randomUUID(),sourceKey(22),"v1",sourceKey(21),sourceKey(23))).error).toBeNull();
    expect((await submit(answers(),crypto.randomUUID(),sourceKey(32),"v1",null,sourceKey(33))).error).toBeNull();
    expect((await internalSnapshot()).count).toBe("4");
  });
  it("rejects malformed or equal previous source keys", async () => {
    for (const previous of ["", "a".repeat(63), "g".repeat(64), "A".repeat(64), sourceKey()]) {
      expect((await collect(wire(answers()),crypto.randomUUID(),sourceKey(),"v1",previous)).error?.message).toContain("INVALID_REQUEST");
    }
    expect((await internalSnapshot()).count).toBe("0");
  });
  it("enforces a global rolling minute across source keys and releases expired operations", async () => {
    for(let i=0;i<118;i++) expect((await submit(answers(),crypto.randomUUID(),sourceKey(i+1))).error).toBeNull();
    const concurrent = await Promise.all(Array.from({length:8}, (_,i) => submit(answers(),crypto.randomUUID(),sourceKey(i+500))));
    expect(concurrent.filter(r => !r.error)).toHaveLength(2);
    expect(concurrent.filter(r => r.error?.message.includes("RATE_LIMITED"))).toHaveLength(6);
    expect((await submit(answers(),crypto.randomUUID(),sourceKey(999))).error?.message).toContain("RATE_LIMITED");
    const c=await sql(); try { await c.query("update slime_trial_private.request_limits set operations=array_fill(clock_timestamp()-interval '61 seconds',array[120]) where limit_key='global'"); } finally { await c.end(); }
    expect((await submit(answers(),crypto.randomUUID(),sourceKey(999))).error).toBeNull(); expect((await internalSnapshot()).count).toBe("121"); expect((await snapshot()).count).toBe("120");
  });
  it("expires replay IDs after 24 hours and cleans only stale receipts and counters", async () => {
    const id=crypto.randomUUID(), stale=crypto.randomUUID(); await submit(answers(),id);
    const c=await sql();
    try {
      await c.query("update slime_trial_private.request_receipts set created_at=clock_timestamp()-interval '25 hours' where request_id=$1",[id]);
      expect((await submit(answers(),id)).data.duplicate).toBe(false);
      await c.query("insert into slime_trial_private.request_receipts values($1,clock_timestamp()-interval '25 hours')",[stale]);
      await c.query("insert into slime_trial_private.request_limits(limit_key,operations,updated_at) values($1,array[clock_timestamp()-interval '2 hours'],clock_timestamp()-interval '2 hours')",[sourceKey(9)]);
      await c.query("begin"); await c.query("set local role service_role"); await c.query("select public.slime_trial_cleanup_requests()"); await c.query("commit");
      expect((await c.query("select request_id from slime_trial_private.request_receipts")).rows).toEqual([{ request_id:id }]);
      expect((await c.query("select 1 from slime_trial_private.request_limits where limit_key=$1",[sourceKey(9)])).rowCount).toBe(0);
      expect((await c.query("select count(*)::int as n from slime_trial_private.request_limits")).rows[0].n).toBe(2);
      expect((await internalSnapshot()).count).toBe("2"); expect((await snapshot()).count).toBe("0");
    } finally { await c.end(); }
  });
  it("matches TypeScript scoring on all 100 H/K pairs and all ten axes", async () => {
    const c=await sql(); try {
      for(const h of [-5,-4,-3,-2,-1,1,2,3,4,5]) for(const k of [-5,-4,-3,-2,-1,1,2,3,4,5]) {
        const values=Object.fromEntries(Object.keys(answers()).map(id=>[id,id.startsWith("H")?h:k])); const expected=scoreAnswers(validateAnswers(values));
        const result=(await c.query("select slime_trial_private.score_ballot($1::jsonb) as result",[JSON.stringify(values)])).rows[0].result;
        expect(result).toEqual({total:expected.total,axes:expected.axes,verdict:expected.verdict});
      }
    } finally { await c.end(); }
  });
  it("scores submitted fixtures server-side and publishes complete batches", async () => {
    const fixtures=JSON.parse(readFileSync("tests/fixtures/scoring.json","utf8"));
    for(const fixture of fixtures.valid) {
      await reset(); for(let i=0;i<10;i++) expect((await submit(fixture.answers)).error).toBeNull();
      const s=await snapshot(), expected=fixture.expected; expect(s.scoreSum).toBe(String(expected.total*10));
      expect(s.axisSums).toEqual(Object.fromEntries(Object.entries(expected.axes).map(([k,v])=>[k,String(Number(v)*10)])));
      expect(s.verdictCounts[expected.verdict]).toBe("10");
    }
  });
});
