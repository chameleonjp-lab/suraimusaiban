import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { begin, answerAll, submitCurrent, resetResponses, seedResponses, counts } from "./anonymous-helpers";
test.setTimeout(120_000);
test.beforeEach(resetResponses);

test("anonymous responses append without Auth or personal storage; public comparison stays fixed",async({page})=>{
  const authRequests:string[]=[];
  page.on("request",request=>{if(request.url().includes("/auth/v1/"))authRequests.push(request.url());});
  await seedResponses(10);
  await begin(page); await answerAll(page);
  const first=await submitCurrent(page);
  expect(Object.keys(first).sort()).toEqual(["accepted","duplicate","snapshot"]);
  expect(first.snapshot.count).toBe("10");
  expect(await counts()).toEqual({internal:"11",published:"10",receipts:"11"});
  await expect(page.getByTestId("individual-total")).toHaveText("＋100");
  const post=new URL((await page.getByRole("link",{name:"今回の判決をXでシェア"}).getAttribute("href"))!);
  expect(post.searchParams.get("text")).toContain("＋100点");
  expect(post.searchParams.get("url")).toBe("https://chameleonjp-lab.github.io/suraimusaiban/");
  await page.getByLabel("保存する画像").selectOption("comparison");
  const download=page.waitForEvent("download");
  await page.getByRole("link",{name:"PNG画像を保存"}).click();
  const bytes=await readFile((await(await download).path())!);
  expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([1080,1350]);
  await page.getByRole("button",{name:"スライム裁判 ホームへ"}).click();
  await page.getByRole("button",{name:"裁判に参加する"}).click();
  await expect(page.getByRole("radio",{name:"＋5 強く待遇改善を求める",exact:true})).toHaveAttribute("aria-checked","false");
  await answerAll(page,false); const second=await submitCurrent(page);
  expect(second.snapshot.count).toBe("10");
  await expect(page.getByTestId("individual-total")).toHaveText("−100");
  expect(await counts()).toEqual({internal:"12",published:"10",receipts:"12"});
  const comparison=await page.getByTestId("comparison").innerHTML();
  await seedResponses(8,-5);
  await page.evaluate(()=>{window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("slime:refresh-snapshot"));});
  await expect(page.getByTestId("comparison")).toHaveJSProperty("innerHTML",comparison);
  expect((await counts()).published).toBe("20");
  await page.getByRole("button",{name:"みんなの判決"}).click();
  await expect(page.getByRole("status")).toContainText("集計を取得しました。");
  await expect(page.getByText("公開回答数 20回",{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),history:history.state}))).toEqual({local:[],session:[],history:null});
  expect(authRequests).toEqual([]);
});

for(const ending of ["reload","back","bfcache","persisted-event"] as const){
  test(`personal response cannot be restored after ${ending}`,async({page})=>{
    await page.goto("/#result");
    await expect(page.getByTestId("individual-total")).toHaveCount(0);
    await begin(page); await answerAll(page); await submitCurrent(page);
    if(ending==="reload")await page.reload();
    if(ending==="back"){
      await page.getByRole("button",{name:"スライム裁判 ホームへ"}).click(); await page.goBack();
    }
    if(ending==="bfcache"){
      await page.evaluate(()=>window.addEventListener("pageshow",event=>{(window as any).observedBFCache=event.persisted;}));
      await page.goto("/?away=1"); await page.goBack();
      const restored=await page.evaluate(()=>(window as any).observedBFCache===true);
      test.info().annotations.push({type:"BFCache",description:restored?"Actual persisted restoration observed; personal result purged.":"Document reload observed; persisted handler also covered independently."});
    }
    if(ending==="persisted-event")await page.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));
      window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));
    });
    await expect(page.getByTestId("individual-total")).toHaveCount(0);
    await expect(page.getByRole("button",{name:"裁判に参加する"})).toBeVisible();
    await page.getByRole("button",{name:"裁判に参加する"}).click();
    await expect(page.getByRole("radio",{name:"＋5 強く待遇改善を求める",exact:true})).toHaveAttribute("aria-checked","false");
    expect(await page.evaluate(()=>[...Object.keys(localStorage),...Object.keys(sessionStorage)])).toEqual([]);
    expect((await counts()).internal).toBe("1");
  });
}
