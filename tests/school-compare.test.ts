// 步骤07 学校对比 · 纯逻辑测试（先写测试，后实现；本次纠偏后去除持久化并补齐同学段）
// 运行：node --test --experimental-strip-types tests/school-compare.test.ts
// 约束：本文件只测纯函数，不依赖浏览器、不依赖构建、不读写任何存储。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MIN_COMPARE,
  MAX_COMPARE,
  addToCompare,
  removeFromCompare,
  toggleCompare,
  isInCompare,
  isCompareFull,
  canOpenCompare,
  compareLockedStage,
  resolveCompareSchools,
  COMPARE_DIMENSIONS,
  buildCompareRows,
} from "../app/lib/school-compare.ts";
import {
  DEMO_SCHOOLS,
  type GrowthSchool,
} from "../app/lib/growth-schools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 构造测试用学校（字段全空 -> 应显示「暂未核实」）
function mkSchool(
  id: string,
  name: string,
  stage: GrowthSchool["stage"] = "junior",
  over: Partial<GrowthSchool> = {},
): GrowthSchool {
  return {
    id,
    name,
    stage,
    district: "",
    ownership: "unknown",
    address: "",
    tuitionText: "",
    commuteText: "",
    mealText: "",
    foreignTeacherText: "",
    classSizeText: "",
    managementText: "",
    curriculumTags: [],
    featureTags: [],
    enrollmentScope: "",
    registrationMaterials: "",
    sourceName: "",
    sourceUrl: "",
    sourceUpdatedAt: "",
    verificationLevel: "UNVERIFIED",
    verificationLabel: "暂未核实",
    verificationNote: "",
    isDemo: true,
    ...over,
  };
}

test("1) 常量：最少 2 所、最多 4 所", () => {
  assert.equal(MIN_COMPARE, 2);
  assert.equal(MAX_COMPARE, 4);
});

test("2) 加入学校：返回新数组且包含该 ID", () => {
  const r1 = addToCompare([], "S1");
  assert.equal(r1.ok, true);
  assert.equal(r1.reason, "added");
  assert.deepEqual(r1.ids, ["S1"]);

  const r2 = addToCompare(r1.ids, "S2");
  assert.deepEqual(r2.ids, ["S1", "S2"]);
  // 不得修改入参（保持不可变）
  assert.deepEqual(r1.ids, ["S1"]);
});

test("3) 自动去重：重复加入同一 ID 不产生第二条", () => {
  const r1 = addToCompare(["S1", "S2"], "S1");
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "duplicate");
  assert.deepEqual(r1.ids, ["S1", "S2"]);
  assert.equal(new Set(r1.ids).size, r1.ids.length);
});

test("4) 上限 4 所：第 5 所不能加入", () => {
  const four = ["S1", "S2", "S3", "S4"];
  assert.equal(isCompareFull(four), true);
  const r = addToCompare(four, "S5");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "full");
  assert.deepEqual(r.ids, four);
  assert.equal(r.ids.length, MAX_COMPARE);
  assert.ok(!r.ids.includes("S5"), "第 5 所不应被加入");
});

test("5) 移出学校：移出后可再加入新的学校", () => {
  const four = ["S1", "S2", "S3", "S4"];
  const left = removeFromCompare(four, "S2");
  assert.deepEqual(left, ["S1", "S3", "S4"]);
  assert.equal(isCompareFull(left), false);
  const r = addToCompare(left, "S5");
  assert.equal(r.ok, true);
  assert.deepEqual(r.ids, ["S1", "S3", "S4", "S5"]);
  // 移出不存在的 ID 不报错
  assert.deepEqual(removeFromCompare(["S1"], "SX"), ["S1"]);
});

test("6) toggle：已在则移出，不在则加入，满员时加入失败", () => {
  const t1 = toggleCompare(["S1"], "S1");
  assert.deepEqual(t1.ids, []);
  assert.equal(t1.reason, "removed");

  const t2 = toggleCompare(["S1"], "S2");
  assert.deepEqual(t2.ids, ["S1", "S2"]);
  assert.equal(t2.reason, "added");

  const t3 = toggleCompare(["S1", "S2", "S3", "S4"], "S9");
  assert.equal(t3.ok, false);
  assert.equal(t3.reason, "full");

  assert.equal(isInCompare(["S1", "S2"], "S2"), true);
  assert.equal(isInCompare(["S1", "S2"], "S3"), false);
});

