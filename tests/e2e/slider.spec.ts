import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "裁判に参加する" }).click();
});

test("one continuous slider supports dragging without replacing the control", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "この審理の判断" });
  await expect(slider).toHaveCount(1);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(slider).toHaveValue("0");
  await slider.scrollIntoViewIfNeeded();
  const element = await slider.elementHandle();
  const box = (await slider.boundingBox())!;
  const x = (value: number) => box.x + 14 + ((box.width - 28) * (value + 5)) / 10;
  const y = box.y + box.height / 2;
  await page.mouse.move(x(0), y);
  await page.mouse.down();
  await page.mouse.move(x(-4), y, { steps: 8 });
  await expect(slider).toHaveValue("-4");
  await page.mouse.move(x(4), y, { steps: 16 });
  await page.mouse.up();
  await expect(slider).toHaveValue("4");
  expect(await element!.evaluate(node => node.isConnected)).toBe(true);
  await expect(slider).toHaveAttribute("aria-valuetext", "＋4 待遇改善を求める");
  await expect(page.locator(".trial-progress")).toContainText("1 / 20 回答");
  await page.getByRole("button", { name: "次の審理へ" }).click();
  await expect(slider).toHaveValue("0");
  await page.getByRole("button", { name: "前へ" }).click();
  await expect(slider).toHaveValue("4");
});

test("keyboard selection can return to unanswered center and blocks submission", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "この審理の判断" });
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("5");
  await expect(page.locator(".selection-note")).toHaveText("＋5 · 強く待遇改善を求める");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("4");
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("-5");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("0");
  await expect(slider).toHaveAttribute("aria-valuetext", "未選択");
  await expect(page.locator(".trial-progress")).toContainText("0 / 20 回答");
  await page.getByRole("button", { name: "回答一覧" }).click();
  await expect(page.getByRole("button", { name: /この判断を提出する|未送信の結果を見る/ })).toBeDisabled();
  await expect(page.locator(".answer-review li").first()).toContainText("未回答");
});

test("slider fits mobile portrait and landscape with enlarged text", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const slider = page.getByRole("slider", { name: "この審理の判断" });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
