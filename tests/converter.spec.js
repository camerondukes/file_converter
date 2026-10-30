import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixture = name => path.resolve('tests/fixtures', name);

test('shows separate input/output formats and matching file rules', async ({ page }) => {
  await page.goto('');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('webm');
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('mp4');
  await expect(page.locator('#fromFormat option')).toHaveText(['WebM']);
  await expect(page.locator('#toFormat option')).toHaveText(['MP4']);
  await expect(page.locator('#fileInput')).toHaveAttribute('accept', '.webm,video/webm');
  await expect(page.locator('#dropTitle')).toHaveText('Drop your WebM files here');
  await expect(page.locator('#convert')).toContainText('Convert to MP4');
});

test('batch converts real video with and without audio into playable MP4 downloads', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('');
  await page.locator('#fileInput').setInputFiles([fixture('with-audio.webm'), fixture('silent.webm')]);
  await expect(page.locator('#fileCount')).toHaveText('2');
  await page.getByRole('button', { name: 'Convert to MP4' }).click();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(2, { timeout: 90000 });

  for (const [index, audio] of [true, false].entries()) {
    const pending = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download MP4' }).nth(index).click();
    const download = await pending;
    const output = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(output);
    const bytes = fs.readFileSync(output);
    expect(download.suggestedFilename()).toBe(audio ? 'with-audio.mp4' : 'silent.mp4');
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    // MP4 sample entries identify the H.264 and optional AAC tracks.
    expect(bytes.includes(Buffer.from('avc1'))).toBe(true);
    expect(bytes.includes(Buffer.from('mp4a'))).toBe(audio);

    await page.getByRole('button', { name: 'Preview', exact: true }).nth(index).click();
    await expect(page.locator('dialog')).toBeVisible();
    await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThan(0);
    const metadata = await page.locator('video').evaluate(video => ({
      width: video.videoWidth, height: video.videoHeight, duration: video.duration,
    }));
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
    expect(metadata.duration).toBeGreaterThan(0.8);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('dialog')).not.toBeVisible();
  }
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('converted-desktop.png'), fullPage: true });
});

test('validates, deduplicates, removes and handles hostile filenames as text', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('#convert')).toBeDisabled();
  const invalid = { name: '<img src=x onerror=alert(1)>.txt', mimeType: 'text/plain', buffer: Buffer.from('wrong') };
  await page.locator('#fileInput').setInputFiles([
    invalid, { name: 'empty.webm', mimeType: 'video/webm', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.locator('#fileCount')).toHaveText('2');
  await expect(page.locator('#convert')).toBeDisabled();
  await expect(page.locator('#fileList img')).toHaveCount(0);
  await expect(page.locator('#fileList')).toContainText('Unsupported file. Choose a .webm file.');
  await page.locator('#fileInput').setInputFiles(fixture('silent.webm'));
  await page.locator('#fileInput').setInputFiles(fixture('silent.webm'));
  await expect(page.locator('#fileCount')).toHaveText('3');
  await page.getByRole('button', { name: 'Remove empty.webm', exact: true }).click();
  await expect(page.locator('#fileCount')).toHaveText('2');
  await page.getByRole('button', { name: 'Clear All Files' }).click();
  await expect(page.locator('#empty')).toBeVisible();
});

test('reports corrupt inputs and continues with a good file', async ({ page }) => {
  await page.goto('');
  await page.locator('#fileInput').setInputFiles([
    { name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video') },
    { name: 'silent.webm', mimeType: 'video/webm', buffer: fs.readFileSync(fixture('silent.webm')) },
  ]);
  await page.locator('#convert').click();
  await expect(page.locator('#batchStatus')).toContainText('1 converted · 1 failed', { timeout: 90000 });
  await expect(page.locator('#globalError')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(1);
});

test('cancels engine loading, restores the queue and permits retry', async ({ page }) => {
  await page.goto('');
  let requested;
  const engineRequested = new Promise(resolve => { requested = resolve; });
  let release;
  const resumeLoading = new Promise(resolve => { release = resolve; });
  await page.route('**/ffmpeg-core.wasm', async route => {
    requested();
    await resumeLoading;
    await route.continue().catch(() => {});
  });
  await page.locator('#fileInput').setInputFiles(fixture('silent.webm'));
  await page.locator('#convert').click();
  await engineRequested;
  await expect(page.getByLabel('From', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('To', { exact: true })).toBeDisabled();
  await page.locator('#cancel').click();
  await expect(page.locator('#batchStatus')).toContainText('Batch cancelled');
  await expect(page.locator('#convert')).toBeEnabled();
  await expect(page.getByLabel('From', { exact: true })).toBeEnabled();
  release();
  await page.unroute('**/ffmpeg-core.wasm');
  await page.locator('#convert').click();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(1, { timeout: 90000 });
});

test('mobile layout and themes stay within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('');
  await page.locator('#fileInput').setInputFiles(fixture('silent.webm'));
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mobile-${colorScheme}.png`), fullPage: true });
  }
});
