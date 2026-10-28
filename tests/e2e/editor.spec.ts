import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext } from '@playwright/test';

const emptyLayout = () => ({
  schemaVersion: 1, knowledgeVersion: null, width: 12, height: 10,
  buildable: [{ x: 0, y: 0, w: 12, h: 10 }], blocked: [], roads: [],
  buildings: [] as Array<{ id: string; typeName: string; x: number; y: number; w: number; h: number; rotation: number; locked: boolean }>,
  customBasemap: true,
});

async function layoutApi(context: BrowserContext) {
  let saved: { version: number; layout: ReturnType<typeof emptyLayout> } | null = null;
  const submittedVersions: Array<number | null> = [];
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/cities') {
      return route.fulfill({ json: { cities: [{ id: 'city-a', displayName: '应天府', cityKey: 'yingtian' }, { id: 'city-b', displayName: '苏州', cityKey: 'suzhou' }] } });
    }
    if (/\/cities\/city-[ab]\/layout$/.test(path)) {
      if (route.request().method() === 'GET') return route.fulfill({ json: { layout: saved } });
      const body = route.request().postDataJSON();
      submittedVersions.push(body.expectedVersion);
      if (body.expectedVersion !== (saved?.version ?? null)) return route.fulfill({ status: 409, json: { error: { code: 'VERSION_CONFLICT' } } });
      saved = { version: (saved?.version ?? 0) + 1, layout: body.layout };
      return route.fulfill({ json: { layout: saved } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return { versions: submittedVersions, getSaved: () => saved };
}

test('saved layout reopens and a stale tab cannot overwrite another save', async ({ context, page }) => {
  const api = await layoutApi(context);
  await page.goto('/editor?cityId=city-a');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '农田' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  expect(api.getSaved()?.layout.buildings).toHaveLength(1);
  await page.reload();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const downloaded = await downloadPromise;
  expect(JSON.parse(await readFile((await downloaded.path())!, 'utf8')).buildings).toHaveLength(1);
  const stale = await context.newPage();
  await stale.goto('/editor?cityId=city-a');
  await expect(stale.getByTestId('building-count')).toHaveText('建筑数：1');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await stale.getByRole('button', { name: '保存', exact: true }).click();
  await expect(stale.getByRole('status')).toContainText('409');
  expect(api.versions).toEqual([null, 1, 1]);
  expect(api.getSaved()?.version).toBe(2);
});

test('city must be selected before editing or saving', async ({ context, page }) => {
  await layoutApi(context);
  await page.goto('/editor');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.getByLabel('城市存档').selectOption('city-b');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/cityId=city-b/);
});

test('mobile can browse the saved layout', async ({ context, page }) => {
  const api = await layoutApi(context);
  await page.goto('/editor?cityId=city-a');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '农田' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  expect(api.getSaved()?.layout.buildings).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('building-count')).toHaveText('建筑数：1');
  await expect(page.getByText('手机端先提供浏览与检查')).toBeVisible();
});

test('selecting a city edits its actual inventory rather than the form default', async ({ context, page }) => {
  await context.route('**/api/v1/cities', (route) => route.fulfill({ json: { cities: [{
    id: 'city-a', displayName: '应天府', cityKey: 'yingtian', version: 1,
    state: { prefectLevel: 1, inventory: { 粮食: 77 }, workersAvailable: 2, buildings: [], unlockedAreas: [] },
  }] } }));
  await page.goto('/cities');
  await page.getByRole('button', { name: '应天府', exact: true }).click();
  await expect(page.getByLabel('粮食库存')).toHaveValue('77');
});
