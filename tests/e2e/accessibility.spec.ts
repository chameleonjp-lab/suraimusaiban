import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function noOverflow(page: Page, screen: string) {
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    })),
    screen,
  ).toEqual({
    width: page.viewportSize()!.width,
    content: page.viewportSize()!.width,
  });
}

async function accessibleControls(page: Page) {
  const targets = await page
    .locator("button,input[type=range],select,a[href],summary")
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({
          name:
            element.getAttribute("aria-label") ?? element.textContent?.trim(),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
    );
  for (const target of targets) {
    expect(target.width, `${target.name}: width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.name}: height`).toBeGreaterThanOrEqual(44);
  }
}

async function bodyContrast(page: Page) {
  const ratios = await page
    .locator("main p,main legend")
    .evaluateAll((elements) => {
      const rgb = (text: string) =>
        (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (color: number[]) =>
        color
          .map((value) => value / 255)
          .map((value) =>
            value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
            0,
          );
      return elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          let ancestor: Element | null = element;
          let background = "rgb(255,255,255)";
          while (ancestor) {
            const current = getComputedStyle(ancestor).backgroundColor;
            if (current !== "rgba(0, 0, 0, 0)" && current !== "transparent") {
              background = current;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          const front = luminance(rgb(getComputedStyle(element).color));
          const back = luminance(rgb(background));
          return {
            text: element.textContent?.slice(0, 50),
            ratio:
              (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05),
          };
        });
    });
  for (const entry of ratios)
    expect(entry.ratio, entry.text).toBeGreaterThanOrEqual(4.5);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`accessible_fallback_flow ${viewport.width}x${viewport.height}: keyboard, 200% text, reduced motion and unavailable WebGL still submit and save`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        type: string,
        ...args: any[]
      ) {
        if (type.includes("webgl")) return null;
        return native.call(this, type as never, ...args);
      } as typeof native;
    });
    await page.goto("/");
    const connected = await page.evaluate(async () =>
      (await import("/src/platform/supabase-client.ts")).isBackendConfigured(),
    );
    test.skip(
      !connected,
      "Requires real Supabase; preview-only completion does not prove voting remains available.",
    );
    // A root size of 200% simulates browser text enlargement, not a CSS transform.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await noOverflow(page, "home at 200% text");
    await accessibleControls(page);
    await bodyContrast(page);
    await expect(page.locator("[data-scene-fallback]")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "メインナビゲーション" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "裁判に参加する" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("case-number")).toHaveText("審理 01");
    await noOverflow(page, "trial at 200% text");
    await accessibleControls(page);
    await bodyContrast(page);
    await expect(
      page.getByRole("group", { name: "あなたは、どう判断しますか。" }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "この審理の判断" }),
    ).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "3Dを再試行" })).toBeVisible();
    for (let i = 0; i < 20; i++) {
      const choice = page.getByRole("slider", { name: "この審理の判断" });
      await choice.focus();
      await page.keyboard.press("End");
      await expect(choice).toHaveValue("5");
      const next = page.getByRole("button", {
        name: i === 19 ? "回答を確認する" : "次の審理へ",
      });
      await next.focus();
      await page.keyboard.press("Enter");
    }
    await noOverflow(page, "review at 200% text");
    await accessibleControls(page);
    await page.getByRole("button", { name: "この判断を提出する" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("individual-total")).toHaveText("＋100");
    await noOverflow(page, "result at 200% text");
    await accessibleControls(page);
    const save = page.getByRole("link", { name: "PNG画像を保存" });
    await expect(save).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await save.focus();
    await page.keyboard.press("Enter");
    expect((await downloaded).suggestedFilename()).toMatch(/\.png$/);
    // Enlarged result tables can exceed WebKit's 32767px full-page image limit.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`fallback-${viewport.width}-200pct.png`),
    });
  });
}
