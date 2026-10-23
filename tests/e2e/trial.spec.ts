import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('button', { name: '裁判に参加する' }).click(); });
test('all twenty cases allow both signs, review and explicit unsent confirmation', async ({ page }) => {
  for (let index = 0; index < 20; index++) {
    await expect(page.getByTestId('case-number')).toHaveText(`審理 ${String(index + 1).padStart(2, '0')}`);
    await page.getByRole('radio', { name: '−5 強く刑罰を求める', exact: true }).click();
    await page.getByRole('radio', { name: '＋5 強く待遇改善を求める', exact: true }).click();
    await expect(page.getByRole('radio', { name: '＋5 強く待遇改善を求める', exact: true })).toHaveAttribute('aria-checked','true');
    if (index < 19) await page.getByRole('button', { name: '次の審理へ' }).click();
  }
  await page.getByRole('button', { name: '回答を確認する' }).click();
  await expect(page.getByRole('heading', { name: 'あなたの判断を確認' })).toBeVisible();
  await expect(page.getByText('20 / 20 件を回答済み')).toBeVisible();
  await expect(page.getByRole('button', { name: /未送信の結果を見る|この判断を提出する/ })).toBeEnabled();
});
test('nineteen answers cannot submit and controls remain usable at enlarged text', async ({ page }) => {
  for (let index = 0; index < 19; index++) {
    await page.getByRole('radio', { name:'＋1 わずかに待遇改善を求める', exact:true }).click();
    await page.getByRole('button', { name:'次の審理へ' }).click();
  }
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByRole('button', { name: '回答一覧' }).click();
  await expect(page.getByRole('button', { name: /未送信の結果を見る|この判断を提出する/ })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sizes = await page.locator('button').evaluateAll(elements => elements.filter(el => !el.hidden).map(el => ({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
  for (const size of sizes) { expect(size.w).toBeGreaterThanOrEqual(44); expect(size.h).toBeGreaterThanOrEqual(44); }
});
