// 步骤10 静态审计测试：连接成长地图与现有中考志愿系统。
// 通过读取源码验证连接正确性，不渲染组件、不安装依赖、不修改任何文件、不改动版本控制状态。
// 注意：测试注释与断言中不得出现会触发 check:claims 的虚假具体数字。
//
// 高风险约束：本文件为只读测试，不得执行任何会改变工作区或提交历史的命令，
// 亦不调用外部类型检查命令行工具；所有检查仅为只读源码与只读语法解析。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// 本步骤新增的“成长地图侧”文件（不应出现浏览器存储或自动跳转）。
const GROWTH_NEW = [
  "app/growth/components/EducationJourney.tsx",
  "app/components/EducationStageBridge.tsx",
];
// 中考系统侧被修改的页面（仅加返回入口，不引入家庭档案）。
const EXAM_PAGES = ["app/filing/page.tsx", "app/page.tsx"];

// 受保护的中考算法 / 支付 / 解锁相关文件清单（仅供人工核对，不在此测试内做 Git 写判定）：
//   app/lib/volunteer-data.ts
//   app/lib/profile-lock.ts
//   app/lib/entitlements.ts
//   app/checkout/page.tsx
//   app/unlock/page.tsx
//   app/lib/reports/
// 这些文件是否在步骤10被修改，由验收命令 `git diff --name-only f2e1477..HEAD` 只读确认，
// 不进入长期测试，以避免测试依赖工作区 Git 状态。

test("1) 真实中考路由来自现有 app 目录", () => {
  assert.ok(existsSync(join(ROOT, "app/page.tsx")), "中考测算首页 app/page.tsx 存在");
  assert.ok(existsSync(join(ROOT, "app/filing/page.tsx")), "志愿填报 app/filing/page.tsx 存在");
  assert.ok(existsSync(join(ROOT, "app/downloads/page.tsx")), "报告入口 app/downloads/page.tsx 存在");
  const home = read("app/page.tsx");
  assert.ok(/免费生成基础报告|中考分数/.test(home), "首页含测分表单");
  const filing = read("app/filing/page.tsx");
  assert.ok(/志愿填报/.test(filing), "志愿填报页含标题");
});

test("2) 成长地图包含测算与填报两个明确入口", () => {
  const ej = read("app/growth/components/EducationJourney.tsx");
  assert.ok(ej.includes('"开始中考测算"'), "含“开始中考测算”入口文案");
  assert.ok(ej.includes('"进入志愿填报"'), "含“进入志愿填报”入口文案");
  assert.ok(/href:\s*"\/"/.test(ej), "中考测算入口指向真实路由 /");
  assert.ok(/href:\s*"\/filing"/.test(ej), "志愿填报入口指向真实路由 /filing");
});

test("3) 规划中阶段不包含 href（不链接不存在页面）", () => {
  const ej = read("app/growth/components/EducationJourney.tsx");
  const planned = [
    "高中成长规划",
    "大学专业与院校规划",
    "考研规划",
    "博士发展规划",
    "职业发展规划",
  ];
  // 文件中所有 href 仅指向已审计的真实路由；规划中阶段不属于这些入口，故不出现 href。
  const hrefs = [...ej.matchAll(/href:\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(hrefs)].sort(),
    ["/", "/downloads", "/filing"],
    "所有 href 仅指向已审计真实路由（/、/filing、/downloads）",
  );
  for (const label of planned) {
    assert.ok(ej.includes(label), `规划中阶段含：${label}`);
    // 规划中阶段不得作为可点击入口（不出现在 EXAM_ENTRIES 的 title 中）。
    assert.ok(!ej.includes(`title: "${label}"`), `规划中阶段不得作为可点击入口：${label}`);
  }
  // “规划中”徽标以模板形式出现（.map 渲染为 5 个阶段），源文件中至少包含该模板。
  assert.ok(ej.includes("规划中"), "规划中阶段应带“规划中”徽标模板");
});

test("4) 中考公开页面包含返回 /growth 入口", () => {
  for (const p of EXAM_PAGES) {
    const c = read(p);
    assert.ok(c.includes('href="/growth"'), `${p} 含返回 /growth 链接`);
    assert.ok(c.includes("返回长安成长地图"), `${p} 含“返回长安成长地图”文案`);
  }
});

test("7) 不传递 FamilyProfile 到 URL", () => {
  const targets = [
    ...GROWTH_NEW,
    "app/growth/page.tsx",
    ...EXAM_PAGES,
  ];
  for (const p of targets) {
    const c = read(p);
    assert.ok(!/familyProfile|FamilyProfile|growth-family-profile/i.test(c),
      `${p} 不得引用 FamilyProfile`);
  }
});

test("8) 成长地图侧新增文件不使用浏览器存储", () => {
  for (const p of GROWTH_NEW) {
    const c = read(p);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon/i.test(c),
      `${p} 不得使用浏览器存储`);
  }
});

test("9) 成长地图侧新增文件不自动跳转", () => {
  for (const p of GROWTH_NEW) {
    const c = read(p);
    assert.ok(!/window\.location|router\.push|redirect\(/i.test(c),
      `${p} 不得包含自动跳转逻辑`);
  }
});

test("10) 包含阶段交接说明（5 条要点）", () => {
  const c = read("app/components/EducationStageBridge.tsx");
  assert.ok(c.includes("同一平台的不同阶段工具"), "要点1：同一平台不同阶段工具");
  assert.ok(c.includes("以你在中考系统填写的数据为准"), "要点2：以中考系统数据为准");
  assert.ok(c.includes("家庭档案不会自动传递"), "要点3：家庭档案不自动传递");
  assert.ok(c.includes("以官方最新公布为准"), "要点4：以官方为准");
  assert.ok(c.includes("不承诺任何录取结果"), "要点5：不承诺录取结果");
});

test("11) 包含官方信息与非承诺声明", () => {
  const bridge = read("app/components/EducationStageBridge.tsx");
  assert.ok(/官方/.test(bridge), "含“官方”信息声明");
  assert.ok(/不承诺/.test(bridge), "含“不承诺”声明");
});

test("12) 中考与成长档案状态隔离", () => {
  for (const p of EXAM_PAGES) {
    const c = read(p);
    assert.ok(!/growth-family-profile|FamilyProfile/i.test(c),
      `${p} 不得导入或使用成长档案类型`);
  }
});

test("13) 新增/修改 TSX 通过语法解析检查（只读）", () => {
  // 仅验证语法可解析：使用本地 typescript 模块 createSourceFile + parseDiagnostics。
  // 不调用外部类型检查命令行工具，不修改任何文件，不改变版本控制状态，不比较历史基线。
  const ts = require("typescript");

  const PARSE_FILES = [
    "app/growth/components/EducationJourney.tsx",
    "app/components/EducationStageBridge.tsx",
    "app/growth/page.tsx",
    "app/filing/page.tsx",
    "app/page.tsx",
  ];

  for (const f of PARSE_FILES) {
    const src = readFileSync(join(ROOT, f), "utf8");
    const sf = ts.createSourceFile(
      f,
      src,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      ts.ScriptKind.TSX,
    );
    const errs = (sf.parseDiagnostics || []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    assert.equal(
      errs.length,
      0,
      `文件 ${f} 应可无语法错误解析；发现 ${errs.length} 个语法错误：` +
        errs
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
          .join("; "),
    );
  }
});
