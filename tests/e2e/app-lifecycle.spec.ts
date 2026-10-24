import { test, expect } from "@playwright/test";

async function isolatedApp(page: import("@playwright/test").Page) {
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
    localStorage.setItem("slime-trial:auth:v1", "old-user");
    localStorage.setItem("slime-trial:draft:v1:A", "old-answers");
    sessionStorage.setItem("slime-trial:preview-id", "old-preview");
    localStorage.setItem("other-game:keep", "unchanged");
    const { mountApp } = await import("/src/app.ts");
    mountApp(document.querySelector("#app")!);
  });
}
test("legacy personal state is purged and a new trial never restores a departed draft", async ({
  page,
}) => {
  await isolatedApp(page);
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page
    .getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true })
    .click();
  await page.getByRole("button", { name: "スライム裁判 ホームへ" }).click();
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(
    page.getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  expect(
    await page.evaluate(() => [...Object.keys(localStorage),...Object.keys(sessionStorage)].some(key => key.startsWith("slime-trial:"))),
  ).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("other-game:keep"))).toBe("unchanged");
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
