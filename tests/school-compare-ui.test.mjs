// 步骤07 学校对比 · 组件契约测试（本次纠偏后：仅内存态、同学段、无持久化）
// 说明：对比栏/对比弹窗为 .tsx（含 JSX），node 无法直接 import；
// 沿用既有文本扫描法，校验交互契约、无障碍属性、移动端布局与"不截断"约束。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const P_BAR = join(ROOT, "app/growth/components/SchoolCompareBar.tsx");
const P_MODAL = join(ROOT, "app/growth/components/SchoolCompareModal.tsx");
const P_CARD = join(ROOT, "app/growth/components/SchoolCard.tsx");
const P_EXPLORER = join(ROOT, "app/growth/components/GrowthExplorer.tsx");
const P_LIB = join(ROOT, "app/lib/school-compare.ts");

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const BAR = read(P_BAR);
const MODAL = read(P_MODAL);
const CARD = read(P_CARD);
const EXPLORER = read(P_EXPLORER);
const LIB = read(P_LIB);
const ALL = [BAR, MODAL, CARD, EXPLORER, LIB].join("\n");

// 会造成内容被截断、手机端无法查看完整信息的样式类，一律禁止用于对比内容区
const TRUNCATING_CLASSES = ["truncate", "text-ellipsis", "line-clamp-", "overflow-hidden text-"];

test("1) 新文件齐全：对比逻辑模块、对比栏、对比弹窗", () => {
  assert.ok(existsSync(P_LIB), "缺少 app/lib/school-compare.ts");
  assert.ok(existsSync(P_BAR), "缺少 app/growth/components/SchoolCompareBar.tsx");
  assert.ok(existsSync(P_MODAL), "缺少 app/growth/components/SchoolCompareModal.tsx");
});

