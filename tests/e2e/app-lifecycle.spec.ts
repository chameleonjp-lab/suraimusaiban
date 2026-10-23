import { test, expect } from "@playwright/test";

async function isolatedApp(page: import("@playwright/test").Page) {
  await page.route("**/src/features/vote/participant.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export async function ensureParticipant(){return {id:window.testOwner,persistent:true};}`,
    }),
  );
  await page.route("**/src/features/vote/vote-api.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export class VoteError extends Error {} export async function loadOwnBallot(){return null} export async function loadSnapshot(){throw new Error('unused')} export async function submitBallot(){throw new Error('unused')}`,
    }),
  );
  await page.route("**/src/platform/supabase-client.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const isBackendConfigured=()=>true;export const getSupabaseClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:window.testOwner}}},error:null})}});`,
    }),
  );
  await page.route("**/src/scene/index.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const mountScene=()=>({setView(){},setReducedMotion(value){window.requestedReducedMotion=value},dispose(){}});`,
    }),
  );
  await page.route("**/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body><div id="app"></div></body></html>',
    }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    (window as any).testOwner = "A";
    const { mountApp } = await import("/src/app.ts");
    mountApp(document.querySelector("#app")!);
  });
}
test("identity changes never restore the prior owner draft", async ({
  page,
}) => {
  await isolatedApp(page);
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page
    .getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true })
    .click();
  await page.getByRole("button", { name: "スライム裁判 ホームへ" }).click();
  await page.evaluate(() => {
    (window as any).testOwner = "B";
  });
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(
    page.getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key.endsWith(":B")),
    ),
  ).toBe(true);
});
test("changed OS reduced-motion applies now and after navigating", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await isolatedApp(page);
  expect(
    await page.evaluate(() => (window as any).requestedReducedMotion),
  ).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "3Dを再開" })).toBeVisible();
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(page.getByTestId("case-number")).toHaveText("審理 01");
  expect(
    await page.evaluate(() => (window as any).requestedReducedMotion),
  ).toBe(true);
});
test("an explicit pause survives OS preference changes and navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await isolatedApp(page);
  await page.getByRole("button", { name: "3Dを停止" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => page.evaluate(() => (window as any).requestedReducedMotion))
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(100);
  await expect(page.getByRole("button", { name: "3Dを再開" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).requestedReducedMotion),
  ).toBe(true);
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(page.getByTestId("case-number")).toHaveText("審理 01");
  await expect(page.getByRole("button", { name: "3Dを再開" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).requestedReducedMotion),
  ).toBe(true);
});
