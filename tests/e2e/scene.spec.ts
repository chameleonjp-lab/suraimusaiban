import { expect, test } from "@playwright/test";

test("WebGL unavailable leaves a static slime and usable trial", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.includes("webgl")) return null;
      return getContext.apply(this, [kind, ...args] as Parameters<
        typeof getContext
      >);
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(page.locator("[data-scene-fallback]")).toBeVisible();
  await page
    .getByRole("button", {
      name: /審理をはじめる|審理に参加|裁判に参加|裁判をはじめる|裁判を始める/,
    })
    .click();
  await expect(page.getByRole("radiogroup").first()).toBeVisible();
});

test("context loss replaces the canvas with the same model fallback", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("canvas")
    .first()
    .evaluate((canvas) => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
  await expect(page.locator("[data-scene-fallback]")).toBeVisible();
});

test('manual pause keeps the real scene RAF stopped through OS changes and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    const stats = { callbacks: 0, get pending() { return pending.size; } };
    Object.assign(window, { __slimeRaf: stats });
    window.requestAnimationFrame = callback => {
      const id = request(time => {
        pending.delete(id);
        stats.callbacks++;
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  });
  const stats = () => page.evaluate(() => {
    const value = (window as typeof window & { __slimeRaf: { callbacks: number; pending: number } }).__slimeRaf;
    return { callbacks: value.callbacks, pending: value.pending };
  });
  const expectStopped = async () => {
    await expect(page.locator('canvas[data-scene-state="active"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '3Dを再開', exact: true })).toBeVisible();
    await expect.poll(async () => (await stats()).pending).toBe(0);
    const before = await stats();
    // Observe real callback execution as well as queued work, independent of the label.
    await page.waitForTimeout(350);
    expect(await stats()).toEqual(before);
  };

  await page.goto('/');
  await expect(page.locator('canvas[data-scene-state="active"]')).toBeVisible();
  const initial = await stats();
  await expect.poll(async () => (await stats()).callbacks).toBeGreaterThan(initial.callbacks + 2);
  await page.getByRole('button', { name: '3Dを停止', exact: true }).click();
  await expectStopped();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectStopped();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectStopped();
  await page.getByRole('button', { name: /裁判に参加する/ }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await expect(page.getByRole('radiogroup').first()).toBeVisible();
  await expectStopped();
  await page.getByRole('button', { name: 'スライム裁判 ホームへ', exact: true }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await expectStopped();
});