test("7) 最少 2 所才能打开对比", () => {
  assert.equal(canOpenCompare([]), false);
  assert.equal(canOpenCompare(["S1"]), false);
  assert.equal(canOpenCompare(["S1", "S2"]), true);
  assert.equal(canOpenCompare(["S1", "S2", "S3"]), true);
  assert.equal(canOpenCompare(["S1", "S2", "S3", "S4"]), true);
});

test("8) 同学段限制：空列表加入即锁定该学段；同学段可加入，不同学段拒绝", () => {
  // 空列表：第一所锁定为 kindergarten
  const a = addToCompare([], "K1", { stage: "kindergarten", lockedStage: null });
  assert.equal(a.ok, true);
  assert.equal(a.reason, "added");

  // 同学段（kindergarten）允许加入
  const b = addToCompare(a.ids, "K2", {
    stage: "kindergarten",
    lockedStage: "kindergarten",
  });
  assert.equal(b.ok, true);
  assert.equal(b.reason, "added");

  // 不同学段（junior）拒绝加入，列表保持不变
  const c = addToCompare(b.ids, "J1", {
    stage: "junior",
    lockedStage: "kindergarten",
  });
  assert.equal(c.ok, false);
  assert.equal(c.reason, "stage_mismatch");
  assert.deepEqual(c.ids, b.ids, "跨学段拒绝后列表不应改变");
  assert.ok(!c.ids.includes("J1"), "跨学段学校不应被加入");
});

test("9) 锁定学段查询：随选择变化；清空后回到 null 可重新锁定", () => {
  const stageById = {
    K1: "kindergarten" as const,
    K2: "kindergarten" as const,
    J1: "junior" as const,
  };
  // 空列表 -> 未锁定
  assert.equal(compareLockedStage([], stageById), null);
  // 加入 kindergarten 后锁定为 kindergarten
  assert.equal(compareLockedStage(["K1"], stageById), "kindergarten");
  assert.equal(compareLockedStage(["K1", "K2"], stageById), "kindergarten");
  // 移除到空 -> 自然解除锁定
  assert.equal(compareLockedStage([], stageById), null);
  // 之后加入 junior 将锁定为 junior（重新选择任意学段）
  const r = addToCompare([], "J1", { stage: "junior", lockedStage: null });
  assert.equal(r.reason, "added");
  assert.equal(compareLockedStage(["J1"], stageById), "junior");
});

test("10) 同学段限制优先于满员判断：不同学段且已满也返回 stage_mismatch", () => {
  const four = ["K1", "K2", "K3", "K4"];
  const r = addToCompare(four, "J9", {
    stage: "junior",
    lockedStage: "kindergarten",
  });
  assert.equal(r.ok, false);
  // 不同阶段信息比满员更贴切，返回 stage_mismatch
  assert.equal(r.reason, "stage_mismatch");
});

