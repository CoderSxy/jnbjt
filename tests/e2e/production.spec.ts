import { expect, test } from '@playwright/test';

test('calculates selected resource from city and server recipe without client rules', async ({ page }) => {
  let submitted: unknown;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/cities/sz') return route.fulfill({ json: { city: { id: 'sz', cityKey: 'suzhou', displayName: '苏州', state: { inventory: { 粮食: 80 } } } } });
    if (path.endsWith('/production-recipes')) return route.fulfill({ json: { recipes: [{ id: 'reviewed-sz', name: '农田 · 苏州 · 普通', sourceNote: 'snapshot:source-sz', outputs: [{ resource: '经验' }, { resource: '粮食' }] }] } });
    if (path.endsWith('/calculate')) {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { result: { status: 'ok', gaps: { 粮食: 9920 }, rounds: 496 } } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/production?cityId=sz');
  await page.getByLabel('生产配方').selectOption('reviewed-sz');
  await page.getByLabel('目标资源').selectOption('粮食');
  await expect(page.getByText('当前库存：80')).toBeVisible();
  await page.getByLabel('目标总库存').fill('10000');
  await page.getByLabel('每天上线次数').fill('4');
  await page.getByRole('button', { name: '计算', exact: true }).click();
  await expect(page.locator('pre')).toContainText('9920');
  expect(submitted).toEqual({ cityId: 'sz', recipeId: 'reviewed-sz', targetInventory: { 粮食: 10000 }, onlineFrequencyPerDay: 4 });
});

test('draft-only city asks for verified data instead of running a demo recipe', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: route.request().url().endsWith('/production-recipes') ? { recipes: [] } : { city: { id: 'sz', displayName: '苏州', cityKey: 'suzhou', state: { inventory: {} } } } }));
  await page.goto('/production?cityId=sz');
  await expect(page.getByText('当前城市没有已审核且有来源的有效配方。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '计算', exact: true })).toBeDisabled();
});
