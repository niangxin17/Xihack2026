// 步骤09 · 家庭成长档案 UI 静态校验（node --test，无构建依赖）
// 仅做文本/AST 级静态校验：隐私保护、无障碍、声明文案、应用筛选边界、源码无浏览器存储/无 API 提交。
// 不渲染、不依赖 vite build。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { transpileModule } from "typescript";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = new URL("../app/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

const MODEL = read("lib/growth-family-profile.ts");
const PANEL = read("growth/components/FamilyProfilePanel.tsx");
const SUMMARY = read("growth/components/FamilyProfileSummary.tsx");
const EXPLORER = read("growth/components/GrowthExplorer.tsx");

// 步骤09 相关源码（用于「无浏览器存储 / 无 API 提交」范围检查）。
const STEP09_SOURCES = [MODEL, PANEL, SUMMARY, EXPLORER];

// 帮助：用 TS 编译器做一次语法/解析检查（剥离类型，不解析 import）。
function expectParses(name, code) {
  const out = transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errs.length,
    0,
    `${name} 解析错误：${errs.map((d) => d.messageText).join("; ")}`,
  );
}

test("14) 新增 TS/TSX 通过解析检查", () => {
  expectParses("growth-family-profile.ts", MODEL);
  expectParses("FamilyProfilePanel.tsx", PANEL);
  expectParses("FamilyProfileSummary.tsx", SUMMARY);
});

test("15) 源码不含浏览器存储调用", () => {
  const patterns = [
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /document\s*\.\s*cookie/,
    /navigator\s*\.\s*sendBeacon/,
    /\bCookies\s*\./,
  ];
  for (const src of STEP09_SOURCES) {
    for (const re of patterns) {
      assert.ok(
        !re.test(src),
        `步骤09 源码不应包含浏览器存储调用：${re}`,
      );
    }
  }
});

test("16) 源码不含 API 提交", () => {
  const patterns = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /navigator\s*\.\s*sendBeacon/,
    /\/api\//,
    /\bserverAction\b/,
  ];
  for (const src of STEP09_SOURCES) {
    for (const re of patterns) {
      assert.ok(!re.test(src), `步骤09 源码不应包含 API 提交：${re}`);
    }
  }
});

test("17) 表单包含监护人确认", () => {
  assert.ok(
    PANEL.includes(
      "我是孩子的监护人或已获得监护人授权，并理解本功能不构成教育、心理或录取结论。",
    ),
    "面板应含监护人确认文案",
  );
  assert.ok(
    /id=["']fp-guardian["']/.test(PANEL),
    "监护人勾选框应有显式 id 并与 label 关联",
  );
});

test("18) 包含隐私声明", () => {
  assert.ok(
    PANEL.includes(
      "家庭档案仅在当前页面会话中使用，刷新或关闭页面后不会保留。请勿填写姓名、证件号码、联系方式等个人信息。",
    ),
    "面板应含会话内使用与隐私声明",
  );
});

test("19) 包含非诊断、非录取结论声明", () => {
  assert.ok(
    PANEL.includes("不构成教育诊断、心理评估或录取结论"),
    "面板应含非诊断/非录取结论声明",
  );
  assert.ok(
    PANEL.includes("不预测录取概率，不生成学校排名"),
    "面板应声明不预测录取概率、不生成排名",
  );
});

test("20) 入口、清空、应用按钮与无障碍结构", () => {
  assert.ok(
    EXPLORER.includes("建立家庭成长档案"),
    "GrowthExplorer 应提供建立档案入口",
  );
  assert.ok(PANEL.includes("清空档案"), "面板应提供清空档案按钮");
  assert.ok(PANEL.includes("生成规划重点"), "面板应提供生成规划重点按钮");
  assert.ok(SUMMARY.includes("应用建议筛选"), "摘要应提供应用建议筛选按钮");
  // 无障碍：多选组使用 fieldset/legend，错误用 role=alert，摘要用 aria-live。
  assert.ok(/<fieldset/.test(PANEL), "多选组应使用 fieldset");
  assert.ok(/<legend/.test(PANEL), "多选组应使用 legend");
  assert.ok(/role=["']alert["']/.test(PANEL), "错误提示应使用 role=alert");
  assert.ok(/aria-live=["']polite["']/.test(SUMMARY), "摘要更新应使用 aria-live=polite");
});

test("21) 不显示诊断/测评类词汇与强烈推荐", () => {
  const forbidden = [
    "AI诊断",
    "性格测评",
    "智商评估",
    "智力评估",
    "心理测评",
    "最适合",
    "保证结果",
  ];
  for (const w of forbidden) {
    assert.ok(
      !PANEL.includes(w) && !SUMMARY.includes(w),
      `不应出现词汇：${w}`,
    );
  }
});

test("22) 应用建议筛选仅更新 stage/district/ownership，不选项/不对比", () => {
  // 在 GrowthExplorer 中定位 handleApplySuggestedFilters，确认只 setFilter 这三个字段。
  const fn = EXPLORER.match(
    /handleApplySuggestedFilters = useCallback\(\s*\(f: SuggestedFilters\) => \{([\s\S]*?)\n    \},/,
  );
  assert.ok(fn, "应能定位 handleApplySuggestedFilters 实现");
  const body = fn[1];
  // 必须出现对 stage/district/ownership 的更新。
  assert.ok(/stage:\s*f\.stage/.test(body), "应更新 stage");
  assert.ok(/district:\s*f\.district/.test(body), "应更新 district");
  assert.ok(/ownership:\s*f\.ownership/.test(body), "应更新 ownership");
  // 不得出现自动选项 / 加入对比 / 打开详情。
  assert.ok(
    !/setCompareIds/.test(body),
    "应用筛选不得自动加入对比（setCompareIds）",
  );
  assert.ok(
    !/setSelectedSchool/.test(body),
    "应用筛选不得自动选择学校（setSelectedSchool）",
  );
  assert.ok(
    !/setDetailRequested/.test(body),
    "应用筛选不得自动打开详情（setDetailRequested）",
  );
  // 应用后提示文案（在摘要组件中渲染，由 GrowthExplorer 经属性传入）。
  assert.ok(
    SUMMARY.includes(
      "已根据家庭档案更新基础筛选条件，结果仍需结合官方政策和实地了解判断。",
    ),
    "应用后应显示提示文案（在摘要中）",
  );
});

test("23) 模型可见受控状态由面板与 GrowthExplorer 共用（受控态存在）", () => {
  assert.ok(/familyProfile/.test(EXPLORER), "GrowthExplorer 应持有 familyProfile 受控状态");
  assert.ok(
    /onChange=\{setFamilyProfile\}/.test(EXPLORER) ||
      /onChange=\{setFamilyProfile\}/.test(PANEL) ||
      /onChange=\{setFamilyProfile\}/.test(EXPLORER + PANEL),
    "面板应将变更回写到 GrowthExplorer 的受控状态",
  );
});
