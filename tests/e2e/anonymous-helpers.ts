import { chooseScore } from "./slider-helpers";
import { expect, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
export async function withLocalDb<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const address = process.env.SUPABASE_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(address).hostname)) throw new Error("Browser fixture writes are LOCAL ONLY");
  const client = new Client({connectionString:address}); await client.connect();
  try { return await work(client); } finally { await client.end(); }
}
export async function resetResponses() {
  await withLocalDb(async db => {
    await db.query("truncate slime_trial_private.request_receipts,slime_trial_private.request_limits");
    await db.query("update slime_trial_private.aggregate_totals set revision=0,pending_count=0,updated_at=now(),payload=slime_trial_private.empty_snapshot(version)");
    await db.query("update public.slime_trial_aggregate_snapshots set revision=0,updated_at=now(),payload=slime_trial_private.empty_snapshot(version)");
    await db.query("update public.slime_trial_content_versions set active=(id='v1')");
  });
}
export async function seedResponses(count: number, score = 5) {
  const answers = ["H","K"].flatMap(prefix => Array.from({length:10},(_,i)=>({caseId:`${prefix}${String(i+1).padStart(2,"0")}`,score})));
  await withLocalDb(async db => {
    for(let i=0;i<count;i++) {
      await db.query("begin"); await db.query("set local role service_role");
      try { await db.query("select public.slime_trial_collect_response($1,$2::jsonb,$3::uuid,$4)",["v1",JSON.stringify(answers),randomUUID(),randomBytes(32).toString("hex")]); await db.query("commit"); }
      catch(error) { await db.query("rollback"); throw error; }
    }
  });
}
export async function counts() {
  return withLocalDb(async db => (await db.query("select (select payload->>'count' from slime_trial_private.aggregate_totals where version='v1') as internal,(select payload->>'count' from public.slime_trial_aggregate_snapshots where version='v1') as published,(select count(*)::text from slime_trial_private.request_receipts) as receipts")).rows[0] as {internal:string;published:string;receipts:string});
}
export async function begin(page:Page) {
  await page.goto("/");
  expect(await page.evaluate(async()=> (await import("/src/platform/supabase-client.ts")).isBackendConfigured()), "Connected browser tests require the real local REST+gate").toBe(true);
  await page.getByRole("button",{name:"裁判に参加する"}).click();
  await expect(page.getByTestId("case-number")).toHaveText("審理 01");
}
export async function answerAll(page:Page, positive=true) {
  for(let i=0;i<20;i++) {
    await chooseScore(page, positive ? 5 : -5);
    await page.getByRole("button",{name:i===19?"回答を確認する":"次の審理へ"}).click();
  }
}
export async function submitCurrent(page:Page) {
  const pending=page.waitForResponse(response=>response.url().endsWith("/functions/v1/slime-trial-submit")&&response.request().method()==="POST"&&response.ok());
  await page.getByRole("button",{name:"この判断を提出する"}).click();
  const receipt=await(await pending).json();
  await expect(page.getByRole("heading",{name:"今回、あなたが下した判決"})).toBeVisible();
  return receipt;
}
