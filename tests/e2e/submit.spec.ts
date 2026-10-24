import { expect, test } from "@playwright/test";
import { begin, answerAll, resetResponses, counts } from "./anonymous-helpers";
test.setTimeout(120_000);
test.beforeEach(resetResponses);

test("lost committed response retries identical anonymous request without adding twice",async({page})=>{
  await begin(page);await answerAll(page);
  const requests:unknown[]=[];let committed:any;let replay:any;
  await page.route("**/functions/v1/slime-trial-submit",async route=>{
    if(route.request().method()!=="POST"){await route.continue();return;}
    requests.push(route.request().postDataJSON());
    const response=await route.fetch();expect(response.ok()).toBe(true);
    if(requests.length===1){committed=await response.json();await route.abort("failed");}
    else{replay=await response.json();await route.fulfill({response});}
  });
  await page.getByRole("button",{name:"この判断を提出する"}).click();
  await expect(page.getByTestId("individual-total")).toHaveText("＋100");
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  expect(committed.duplicate).toBe(false);expect(replay.duplicate).toBe(true);
  expect(replay.snapshot).toEqual(committed.snapshot);
  expect(await counts()).toEqual({internal:"1",published:"0",receipts:"1"});
  await expect(page.getByText("集計準備中",{exact:true})).toBeVisible();
  await expect(page.getByLabel("保存する画像").locator('option[value="comparison"]')).toHaveCount(0);
});

test("leaving during an in-flight submission does not retry or recover the departed result",async({page})=>{
  await begin(page);await answerAll(page);
  let resolveCommitted!:()=>void;const committed=new Promise<void>(resolve=>{resolveCommitted=resolve;});
  let release!:()=>void;const released=new Promise<void>(resolve=>{release=resolve;});
  let requests=0;
  await page.route("**/functions/v1/slime-trial-submit",async route=>{
    if(route.request().method()!=="POST"){await route.continue();return;}
    requests++;const response=await route.fetch();expect(response.ok()).toBe(true);resolveCommitted();
    await released;await route.abort("failed").catch(()=>{});
  });
  await page.getByRole("button",{name:"この判断を提出する"}).click(); await committed;
  await page.getByRole("button",{name:"スライム裁判 ホームへ"}).click();release();
  await expect(page.getByRole("button",{name:"裁判に参加する"})).toBeVisible();
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  await page.getByRole("button",{name:"裁判に参加する"}).click();
  await expect(page.getByRole("radio",{name:"＋5 強く待遇改善を求める",exact:true})).toHaveAttribute("aria-checked","false");
  expect(requests).toBe(1);expect((await counts()).internal).toBe("1");
});
