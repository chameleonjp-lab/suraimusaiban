import { chooseScore } from "./slider-helpers";
import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`home and trial fit ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "その判断で、 運命がゆれる。" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "前回の結果" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "裁判に参加する" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("paused 3D leaves the trial accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page.getByRole("button", { name: "動きを止める" }).click();
  await chooseScore(page, -5);
  await expect(
    page.getByRole("slider", { name: "この審理の判断" })).toHaveValue("-5");
});
