const { chromium } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("https://laoyou.love/zhengce", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "scripts/shot-zhengce.png", fullPage: true });
  await browser.close();
  console.log("OK");
})().catch((e) => { console.error(e); process.exit(1); });
