import { expect, test } from "@playwright/test";

test("explicit start overrides reduced motion through later OS changes and navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const canvas = page.locator('canvas[data-scene-state="active"]');
  await canvas.scrollIntoViewIfNeeded();
  const still = await canvas.screenshot();
  await page.getByRole("button", { name: "スライムを動かす", exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(still)).toBe(false);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "動きを止める", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await canvas.scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "動きを止める", exact: true })).toBeVisible();
  const resumed = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(resumed)).toBe(false);
});

for (const initial of ["manual", "system"] as const) {
  test(`${initial} pause survives WebGL retry without granting animation permission`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: initial === "system" ? "reduce" : "no-preference" });
    await page.goto("/");
    if (initial === "manual") await page.getByRole("button", { name: "動きを止める", exact: true }).click();
    await page.locator("canvas").evaluate(canvas => canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    await page.getByRole("button", { name: "3Dを再試行", exact: true }).click();
    await expect(page.getByRole("button", { name: "スライムを動かす", exact: true })).toBeVisible();
    const canvas = page.locator('canvas[data-scene-state="active"]');
    const still = await canvas.screenshot();
    await page.waitForTimeout(350);
    expect((await canvas.screenshot()).equals(still)).toBe(true);
    if (initial === "manual") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    await page.getByRole("button", { name: "裁判に参加する" }).click();
    await expect(page.getByRole("button", { name: "スライムを動かす", exact: true })).toBeVisible();
    const trialStill = await canvas.screenshot();
    await page.waitForTimeout(350);
    expect((await canvas.screenshot()).equals(trialStill)).toBe(true);
  });
}

test("WebGL retry replaces the failed canvas and starts a real animated scene", async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    Object.assign(window, { __failWebGL: true });
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind.includes("webgl") && (window as any).__failWebGL) return null;
      return native.apply(this, [kind, ...args] as Parameters<typeof native>);
    } as typeof native;
  });
  await page.goto("/");
  await expect(page.locator("[data-scene-fallback]")).toBeVisible();
  const old = await page.locator("canvas").elementHandle();
  await page.evaluate(() => { (window as any).__failWebGL = false; });
  await page.getByRole("button", { name: "3Dを再試行", exact: true }).click();
  await expect(page.locator('[data-scene-fallback]')).toBeHidden();
  const canvas = page.locator('canvas[data-scene-state="active"]');
  await expect(canvas).toBeVisible();
  expect(await old!.evaluate(node => node.isConnected)).toBe(false);
  const before = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
});

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
  await expect(page.getByRole("slider").first()).toBeVisible();
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
  await page.getByRole("button", { name: "3Dを再試行", exact: true }).click();
  await expect(page.locator('canvas[data-scene-state="active"]')).toBeVisible();
  await expect(page.locator("[data-scene-fallback]")).toBeHidden();
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
    await expect(page.getByRole('button', { name: 'スライムを動かす', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: '動きを止める', exact: true }).click();
  await expectStopped();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectStopped();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expectStopped();
  await page.getByRole('button', { name: /裁判に参加する/ }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await expect(page.getByRole('slider').first()).toBeVisible();
  await expectStopped();
  await page.getByRole('button', { name: 'スライム裁判 ホームへ', exact: true }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await expectStopped();
});
