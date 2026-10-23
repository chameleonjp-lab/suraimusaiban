import { expect, test } from '@playwright/test';

test('WebGL unavailable leaves a static slime and usable trial', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind.includes('webgl')) return null;
      return getContext.apply(this, [kind, ...args] as Parameters<typeof getContext>);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.locator('[data-scene-fallback]')).toBeVisible();
  await page.getByRole('button', { name: /審理をはじめる|審理に参加|裁判に参加|裁判をはじめる|裁判を始める/ }).click();
  await expect(page.getByRole('radiogroup').first()).toBeVisible();
});

test('context loss replaces the canvas with the same model fallback', async ({ page }) => {
  await page.goto('/');
  await page.locator('canvas').first().evaluate(canvas => {
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('[data-scene-fallback]')).toBeVisible();
});
