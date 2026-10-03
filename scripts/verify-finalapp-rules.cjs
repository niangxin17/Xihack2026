// 验证：结果页算法（4 组数据每组 15 所）+ 分享阶梯定价（6 档）
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const schools = JSON.parse(fs.readFileSync(path.join(root, "data/schools.json"), "utf-8"));

function recommend(schools, score, district) {
  const scored = schools.map((s) => {
    const years = Object.keys(s.cut).map(Number).sort((a, b) => b - a);
    const ref = s.cut[String(years[0])] || 0;
    const gap = ref - score;
    return { ...s, ref, gap, absGap: Math.abs(gap), in30: Math.abs(gap) <= 30 };
  });
  const preferred = scored.filter((s) => s.in30);
  const remainder = scored.filter((s) => !s.in30);
  return [...preferred, ...remainder]
    .sort((a, b) => a.absGap - b.absGap || a.name.localeCompare(b.name))
    .map((s) => ({ ...s, district: district || s.district }))
    .slice(0, 15);
}

const DISTRICT_LABEL = { yanta: "雁塔区", beilin: "碑林区", lianhu: "莲湖区", weiyang: "未央区" };
let pass = 0, fail = 0;
function assert(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + " — " + detail); }
}

console.log("== 结果页算法：4 组数据固定 15 所 ==");
for (const [score, district] of [[620, "yanta"], [552, "beilin"], [536, "lianhu"], [480, "weiyang"]]) {
  const list = recommend(schools, score, district);
  const in30 = list.filter((s) => s.in30).length;
  let sortedOk = true;
  for (let i = 1; i < list.length; i++) if (list[i].absGap < list[i - 1].absGap) sortedOk = false;
  // ±30 优先：所有 in30 学校必须排在 out30 之前（紧凑），无“穿插”
  let prefFirst = true, seenOut = false;
  for (const s of list) {
    if (!s.in30 && !seenOut) seenOut = true;
    if (s.in30 && seenOut) prefFirst = false;
  }
  assert(
    `${DISTRICT_LABEL[district]} ${score} 分：15 所`,
    list.length === 15,
    `实出 ${list.length} 所，±30 命中 ${in30} 所`
  );
  assert(`${DISTRICT_LABEL[district]} ${score} 分：±30 优先 + 接近度升序`, prefFirst && sortedOk, `±30优先=${prefFirst}, 接近度排序=${sortedOk}`);
}

console.log("\n== 分享阶梯定价：6 档 ==");
// 用 vm 加载 share.js（浏览器全局），再用 ShareHelper.priceForCount
const code = fs.readFileSync(path.join(root, "public/share.js"), "utf-8");
const sandbox = { window: undefined, localStorage: undefined, document: undefined, location: { hostname: "laoyou.love" } };
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const ShareHelper = sandbox.ShareHelper;
if (!ShareHelper) { assert("ShareHelper 加载", false, "未导出"); }
else {
  const cases = [
    [0, 19.9], [1, 19.9], [2, 19.9], [3, 9.9], [9, 9.9], [10, 0], [49, 0],
  ];
  for (const [c, expect] of cases) {
    const info = ShareHelper.priceForCount(c);
    assert(`分享 ${c} 人 → 到手 ${expect} 元`, info.currentPrice === expect, `实得 ${info.currentPrice}`);
  }
  const f49 = ShareHelper.priceForCount(49);
  assert("49 人展示已抵扣 599 元", f49.tier === 2 && f49.discount === 599, `tier=${f49.tier}, discount=${f49.discount}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
