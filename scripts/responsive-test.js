const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const outDir = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const urls = [
  '/',
  '/inscrever',
  '/acompanhamento/1',
  '/painel/lider/1',
  '/painel/admin'
];

const viewports = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1366, height: 768 }
];

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const report = [];

  for (const vp of viewports) {
    await page.setViewport({ width: vp.width, height: vp.height });
    for (const urlPath of urls) {
      const url = `http://localhost:3000${urlPath}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(500);
        } else {
          await new Promise(r => setTimeout(r, 500));
        }
        const metrics = await page.evaluate(() => {
          const body = document.body;
          const container = document.querySelector('.container');
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: body.scrollWidth,
            scrollHeight: body.scrollHeight,
            containerWidth: container ? container.getBoundingClientRect().width : null
          };
        });

        const safePath = urlPath.replace(/\//g, '_') || '_root';
        const file = path.join(outDir, `${safePath}_${vp.name}_${vp.width}x${vp.height}.png`);
        await page.screenshot({ path: file, fullPage: true });

        report.push({ url, viewport: vp, metrics, screenshot: file });
        console.log(`OK  ${url} @ ${vp.name} (${vp.width}x${vp.height})`);
      } catch (err) {
        console.error(`ERR ${url} @ ${vp.name}:`, err.message);
        report.push({ url, viewport: vp, error: err.message });
      }
    }
  }

  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('Report saved to', reportPath);
  await browser.close();
})();
