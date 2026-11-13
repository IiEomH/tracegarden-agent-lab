import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../server.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'tracegarden-ui-'));
const artifacts = fileURLToPath(new URL('../test-artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const app = createApp({ dataDir });
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const port = app.server.address().port;
function findChromium(root) {
  if (!root || !existsSync(root)) return '';
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'chrome.exe') return path;
    if (entry.isDirectory()) {
      const found = findChromium(path);
      if (found) return found;
    }
  }
  return '';
}
const executablePath = existsSync(chromium.executablePath())
  ? chromium.executablePath()
  : findChromium(join(process.env.LOCALAPPDATA || '', 'ms-playwright'));
if (!executablePath) throw new Error('No Chromium executable found for UI verification');
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(artifacts, 'overview.png'), fullPage: true });
  await page.getByRole('button', { name: /运行演示评测|新建评测/ }).last().click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(artifacts, 'running.png'), fullPage: true });
  await page.waitForTimeout(2800);
  await page.getByRole('button', { name: /Trace/ }).first().click();
  await page.screenshot({ path: join(artifacts, 'trace.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭' }).click();
  await page.locator('button.nav-item[data-page="cases"]').click();
  await page.getByRole('button', { name: /添加测试用例/ }).first().click();
  await page.screenshot({ path: join(artifacts, 'case-modal.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Mobile layout overflows horizontally by ${overflow}px`);
  await page.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
  console.log('UI verification passed');
} finally {
  await browser.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
}
