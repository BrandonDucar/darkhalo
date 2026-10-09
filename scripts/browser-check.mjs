import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.DARKHALO_TEST_URL || 'http://127.0.0.1:5187';
const output = resolve(process.env.DARKHALO_TEST_OUTPUT || 'test-results');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
async function keyboardFocus(page, target, label) {
  for (let step = 0; step < 80; step++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) {
      assert.equal(await target.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none' && getComputedStyle(element).outlineWidth !== '0px'), true, `${label} has visible keyboard focus`);
      return;
    }
  }
  assert.fail(`${label} is not reachable by keyboard`);
}

async function keyboardOnlyWorkflow(page) {
  const sample = page.getByRole('button', { name: 'Load synthetic sample', exact: true });
  await keyboardFocus(page, sample, 'Synthetic sample');
  await page.keyboard.press('Enter');

  const inspect = page.getByRole('button', { name: 'Import + inspect', exact: false });
  await keyboardFocus(page, inspect, 'Import + inspect');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Inspection findings', exact: true }).waitFor();
  await page.getByText('SYNTHETIC', { exact: true }).first().waitFor();

  const capsuleTab = page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Capsule', exact: true });
  await keyboardFocus(page, capsuleTab, 'Capsule navigation');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Export capsule', exact: true }).waitFor();
  const capsule = JSON.parse(await page.getByRole('textbox', { name: 'Export capsule JSON preview' }).inputValue());
  assert.equal(capsule.records.length, 4, 'Keyboard path reaches the synthetic capsule');

  const downloadEvent = page.waitForEvent('download');
  const downloadButton = page.getByRole('button', { name: 'Download JSON', exact: true });
  await keyboardFocus(page, downloadButton, 'Capsule download');
  await page.keyboard.press('Enter');
  assert.match((await downloadEvent).suggestedFilename(), /\.json$/);
}

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.host !== new URL(base).host) external.push(request.url());
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Evidence intake', exact: true }).waitFor();
    assert.equal(await page.locator('.metrics-strip').count(), 0, 'Cold start must not fabricate live metrics');
    await page.screenshot({ path: resolve(output, `intake-${viewport.width}.png`), fullPage: true });
    await keyboardOnlyWorkflow(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Evidence intake', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load synthetic sample', exact: true }).click();
    await page.getByRole('button', { name: 'Import + inspect', exact: false }).click();
    await page.getByRole('heading', { name: 'Inspection findings', exact: true }).waitFor();
    assert.equal(await page.locator('.record-row').count(), 4);
    await page.getByRole('button', { name: 'Local blocked', exact: true }).click();
    assert.equal(await page.locator('.record-row').count(), 1);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search records by text, ID, author, or source', exact: true }).fill('Observer C');
    assert.equal(await page.locator('.record-row').count(), 1);
    await page.getByRole('textbox', { name: 'Search records by text, ID, author, or source', exact: true }).fill('');
    await page.screenshot({ path: resolve(output, `findings-${viewport.width}.png`), fullPage: true });
    const tab = async name => {
      const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
      if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
      await nav.getByRole('button', { name, exact: false }).click();
    };
    await tab('Context');
    assert.equal(await page.locator('.footprint-chart').count(), 1);
    await tab('Capsule');
    const preview = await page.getByRole('textbox', { name: 'Export capsule JSON preview' }).inputValue();
    const capsule = JSON.parse(preview);
    assert.equal(capsule.evidenceClass, 'LOCAL_ANALYSIS');
    assert.equal(capsule.purpose, 'REVIEW_ONLY');
    assert.equal(capsule.records.length, 4);
    assert.ok(capsule.records.filter(row => row.gate.status === 'BLOCKED').every(row => !row.compressedText));
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /\.json$/);
    await tab('Intake');
    await page.getByRole('textbox', { name: 'Authority IDs, one per line', exact: true }).fill('synthetic-revoked-authority\nFabricated Observer A');
    await page.getByRole('button', { name: 'Import + inspect', exact: false }).click();
    await page.getByRole('button', { name: 'Local blocked', exact: true }).click();
    assert.equal(await page.locator('.record-row').count(), 2, 'Revocation must affect the next analysis');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('textbox', { name: 'Evidence input JSON', exact: true }).fill('{ invalid');
    await page.getByRole('button', { name: 'Import + inspect', exact: false }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Invalid JSON/);
    assert.equal(await page.locator('.metrics-strip').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `Viewport ${viewport.width} horizontal overflow: ${overflow}`);
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert.deepEqual(external, [], 'No outside requests while inspecting/exporting');
    results.push({ viewport, status: 'PASS', coldStartNoMetrics: true, records: 4,
      filters: true, localRevocation: true, capsuleDownload: true, malformedInput: true,
      keyboardOnlyIntakeFindingsCapsule: true,
      horizontalOverflow: overflow, runtimeErrors: errors, externalRequests: external });
    await context.close();
  }
  writeFileSync(resolve(output, 'browser-results.json'), JSON.stringify({ observedAt: new Date().toISOString(), base, synthetic: true, results }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', viewports: results.length, scope: 'Synthetic browser interaction, not live provider or economic proof' }));
} finally {
  await browser.close();
}
