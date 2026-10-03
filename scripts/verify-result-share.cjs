const fs = require("fs");
const path = require("path");

// 加载 ShareHelper（UMD 在 ESM/Node 混用环境下不稳定，使用隔离模块上下文执行）
const shareCode = fs.readFileSync(path.join(__dirname, "../public/share.js"), "utf-8");
const shareFactory = new Function("module", "exports", shareCode);
const shareModule = { exports: {} };
shareFactory(shareModule, shareModule.exports);
const ShareHelper = shareModule.exports;
const schools = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schools.json"), "utf-8"));

const DISTRICT_ORDER = { chengliuqu: 1, xixian: 2, changan: 3 };
const DATA_DISTRICT = {
  xincheng: "chengliuqu", yanta: "chengliuqu", beilin: "chengliuqu", lianhu: "chengliuqu",
  weiyang: "chengliuqu", bashan: "chengliuqu", xixian: "xixian", changan: "changan",
};

function recommendSchools(schools, score, district) {
  const target = DATA_DISTRICT[district] || "chengliuqu";
  const scored = schools.map((s) => {
    const years = Object.keys(s.cut).map(Number).sort((a, b) => b - a);
    const ref = s.cut[String(years[0])] || 0;
    const gap = ref - score;
    return { ...s, ref, gap, absGap: Math.abs(gap), in30: Math.abs(gap) <= 30 };
  });

  let result = scored
    .filter((s) => s.district === target && s.in30)
    .sort((a, b) => a.absGap - b.absGap);

  if (result.length < 15) {
    const rest = scored
      .filter((s) => s.district === target && !result.includes(s))
      .sort((a, b) => a.absGap - b.absGap);
    result = result.concat(rest);
  }

  if (result.length < 15) {
    const used = new Set(result.map((s) => s.id));
    const rest = scored
      .filter((s) => !used.has(s.id))
      .sort((a, b) => {
        const da = DISTRICT_ORDER[a.district] || 99;
        const db = DISTRICT_ORDER[b.district] || 99;
        if (da !== db) return da - db;
        return a.absGap - b.absGap;
      });
    result = result.concat(rest);
  }

  return result.slice(0, 15);
}

console.log("=== result.html 算法验证 ===\n");
const cases = [
  { score: 500, district: "yanta" },
  { score: 560, district: "beilin" },
  { score: 620, district: "xincheng" },
  { score: 660, district: "changan" },
];
let allPass = true;
for (const c of cases) {
  const list = recommendSchools(schools, c.score, c.district);
  const in30 = list.filter((s) => s.in30).length;
  const gaps = list.map((s) => s.gap);
  const maxGap = Math.max(...gaps.map(Math.abs));
  const ok = list.length === 15;
  if (!ok) allPass = false;
  console.log(`分数 ${c.score} · 区域 ${c.district} → 输出 ${list.length} 所，其中 ${in30} 所在 ±30 分内，最大 gap ${maxGap} 分`);
  list.forEach((s, i) => console.log(`  #${i + 1} ${s.name} ${s.ref} 分 (gap ${s.gap > 0 ? "+" : ""}${s.gap})${s.in30 ? "" : " [范围外补充]"}`));
  console.log();
}
console.log(allPass ? "✅ 全部恒出 15 所\n" : "⚠️ 部分分数未输出 15 所\n");

console.log("=== share.js 阶梯定价验证 ===\n");
const priceCases = [
  { count: 0, expectedPrice: 19.9, expectedDiscount: 0 },
  { count: 1, expectedPrice: 9.9, expectedDiscount: 10 },
  { count: 3, expectedPrice: 9.9, expectedDiscount: 10 },
  { count: 4, expectedPrice: 9.9, expectedDiscount: 20 },
  { count: 9, expectedPrice: 9.9, expectedDiscount: 20 },
  { count: 10, expectedPrice: 0, expectedDiscount: 19.9 },
  { count: 15, expectedPrice: 0, expectedDiscount: 19.9 },
];
let pricePass = true;
for (const c of priceCases) {
  const info = ShareHelper.priceForCount(c.count);
  const ok = info.currentPrice === c.expectedPrice && info.discount === c.expectedDiscount;
  if (!ok) pricePass = false;
  console.log(
    `人数 ${String(c.count).padStart(2)} → 当前价 ${info.currentPrice.toFixed(1)} 元，抵扣 ${info.discount.toFixed(1)} 元，进度 ${info.progress.toFixed(0)}% ${ok ? "✅" : "❌"}`
  );
}
console.log(pricePass ? "\n✅ 阶梯定价符合需求" : "\n❌ 阶梯定价不符合需求");
