import { chromium } from '@playwright/test';

const BASE = 'https://apos.nxtgensec.org';
const PDF = '/tmp/fixture.pdf';
const PNG = '/tmp/fixture-text.png';

const tools = [
  'merge-pdf', 'split-pdf', 'rotate-pdf', 'organize-pages', 'delete-pdf-pages', 'extract-pdf-pages',
  'duplicate-pdf-pages', 'add-blank-pdf-pages', 'protect-pdf', 'compress-pdf', 'repair-pdf', 'optimize-pdf',
  'pdf-to-images', 'pdf-to-text', 'pdf-to-html', 'pdf-to-office', 'images-to-pdf', 'pdf-watermark',
  'pdf-page-numbers', 'ocr-pdf', 'ocr-image', 'document-to-pdf', 'spreadsheet-to-pdf', 'presentation-to-pdf',
  'universal-converter', 'ai-document-agent', 'pdf-metadata', 'file-inspector',
];

const SKIP = /cancel|clear|remove|reset|undo|delete file|add more|choose|browse|select files|try again|close/i;
const VERB = /merge|split|convert|compress|repair|optimize|extract|delete|duplicate|reorder|add blank|rotate|protect|watermark|number|ocr|read|generate|create|run|start|inspect|apply|scan|export|build/i;

const browser = await chromium.launch();
const rows = [];

for (const id of tools) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });
  let result = 'OK';
  try {
    await page.goto(`${BASE}/tools/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const inputs = page.locator('input[type=file]');
    const nInputs = await inputs.count();
    if (nInputs === 0) { result = 'NO FILE INPUT'; }
    else {
      for (let i = 0; i < nInputs; i++) {
        const accept = (await inputs.nth(i).getAttribute('accept')) || '';
        const file = /image|png|jpg|jpeg/i.test(accept) && !/pdf/i.test(accept) ? PNG : /image|png|jpg/i.test(accept) ? PNG : PDF;
        await inputs.nth(i).setInputFiles(file).catch(() => {});
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(800);
      const buttons = page.locator('.tool-panel button:not([disabled])');
      const labels = [];
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const t = (await buttons.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
        if (t) labels.push(t);
      }
      const target = labels.find((t) => VERB.test(t) && !SKIP.test(t));
      if (!target) result = 'NO ACTION BUTTON [' + labels.join(' | ').slice(0, 80) + ']';
      else {
        const btn = page.locator('.tool-panel button:not([disabled])').filter({ hasText: target }).first();
        await btn.click({ timeout: 15000 });
        const started = Date.now();
        let outcome = '';
        while (Date.now() - started < 40000) {
          const links = await page.locator('.tool-panel a[download], .tool-panel a[href^="blob:"]').count();
          const ok = await page.getByText(/validated|ready to download|complete|generated|finished|download/i).count();
          const err = await page.locator('.tool-panel [role=alert], .tool-panel .error').count();
          if (links > 0 || ok > 0) { outcome = 'PASS'; break; }
          if (err > 0) { outcome = 'ERROR STATE'; break; }
          await page.waitForTimeout(500);
        }
        result = outcome || 'NO RESULT after 40s (' + target + ')';
      }
    }
  } catch (e) {
    result = 'EXCEPTION ' + String(e.message).slice(0, 90);
  }
  rows.push({ id, result, errors: errors.slice(0, 2) });
  await page.close();
}

await browser.close();
for (const r of rows) console.log(`${r.result === 'PASS' ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.result}${r.errors.length ? '  ERR: ' + r.errors.join(' || ') : ''}`);
