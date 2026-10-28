import { expect, test } from '@playwright/test';

test('upload waits for queued draft then reviews real city, evidence, and version', async ({ context, page }) => {
  let polls = 0;
  let applyBody: any;
  const fields = [{ path: 'inventory.粮食', value: 42, raw: '42', status: 'known', evidence: '右上角粮食图标' }, { path: 'inventory.木头', value: null, raw: null, status: 'unknown' }];
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/cities') return route.fulfill({ json: { cities: [{ id: 'city', displayName: '应天府' }] } });
    if (path === '/api/v1/uploads') return route.fulfill({ json: { upload: { id: 'upload' } } });
    if (path === '/api/v1/recognition-jobs') return route.fulfill({ status: 202, json: { job: { id: 'job', status: 'queued' } } });
    if (path === '/api/v1/jobs/job') return route.fulfill({ json: { job: ++polls < 2 ? { status: 'running' } : { status: 'succeeded', result: { draft: { id: 'draft' } } } } });
    if (path === '/api/v1/recognition-drafts/draft') return route.fulfill({ json: { draft: { id: 'draft', status: 'pending_review', fields }, city: { id: 'city', displayName: '应天府', version: 7, state: { inventory: { 粮食: 5 } } } } });
    if (path.endsWith('/apply')) { applyBody = route.request().postDataJSON(); return route.fulfill({ json: { city: {} } }); }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/imports');
  await expect(page.getByLabel('关联城市')).toHaveValue('city');
  await page.locator('input[type=file]').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: Buffer.from('controlled-upload') });
  await page.getByRole('button', { name: '上传并识别草稿' }).click();
  await expect(page.getByRole('link', { name: '去校正草稿' })).toBeVisible();
  expect(polls).toBeGreaterThanOrEqual(2);
  await page.getByRole('link', { name: '去校正草稿' }).click();
  await expect(page.getByText('应天府 · 当前存档版本 7')).toBeVisible();
  await expect(page.getByText('原文：42 · 右上角粮食图标')).toBeVisible();
  const inputs = page.locator('form input');
  await expect(inputs.nth(0)).toHaveValue('42');
  await expect(inputs.nth(1)).toHaveValue('');
  await page.getByRole('button', { name: '确认应用' }).click();
  await expect(page.getByRole('status')).toHaveText('已应用');
  expect(applyBody.expectedVersion).toBe(7);
  expect(applyBody.corrections.fields[1]).toMatchObject({ value: null, status: 'unknown' });
});
