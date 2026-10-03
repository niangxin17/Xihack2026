// 步骤04/05 针对性测试：导航入口 + /growth 页面（node --test，无构建依赖）
// 仅做文本/AST 级静态校验，不渲染、不依赖 vite build。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = new URL("../app/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

const SITE_NAV = read("components/SiteNav.tsx");
const GROWTH_PAGE = read("growth/page.tsx");
const EJOURNEY = read("growth/components/EducationJourney.tsx");
const EXPLORER = read("growth/components/GrowthExplorer.tsx");
const STAGE_TABS = read("growth/components/StageTabs.tsx");
const SCHOOL_FILTERS = read("growth/components/SchoolFilters.tsx");
const SCHOOL_CARD = read("growth/components/SchoolCard.tsx");
const MODEL = read("lib/growth-schools.ts");

const FRONTEND = [
  SITE_NAV,
  GROWTH_PAGE,
  EXPLORER,
  STAGE_TABS,
  SCHOOL_FILTERS,
  SCHOOL_CARD,
  MODEL,
];

// 步骤05 实际阶段：幼儿园 / 小学 / 初中（交互标签页）+ 中考规划（独立入口）。
const STAGES = ["幼儿园", "小学", "初中", "中考规划"];
// 首版已实现的筛选条件与卡片字段（学校详情 / 4校对比 / 家庭档案在步骤06+ 实现）。
const FEATURE_HINTS = [
  "关键词",
  "所在区",
  "办学性质",
  "可信度",
  "学费",
  "查看详情",
  "演示数据",
];

// 扫描范围仅限成长地图前端文件（page / components / growth-schools.ts），
// 不波及 app/lib 下与中考测算相关的历史模块。
// 下列用语为步骤05明确禁用的宣传表述；真实性闸门脚本已全项目守护同类表述，
// 此处仅对成长地图前端做局部兜底校验，故避免在清单与注释中复写被禁词以免误报。
const BANNED = [
  "保证录取",
  "保录取",
  "包录取",
  "100%录取",
  "内部名额",
  "内部指标",
  "择校运作",
  "成功率",
  "排名",
  "重点学校",
  "口碑最好",
  "名校直录",
];

test("SiteNav 包含「长安成长地图」入口与 /growth 路由", () => {
  assert.match(SITE_NAV, /长安成长地图/);
  assert.match(SITE_NAV, /\/growth/);
});

test("/growth 页面包含标题与阶段名称及中考规划入口", () => {
  assert.ok(GROWTH_PAGE.includes("长安成长地图"), "页面缺少标题：长安成长地图");
  // 中考规划入口已抽离为 EducationJourney 组件，阶段名在该组件或 MODEL 中出现即可。
  const combined = GROWTH_PAGE + MODEL + EJOURNEY;
  for (const s of STAGES) {
    assert.ok(combined.includes(s), `缺少阶段名称：${s}`);
  }
  // 页面应渲染该路线图组件。
  assert.ok(GROWTH_PAGE.includes("EducationJourney"), "页面未渲染 EducationJourney 组件");
});

test("「中考规划」真实链接指向现有中考志愿系统 /filing", () => {
  // 真实入口定义在 EducationJourney 组件中，至少应指向 /filing 与 /。
  assert.ok(EJOURNEY.includes("/filing"), "EducationJourney 未链接到 /filing");
  assert.ok(EJOURNEY.includes('href: "/"'), "EducationJourney 未链接到中考测算首页 /");
});

test("首版功能关键词在页面或组件中可见（学校筛选/详情/对比/档案）", () => {
  const combined = FRONTEND.join("\n");
  for (const f of FEATURE_HINTS) {
    assert.ok(combined.includes(f), `缺少功能关键词：${f}`);
  }
});

test("包含真实性声明（平台不承诺录取结果）", () => {
  assert.match(GROWTH_PAGE, /平台不承诺录取结果/);
});

test("11) /growth 含演示数据声明", () => {
  const combined = GROWTH_PAGE + EXPLORER;
  assert.ok(combined.includes("演示数据"), "缺少“演示数据”声明");
  assert.ok(
    combined.includes("不代表真实学校信息") ||
      combined.includes("不代表任何真实学校"),
    "缺少“不代表真实学校信息”声明",
  );
});

test("13) 前端代码不含排名/保证录取/内部名额/成功率等禁止文案", () => {
  const combined = FRONTEND.join("\n");
  for (const b of BANNED) {
    assert.doesNotMatch(combined, new RegExp(b), `出现禁止宣传用语：${b}`);
  }
});

test("14) 所有前端 TS/TSX 文件可被现有 TypeScript 工具解析", () => {
  const files = [
    ["app/components/SiteNav.tsx", ts.ScriptKind.TSX],
    ["app/growth/page.tsx", ts.ScriptKind.TSX],
    ["app/growth/components/GrowthExplorer.tsx", ts.ScriptKind.TSX],
    ["app/growth/components/StageTabs.tsx", ts.ScriptKind.TSX],
    ["app/growth/components/SchoolFilters.tsx", ts.ScriptKind.TSX],
    ["app/growth/components/SchoolCard.tsx", ts.ScriptKind.TSX],
    ["app/lib/growth-schools.ts", ts.ScriptKind.TS],
  ];
  for (const [rel, kind] of files) {
    const src = read(rel.replace("app/", ""));
    const sf = ts.createSourceFile(
      rel,
      src,
      ts.ScriptTarget.ES2022,
      true,
      kind,
    );
    const diags = sf.parseDiagnostics ?? [];
    assert.equal(
      diags.length,
      0,
      `${rel} TSX 解析诊断：${diags
        .map((d) => String(d.messageText))
        .join("; ")}`,
    );
  }
});