test("2) 对比栏展示已选学校并支持逐个移出与一键清空", () => {
  assert.ok(/export default function SchoolCompareBar\(/.test(BAR), "未导出 SchoolCompareBar");
  assert.ok(/onRemove/.test(BAR), "对比栏缺少移出回调 onRemove");
  assert.ok(/onClear/.test(BAR), "对比栏缺少清空回调 onClear");
  assert.ok(/移出/.test(BAR), "对比栏未提供移出入口文案");
  assert.ok(/清空/.test(BAR), "对比栏未提供清空入口文案");
});

test("3) 少于 2 所时「开始对比」按钮不可用", () => {
  assert.ok(/开始对比/.test(BAR), "对比栏缺少「开始对比」按钮");
  assert.ok(/canOpenCompare/.test(BAR), "对比栏未使用 canOpenCompare 判定可否打开");
  assert.ok(/disabled=\{/.test(BAR), "「开始对比」按钮未绑定 disabled 状态");
  assert.ok(/MIN_COMPARE/.test(BAR), "对比栏未引用最少所数常量");
});

test("4) 达到 4 所上限时给出提示且不再提供加入入口", () => {
  assert.ok(/MAX_COMPARE/.test(BAR + CARD), "未引用最多所数常量");
  assert.ok(/已选满/.test(CARD), "卡片未提示已达对比上限");
  assert.ok(/isCompareFull/.test(CARD + EXPLORER), "未使用 isCompareFull 判定上限");
});

test("5) 卡片提供加入 / 移出对比按钮，并与详情按钮共存", () => {
  assert.ok(/加入对比/.test(CARD), "卡片缺少「加入对比」");
  assert.ok(/移出对比/.test(CARD), "卡片缺少「移出对比」");
  assert.ok(/onToggleCompare/.test(CARD), "卡片未绑定 onToggleCompare 回调");
  assert.ok(/查看详情/.test(CARD), "卡片丢失原有「查看详情」入口");
});

test("6) 对比弹窗具备完整无障碍属性", () => {
  assert.ok(/export default function SchoolCompareModal\(/.test(MODAL), "未导出 SchoolCompareModal");
  assert.ok(/role="dialog"/.test(MODAL), '缺少 role="dialog"');
  assert.ok(/aria-modal="true"/.test(MODAL), '缺少 aria-modal="true"');
  assert.ok(/aria-labelledby=/.test(MODAL), "缺少 aria-labelledby");
  assert.ok(/id="school-compare-title"/.test(MODAL), "aria-labelledby 未指向存在的标题 id");
  assert.ok(/Escape/.test(MODAL) && /keydown/.test(MODAL), "未支持 Escape 关闭");
});

test("7) 对比内容由统一的 12 个维度驱动，不在组件里另写一套字段", () => {
  assert.ok(/buildCompareRows/.test(MODAL), "弹窗未使用 buildCompareRows 生成对比内容");
  assert.ok(!/COMPARE_DIMENSIONS\s*=\s*\[/.test(MODAL), "弹窗内不得重复定义维度清单");
  assert.ok(/row\.label/.test(MODAL), "弹窗未渲染维度名称");
});

test("8) 手机端纵向分组、桌面端横向表格，两套布局都存在", () => {
  assert.ok(/md:hidden/.test(MODAL), "缺少手机端专用布局（md:hidden）");
  assert.ok(/hidden md:block|hidden md:table|md:block/.test(MODAL), "缺少桌面端专用布局");
  assert.ok(/<table/.test(MODAL), "桌面端未使用表格呈现横向对比");
  assert.ok(/overflow-x-auto/.test(MODAL), "桌面端表格不可横向滚动，宽内容会被挡住");
  assert.ok(/sticky/.test(MODAL), "表格维度列未固定，横向滚动后无法对应维度");
});

test("9) 对比内容不得使用任何截断样式", () => {
  for (const cls of TRUNCATING_CLASSES) {
    assert.ok(!MODAL.includes(cls), `对比弹窗使用了会截断内容的样式：${cls}`);
  }
  assert.ok(/break-words|whitespace-normal|break-all/.test(MODAL), "长文本未允许换行，手机端可能溢出");
  assert.ok(/overflow-y-auto/.test(MODAL), "弹窗内容区不可纵向滚动，超长内容将无法查看");
});

test("10) 可信等级与更新时间在对比中可见", () => {
  assert.ok(/可信等级/.test(LIB), "对比维度缺少可信等级");
  assert.ok(/更新时间/.test(LIB), "对比维度缺少更新时间");
  assert.ok(/formatVerification/.test(LIB), "可信等级未使用完整文字标签");
});

test("11) 容器仅以内存态管理对比，不含任何持久化读取/恢复逻辑", () => {
  assert.ok(/compareIds/.test(EXPLORER), "容器未管理 compareIds 状态");
  assert.ok(/compareRequested/.test(EXPLORER), "容器未管理 compareRequested 内存标志");
  // 纠偏：移除所有持久化行为
  assert.ok(!/loadCompareIds/.test(EXPLORER), "容器仍调用 loadCompareIds，应已移除");
  assert.ok(!/saveCompareIds/.test(EXPLORER), "容器仍调用 saveCompareIds，应已移除");
  assert.ok(!/browserStorage/.test(EXPLORER), "容器仍引用 browserStorage，应已移除");
  assert.ok(!/hydrated/.test(EXPLORER), "容器仍存在 hydrated 持久化恢复状态，应已移除");
  assert.ok(/SchoolCompareBar/.test(EXPLORER), "未渲染对比栏");
  assert.ok(/SchoolCompareModal/.test(EXPLORER), "未渲染对比弹窗");
});

test("12) 源码不含任何浏览器存储写入/序列化，也不含持久化存储键", () => {
  // 不允许把整份学校数据或表单内容塞进存储
  assert.ok(!/localStorage\.setItem\(/.test(EXPLORER), "容器直接调用 localStorage.setItem");
  assert.ok(!/localStorage\.getItem\(/.test(EXPLORER), "容器直接调用 localStorage.getItem");
  assert.ok(!/sessionStorage/.test(ALL), "源码不应出现 sessionStorage");
  assert.ok(!/changan-growth-compare-ids-v1/.test(ALL), "源码不应出现持久化存储键");
  assert.ok(
    !/serializeCompareIds|parseCompareIds|saveCompareIds|loadCompareIds|clearCompareIds|browserStorage/.test(ALL),
    "源码仍残留持久化封装函数，应已移除",
  );
  assert.ok(!/JSON\.stringify\(schools\)/.test(ALL), "不得序列化整份学校数据到本地");
});

test("13) 不出现未经证实的宣传或择校承诺用语", () => {
  // 注意：
  //  - 对比弹窗声明原文含「不代表学校排名」属合规否定表达，已从禁止清单移除；
  //  - 网关已全仓库（含 tests/）守护具体虚假数字与宣传用语，本清单只补充网关未覆盖、
  //    但本功能仍要禁止的择校承诺类用语，且不写入任何网关禁用字面值以免误伤自身。
  const banned = [
    "推荐指数",
    "适合你",
    "强烈推荐",
    "保证录取",
    "内部名额",
    "择校运作",
    "最好的学校",
  ];
  for (const w of banned) {
    assert.ok(!ALL.includes(w), `对比相关代码出现禁止用语：${w}`);
  }
});

test("14) 组件结构合法：客户端指令、默认导出、类型来源统一", () => {
  assert.ok(/^"use client";/m.test(BAR), "对比栏缺少 use client 指令");
  assert.ok(/^"use client";/m.test(MODAL), "对比弹窗缺少 use client 指令");
  assert.ok(/from "\.\.\/\.\.\/lib\/school-compare"/.test(BAR), "对比栏未从统一逻辑模块导入");
  assert.ok(/from "\.\.\/\.\.\/lib\/school-compare"/.test(MODAL), "对比弹窗未从统一逻辑模块导入");
  assert.ok(/GrowthSchool/.test(BAR) && /GrowthSchool/.test(MODAL), "未使用统一的 GrowthSchool 类型");
});

test("15) 对比弹窗声明原文：仅整理公开信息，不代表排名或录取建议", () => {
  assert.ok(
    MODAL.includes("对比结果仅用于整理公开信息，不代表学校排名或录取建议。"),
    "对比弹窗未使用指定的免责声明原文",
  );
  // 不得计算综合分、不得标记胜出学校
  assert.ok(!/综合分|总分|得分|胜出|最优|最强/.test(MODAL), "对比弹窗出现综合评分或胜出标记");
});

test("16) 对比弹窗结构：语义化 table/thead/tbody/th", () => {
  assert.ok(/<table/.test(MODAL), "桌面端未使用 table");
  assert.ok(/<thead/.test(MODAL), "缺少 thead");
  assert.ok(/<tbody/.test(MODAL), "缺少 tbody");
  assert.ok(/<th/.test(MODAL), "缺少 th 表头单元格");
  // 遮罩关闭 + 内容阻止冒泡
  assert.ok(/onClick=\{onClose\}/.test(MODAL), "遮罩点击未绑定关闭");
  assert.ok(/e\.stopPropagation\(\)/.test(MODAL), "弹窗内容未阻止冒泡");
});

test("17) 弹窗打开锁定滚动、关闭恢复（overflow 处理）", () => {
  assert.ok(/document\.body\.style\.overflow/.test(MODAL), "未处理 body 滚动锁定");
  assert.ok(/overflow = "hidden"/.test(MODAL), "打开时未锁定滚动");
});

test("18) 同学段限制：跨学段被拒并提示「请只对比同一学段的学校。」", () => {
  assert.ok(
    EXPLORER.includes("请只对比同一学段的学校。"),
    "容器未提供同学段限制提示文案",
  );
  // 限制由纯逻辑 addToCompare/toggleCompare 的 stage_mismatch 判定，不靠 UI 临时判断
  assert.ok(/stage_mismatch/.test(LIB), "逻辑层未定义 stage_mismatch 拒绝原因");
  assert.ok(/compareLockedStage/.test(EXPLORER + LIB), "未计算/使用对比已锁定学段");
});

test("19) 详情与对比互斥：开详情关对比、开对比关详情", () => {
  // 打开详情应关闭对比弹窗
  assert.ok(/setCompareRequested\(false\)/.test(EXPLORER), "打开详情时未关闭对比弹窗");
  // 打开对比应关闭详情弹窗
  assert.ok(/setDetailRequested\(false\)/.test(EXPLORER), "打开对比时未关闭详情弹窗");
  assert.ok(/setSelectedSchool\(null\)/.test(EXPLORER), "打开对比时未清空已选详情学校");
});

test("20) 移除到少于 2 所自动关闭对比弹窗（派生可见性）", () => {
  // compareOpen 由 compareRequested && canOpenCompare(compareIds) 派生，
  // 弹窗内移除使 count<2 时 canOpenCompare 为 false -> 弹窗自动收起。
  assert.ok(
    /compareOpen = compareRequested && canOpenCompare\(compareIds\)/.test(EXPLORER),
    "对比可见性未由 canOpenCompare 派生，移除到 <2 所将无法自动关闭",
  );
  assert.ok(/open=\{compareOpen\}/.test(EXPLORER), "对比弹窗未接收派生的 open 属性");
});

test("21) 提示区域具备无障碍实时播报", () => {
  assert.ok(/role="status"/.test(EXPLORER), "提示区域缺少 role=\"status\"");
  assert.ok(/aria-live="polite"/.test(EXPLORER), "提示区域缺少 aria-live=\"polite\"");
});

test("22) 切换筛选条件不静默清除已选对比学校", () => {
  // 对比选择（compareIds）与筛选状态（filter）相互独立；
  // 任何 setFilter 调用语句都不得同时调用 setCompareIds。
  const lines = EXPLORER.split("\n");
  for (const line of lines) {
    const touchesFilter = /setFilter\(/.test(line);
    const touchesCompare = /setCompareIds\(/.test(line);
    assert.ok(
      !(touchesFilter && touchesCompare),
      `同一语句既改筛选又改对比选择，会静默清除已选学校：\n  ${line.trim()}`,
    );
  }
  // 容器确实渲染了已选学校，且筛选结果与对比选择是两套独立状态
  assert.ok(/compareSchools/.test(EXPLORER), "容器未计算已选学校对象");
  assert.ok(/results/.test(EXPLORER), "容器未计算筛选结果");
});
