// 验证「录取概率」是否出现在各冲稳保分析展示中
// 用法：node scripts/verify-prob.cjs
const { chromium } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright");

const BASE = "https://laoyou.love";
const STORE = {
  ly_profile_locked: JSON.stringify({
    score: 600,
    district: "yanta",
    juniorSchool: "西安市某初中",
    directionalSchool: "",
    packageId: "match_29_9",
  }),
  ly_paid_plans: JSON.stringify([
    { orderId: "test_o1", planId: "match_29_9", ts: Date.now() },
    { orderId: "test_o2", planId: "planning_199", ts: Date.now() },
    { orderId: "test_o3", planId: "review_599", ts: Date.now() },
  ]),
};

async function setStore(page) {
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, STORE);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  const results = {};
  try {
    await setStore(page);

    // 1) 排序报告（29.9）
    await page.goto(BASE + "/reports/sort", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const sortText = await page.innerText("body");
    results.sort_hasProb = /录取概率/.test(sortText);
    results.sort_sample = (sortText.match(/录取概率约\s*\d+%/g) || []).slice(0, 3);

    // 2) 适配报告（199）
    await page.goto(BASE + "/reports/fit", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const fitText = await page.innerText("body");
    results.fit_hasProb = /录取概率/.test(fitText);
    results.fit_tableProb = /≈\d+%/.test(fitText);

    // 3) 复核报告（599）
    await page.goto(BASE + "/reports/review", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const revText = await page.innerText("body");
    results.review_hasProb = /录取概率/.test(revText);

    // 4) 志愿模拟页：智能生成方案后行明细应显示 冲/稳/保·录取≈xx%
    await page.goto(BASE + "/filing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const genBtn = page.getByRole("button", { name: /智能生成方案/ });
    if (await genBtn.count()) {
      await genBtn.first().click();
      await page.waitForTimeout(1000);
    }
    const filingText = await page.innerText("body");
    results.filing_hasProb = /录取≈\d+%/.test(filingText);

    // 截图
    await page.goto(BASE + "/reports/sort", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "scripts/shot-sort.png", fullPage: true });
    await page.goto(BASE + "/filing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const gb2 = page.getByRole("button", { name: /智能生成方案/ });
    if (await gb2.count()) { await gb2.first().click(); await page.waitForTimeout(1000); }
    await page.screenshot({ path: "scripts/shot-filing.png", fullPage: true });
  } catch (e) {
    results.error = String(e && e.stack ? e.stack : e);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
})();
