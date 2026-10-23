import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { answers, participant, reset, snapshot, sql, submit } from './helpers';
describe('real PostgreSQL concurrent transactions', () => {
  beforeEach(reset);
  it('allows only one same-voter concurrent change at the expected revision', async () => {
    const a=await participant(); await submit(a.client);
    const r=await Promise.all([submit(a.client,answers(-5),'1'),submit(a.client,answers(2),'1')]);
    expect(r.filter(x=>!x.error)).toHaveLength(1); expect(r.find(x=>x.error)?.error?.message).toContain('STALE_REVISION'); expect((await snapshot()).count).toBe('1');
  });
  it('preserves twenty concurrent voters and all distributions', async () => {
    const voters=await Promise.all(Array.from({length:20},()=>participant()));
    const started=performance.now();
    const r=await Promise.all(voters.map((v,i)=>submit(v.client,answers(i%2 ? -5:5)))); expect(r.every(x=>!x.error)).toBe(true);
    console.info(`20 simultaneous independent submissions: ${(performance.now()-started).toFixed(1)}ms`);
    const s=await snapshot(); expect(s.count).toBe('20'); expect(s.scoreSum).toBe('0');
    for(const counts of Object.values(s.caseCounts)) expect(Object.values(counts as Record<string,string>).reduce((a,n)=>a+BigInt(n),0n)).toBe(20n);
    expect(Object.values(s.verdictCounts as Record<string,string>).reduce((a,n)=>a+BigInt(n),0n)).toBe(20n);
  });
  it('rolls ballot, aggregate, idempotency and rate records back after a mid-transaction failure', async () => {
    const a=await participant(), c=await sql();
    try {
      await c.query("create function private.test_fail_snapshot() returns trigger language plpgsql as $$ begin raise exception 'INTENTIONAL_ROLLBACK'; end $$; create trigger test_fail before update on public.aggregate_snapshots for each row execute function private.test_fail_snapshot()");
      expect((await submit(a.client)).error?.message).toContain('INTENTIONAL_ROLLBACK');
    } finally { await c.query('drop trigger test_fail on public.aggregate_snapshots; drop function private.test_fail_snapshot()'); }
    try {
      expect((await c.query('select * from public.ballots')).rows).toHaveLength(0); expect((await c.query('select * from private.submissions')).rows).toHaveLength(0); expect((await c.query('select * from private.submit_limits')).rows).toHaveLength(0); expect((await snapshot()).count).toBe('0');
    } finally {await c.end();}
  });
});
