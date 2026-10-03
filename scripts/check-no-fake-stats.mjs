// 自动检查：防止「未经真实业务数据证明」的宣传数字/文案再次出现。
// 触发：本地或 CI 调用 `node scripts/check-no-fake-stats.mjs`（也已挂到 `npm run check:claims`）。
//
// 设计原则：
// 1) 只拦截「具体数字 + 宣传语境」的组合，避免误伤真实分数线（如 604.9 分）、版本号（4.92.0）、官方统计。
// 2) 项目当前没有真实客户，因此任何"家长数/成功率/评分/案例"类具体数字都视为违规，除非能指向后台记录或官方数据源。
// 3) 若需放行某个真实数字，应改为"基于官方招生计划与历年数据"等能力说明，而非展示无依据的绝对数。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// 守卫脚本自身的规则定义里包含违规字面量，必须跳过自己，否则会误报。
const SELF = fileURLToPath(import.meta.url);

// 扫描的源码目录（依赖/构建/产物/密钥/备份一律跳过）
const SCAN_DIRS = ["app", "public", "server", "worker", "db", "drizzle", "scripts", "tests", "components", "lib", "data"];
const SKIP_DIRS = new Set([
  "node_modules", "dist", "out", ".next", ".vinext", ".wrangler",
  ".sites-runtime", ".openai", ".workbuddy", ".git", "handoff",
]);
const SKIP_FILE = [/package-lock\.json$/, /\.bak/i, /\.lock$/i];

// 违规规则：id + 正则 + 说明。数字类规则均带"宣传语境"限定，降低误报。
const RULES = [
  { id: "家长已验证", pattern: /家长已验证/, why: "未经证实的家长验证数" },
  { id: "录取成功率", pattern: /录取成功率/, why: "未经证实的录取成功率" },
  { id: "家长评分", pattern: /家长评分/, why: "未经证实的家长评分" },
  { id: "3万/30000+家长", pattern: /(30,?000|三万|3万)\D{0,12}(家长|验证|用户)/, why: "夸大用户规模" },
  { id: "97.6%", pattern: /97\.6\s*%/, why: "未经证实的成功率百分比" },
  { id: "12847家长", pattern: /(12,?847)\D{0,12}(家长|生成|志愿|方案|已)/, why: "虚构用户计数" },
  {
    id: "4.9评分",
    // 仅匹配"4.9"作为独立评分（前后非数字），且紧跟 分/星/好评/评分，避免误伤分数线 604.9 分
    pattern: /(?<![\d.])4\.9(?!\d)\D{0,6}(分|星|★|好评|评分)|评分\D{0,6}(?<![\d.])4\.9(?!\d)/,
    why: "未经证实的评分",
  },
  { id: "万家长", pattern: /\d\s*万家长/, why: "夸大用户规模" },
  { id: "位/名家长计数", pattern: /\d[\d,]*\s*(位|名)\s*家长/, why: "虚构家长计数" },
  // 其他无法提供证据的从众/好评暗示（保守匹配，避免误伤"用户行为"等后台术语）
  { id: "从众暗示", pattern: /(多数|大部分|九成|90%|热门|爆款|热销)\s*(家长|用户|考生|同学)/, why: "无证据的社会证明暗示" },
];

function listFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      if (SKIP_FILE.some((re) => re.test(e.name))) continue;
      const full = join(dir, e.name);
      if (full === SELF) continue; // 跳过守卫脚本自身
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs|js|jsx?|html?|json|md|css)$/.test(e.name)) out.push(full);
    }
  };
  for (const d of SCAN_DIRS) {
    const p = join(ROOT, d);
    if (statSync(p, { throwIfNoEntry: false })) walk(p);
  }
  return out;
}

const files = listFiles();
const hits = [];
for (const f of files) {
  let content;
  try {
    content = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        hits.push({
          file: relative(ROOT, f),
          line: i + 1,
          rule: rule.id,
          why: rule.why,
          snippet: lines[i].trim().slice(0, 120),
        });
        break; // 同文件同规则只报一次
      }
    }
  }
}

if (hits.length) {
  console.error("❌ 发现未经真实业务数据证明的宣传内容（真实性闸门拦截）：");
  for (const h of hits) {
    console.error(`  - [${h.rule}] ${h.file}:${h.line}  (${h.why})`);
    console.error(`      ${h.snippet}`);
  }
  console.error(`\n共 ${hits.length} 处。请删除/替换为不含数字的真实能力说明后再提交。`);
  process.exit(1);
} else {
  console.log("✅ 未检测到违规宣传数字/文案（真实性闸门通过）。");
  process.exit(0);
}