test("11) 非法 ID（空串）被拒绝且不改变列表", () => {
  const r = addToCompare(["S1"], "", { stage: "junior", lockedStage: "junior" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid");
  assert.deepEqual(r.ids, ["S1"]);
});

test("12) 对比维度覆盖 12 项且顺序固定", () => {
  const labels = COMPARE_DIMENSIONS.map((d) => d.label);
  assert.deepEqual(labels, [
    "区域",
    "性质",
    "年度费用",
    "通勤参考",
    "课程",
    "外教",
    "班额",
    "餐食",
    "管理",
    "招生信息",
    "更新时间",
    "可信等级",
  ]);
  assert.equal(new Set(COMPARE_DIMENSIONS.map((d) => d.key)).size, 12);
});

test("13) 缺失字段一律显示「暂未核实」", () => {
  const blank = mkSchool("S1", "示例机构一");
  const rows = buildCompareRows([blank]);
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.equal(row.cells.length, 1);
    assert.equal(
      row.cells[0].text,
      "暂未核实",
      `维度「${row.label}」缺失时未显示暂未核实`,
    );
    assert.ok(row.cells[0].text.trim().length > 0, "单元格不得为空白");
  }
});

test("14) 有值字段按原样展示，可信等级显示完整文字", () => {
  const filled = mkSchool("S2", "示例机构二", "primary", {
    district: "雁塔区",
    ownership: "public",
    tuitionText: "每年 7200 元",
    commuteText: "地铁站步行约 10 分钟",
    curriculumTags: ["游戏化主题课程", "综合实践"],
    foreignTeacherText: "无外教",
    classSizeText: "约 25 人/班",
    mealText: "三餐两点",
    managementText: "温和有序",
    enrollmentScope: "以当年公告为准",
    sourceUpdatedAt: "2026-08-04",
    verificationLevel: "A",
  });
  const rows = buildCompareRows([filled]);
  const byLabel = new Map(rows.map((r) => [r.label, r.cells[0].text]));
  assert.equal(byLabel.get("区域"), "雁塔区");
  assert.equal(byLabel.get("性质"), "公办");
  assert.equal(byLabel.get("年度费用"), "每年 7200 元");
  assert.equal(byLabel.get("通勤参考"), "地铁站步行约 10 分钟");
  assert.equal(byLabel.get("课程"), "游戏化主题课程、综合实践");
  assert.equal(byLabel.get("外教"), "无外教");
  assert.equal(byLabel.get("班额"), "约 25 人/班");
  assert.equal(byLabel.get("餐食"), "三餐两点");
  assert.equal(byLabel.get("管理"), "温和有序");
  assert.equal(byLabel.get("招生信息"), "以当年公告为准");
  assert.equal(byLabel.get("更新时间"), "2026-08-04");
  // 可信等级必须可见且为完整文字，不能只显示字母
  assert.equal(byLabel.get("可信等级"), "官方公开");
});

test("15) 2 至 4 所对比：每个维度的单元格数量与所选学校一致", () => {
  const list = [
    mkSchool("S1", "示例机构一", "kindergarten"),
    mkSchool("S2", "示例机构二", "kindergarten"),
    mkSchool("S3", "示例机构三", "kindergarten"),
    mkSchool("S4", "示例机构四", "kindergarten"),
  ];
  for (const n of [2, 3, 4]) {
    const rows = buildCompareRows(list.slice(0, n));
    assert.equal(rows.length, 12);
    for (const row of rows) {
      assert.equal(row.cells.length, n, `选择 ${n} 所时单元格数量不匹配`);
      assert.deepEqual(
        row.cells.map((c) => c.schoolId),
        list.slice(0, n).map((s) => s.id),
      );
    }
  }
});

test("16) resolveCompareSchools 按选择顺序取回学校并忽略未知 ID", () => {
  const all = [
    mkSchool("S1", "一"),
    mkSchool("S2", "二"),
    mkSchool("S3", "三"),
  ];
  assert.deepEqual(
    resolveCompareSchools(all, ["S3", "S1"]).map((s) => s.id),
    ["S3", "S1"],
  );
  assert.deepEqual(
    resolveCompareSchools(all, ["S2", "GHOST"]).map((s) => s.id),
    ["S2"],
  );
  assert.deepEqual(resolveCompareSchools(all, []), []);
});

test("17) 演示数据可直接参与对比且不出现空白单元格", () => {
  const rows = buildCompareRows(DEMO_SCHOOLS.slice(0, 2));
  assert.equal(rows.length, 12);
  for (const row of rows) {
    for (const cell of row.cells) {
      assert.ok(
        typeof cell.text === "string" && cell.text.trim().length > 0,
        `维度「${row.label}」出现空白单元格`,
      );
    }
  }
});

test("18) 源码不含任何浏览器持久化：localStorage / sessionStorage / 存储键", () => {
  const sources = [
    "app/lib/school-compare.ts",
    "app/growth/components/GrowthExplorer.tsx",
    "app/growth/components/SchoolCompareBar.tsx",
    "app/growth/components/SchoolCompareModal.tsx",
    "app/growth/components/SchoolCard.tsx",
  ];
  const forbidden = ["localStorage", "sessionStorage", "changan-growth-compare-ids-v1"];
  for (const rel of sources) {
    const p = join(ROOT, rel);
    assert.ok(existsSync(p), `缺少源文件：${rel}`);
    const content = readFileSync(p, "utf8");
    for (const word of forbidden) {
      assert.ok(
        !content.includes(word),
        `源文件 ${rel} 包含不应出现的持久化标识：${word}`,
      );
    }
  }
});
