import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Capture the actual empty workspace, never private inputs or fabricated results.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('http://127.0.0.1:5187', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Evidence intake', exact: true }).waitFor();
  assert.equal(await page.locator('#input-editor').inputValue(), '');
  assert.equal(await page.locator('.metrics-strip').count(), 0);
  await page.screenshot({ path: resolve('public/darkhalo-workspace.png') });
  console.log('Saved public/darkhalo-workspace.png: actual empty local workspace.');
} finally {
  await browser.close();
}
