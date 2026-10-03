// 步骤18 + 步骤19 · 人工发布审批凭证闸门测试（格式完整性，非审批事实）
// 运行：node --test --experimental-strip-types tests/growth-approval-gate.test.ts
//
// 重要边界：本测试只校验《18-人工发布审批.md》的“格式完整性”。
// 格式通过 ≠ 人类已审批。审批事实以刘玉彬本人编辑并亲自提交该文件为准
// （提交 64c11c3，作者=签核人）。机器无法证明人类动作。
//
// 步骤19 变更：全量官方库由 12 条预览候选扩容为 414 条（4 区 2026 学区划分 PDF +
// 西安市 2026 普通高中招生计划），均为 A 级官方公开。本闸门不再硬断言“恰为 12 条”，
// 改为校验：(a) 全量库完整性（全 A 级、可发布、ID 唯一、非演示）；(b) 步骤18 签核的
// 12 所候选仍以同一身份存在于全量库且为 A 级可发布子集；(c)《18》审批表格式不变。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isPublishable } from "../app/lib/growth-schools.ts";
import { VERIFIED_SCHOOLS_PREVIEW } from "../app/lib/growth-verified-schools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOC = join(
  ROOT,
  "docs/product/changan-growth-map/18-人工发布审批.md",
);

// 《18-人工发布审批.md》签核的 12 所预览候选（其原始 2 位 ID，见该文档表格）。
// 用于纯文档格式校验：表中这 12 行须全部为「通过」。
const STEP18_DOC_IDS = [
  "P-YT-01", "P-YT-02", "P-YT-03",
  "J-YT-02", "J-YT-03",
  "J-GX-02",
  "P-BL-01", "P-BL-02", "J-BL-01", "J-BL-02",
  "P-QJ-01", "J-QJ-01",
];

// 步骤19 全量库（414 条，3 位 ID）中，与步骤18 12 所预览候选同一身份的 ID。
// 校名一致（仅按官方 PDF 归一了「西安市」前缀），用于证明原审批校未被丢弃且仍为 A 级。
const STEP18_PREVIEW_IDS = [
  "P-YT-001", "P-YT-002", "P-YT-003",
  "J-YT-006", "J-YT-005", "J-GX-014",
  "P-BL-015", "P-BL-009", "J-BL-006", "J-BL-009",
  "P-QJ-001", "J-QJ-003",
];

test("0) 审批凭证文件存在", () => {
  assert.ok(
    existsSync(DOC),
    "《18-人工发布审批.md》必须存在于仓库（公开开关翻启前须已签核）",
  );
});

test("1) 全量官方库完整性 + 步骤18 已签核候选仍为 A 级可发布子集", () => {
  // —— 全量官方库完整性 ——
  const ids = VERIFIED_SCHOOLS_PREVIEW.map((s) => s.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "全量官方库 ID 必须唯一（无重复接入）",
  );
  for (const s of VERIFIED_SCHOOLS_PREVIEW) {
    assert.equal(s.isDemo, false, `${s.id} 不应是演示数据`);
    assert.equal(
      s.verificationLevel,
      "A",
      `${s.id} 应为官方公开（A）级`,
    );
    assert.equal(
      isPublishable(s),
      true,
      `${s.id} 应过发布闸门（A 级四要素齐全）`,
    );
  }
  // —— 步骤18 12 所已签核候选仍以同一身份存在且为 A 级可发布 ——
  const byId = new Map(VERIFIED_SCHOOLS_PREVIEW.map((s) => [s.id, s]));
  for (const id of STEP18_PREVIEW_IDS) {
    const s = byId.get(id);
    assert.ok(s, `步骤18 签核候选 ${id} 应仍存在于全量官方库`);
    assert.equal(s!.verificationLevel, "A", `${id} 应为 A 级`);
    assert.equal(isPublishable(s!), true, `${id} 应过发布闸门`);
  }
});

test("2) 步骤18 审批表 12 行全部为「通过」，且无一「不通过」", () => {
  const content = readFileSync(DOC, "utf8");
  const lines = content.split(/\r?\n/);

  // 无遗留的“不通过”占位（确保没有候选被驳回）。
  assert.ok(
    !content.includes("☐ 不通过"),
    "审批表不应残留任何「不通过」占位",
  );

  // 每张表行（以 | 开头且含 ☑ 通过）应为 12 行。
  const approvedRows = lines.filter(
    (l) => l.trimStart().startsWith("|") && l.includes("☑ 通过"),
  );
  assert.equal(
    approvedRows.length,
    12,
    "审批表应包含恰好 12 行「通过」结论",
  );

  // 每个审批候选 ID 在表中均标记为「通过」。
  for (const id of STEP18_DOC_IDS) {
    const row = lines.find((l) => l.includes(id));
    assert.ok(row, `审批表应包含学校 ID ${id}`);
    assert.ok(
      row!.includes("☑ 通过"),
      `学校 ID ${id} 的审批结论应为「通过」`,
    );
  }
});

test("3) 签核人 / 签核日期已填写且签核人为刘玉彬", () => {
  const content = readFileSync(DOC, "utf8");
  assert.ok(
    /签核人\*\*：\s*\S+/.test(content),
    "「签核人」字段应已填写（非空）",
  );
  assert.ok(content.includes("刘玉彬"), "签核人应为刘玉彬");
  assert.ok(
    /签核日期\*\*：\s*\d{4}-\d{2}-\d{2}/.test(content),
    "「签核日期」字段应已填写（非空，YYYY-MM-DD）",
  );
  assert.ok(content.includes("2026-08-12"), "签核日期应为 2026-08-12");
});

test("4) 授权句包含预览开关且明确「不等于正式公开发布」", () => {
  const content = readFileSync(DOC, "utf8");
  assert.ok(
    content.includes("NEXT_PUBLIC_GROWTH_PREVIEW=1"),
    "授权句应包含预览开关 NEXT_PUBLIC_GROWTH_PREVIEW=1",
  );
  assert.ok(
    content.includes("不等于正式公开发布"),
    "授权句应明确「不等于正式公开发布」",
  );
});

// 该闸门的可执行语义（已拍板）：不比较提交时间先后，只断言
// “公开开关翻启前，本凭证须已签核”。本测试即该不变式的格式侧实现。
// 时间先后（凭证早于 feb05ec）不可执行，已按用户决定放弃。
// 步骤19 扩容后，不变式延伸为：全量库须整体 A 级可发布，且原签核候选仍为其子集（见 test 1）。
