// 步骤19 · 全量官方库预览/可见性闸门测试
// 运行：node --test --experimental-strip-types tests/growth-preview-gate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getVisibleGrowthSchools,
  isPublishable,
  isSeniorSchool,
  formatAdmissionLine,
} from "../app/lib/growth-schools.ts";
import { VERIFIED_SCHOOLS_PREVIEW } from "../app/lib/growth-verified-schools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 步骤18《18-人工发布审批.md》签核的 12 所预览候选，在步骤19 全量库（3 位 ID）中的同一身份。
const STEP18_PREVIEW_IDS = [
  "P-YT-001", "P-YT-002", "P-YT-003",
  "J-YT-006", "J-YT-005", "J-GX-014",
  "P-BL-015", "P-BL-009", "J-BL-006", "J-BL-009",
  "P-QJ-001", "J-QJ-003",
];

// ===== 1. 全量官方库规模与完整性 =====
test("1) 全量官方库规模合理、全部 A 级可发布、ID 唯一，并含步骤18 12 所已签核候选", () => {
  const n = VERIFIED_SCHOOLS_PREVIEW.length;
  assert.ok(
    n >= 400,
    `全量官方库应至少覆盖 4 区义务教育+中考录取（当前 ${n} 条）`,
  );
  const ids = VERIFIED_SCHOOLS_PREVIEW.map((s) => s.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "全量官方库 ID 必须唯一（无重复接入）",
  );
  for (const s of VERIFIED_SCHOOLS_PREVIEW) {
    assert.equal(s.isDemo, false, `${s.id} 不得为演示数据`);
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
  const idSet = new Set(ids);
  for (const id of STEP18_PREVIEW_IDS) {
    assert.ok(idSet.has(id), `步骤18 签核候选 ${id} 应在全量官方库中`);
  }
});

// ===== 2. 全部非演示、A 级、且通过发布闸门 =====
test("2) 全量库每条均非演示、A 级、四要素齐全且 isPublishable=true", () => {
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
});

// ===== 3. 经生产闸门（demoMode=false）注入后可见 =====
test("3) demoMode=false 时全量官方库经 getVisibleGrowthSchools 可见", () => {
  const visible = getVisibleGrowthSchools({
    demoMode: false,
    verifiedSchools: VERIFIED_SCHOOLS_PREVIEW,
  });
  assert.equal(
    visible.length,
    VERIFIED_SCHOOLS_PREVIEW.length,
    "非演示模式应展示全量已审批数据",
  );
  for (const s of visible) {
    assert.equal(s.isDemo, false, `${s.id} 不得混入演示标识`);
  }
});

// ===== 4. GrowthExplorer 引用官方库模块、预览/演示开关与隔离逻辑 + 准确性声明 =====
test("4) GrowthExplorer 引用 VERIFIED_SCHOOLS_PREVIEW 与预览/演示开关并实现隔离与准确性声明", () => {
  const src = readFileSync(
    join(ROOT, "app/growth/components/GrowthExplorer.tsx"),
    "utf8",
  );
  assert.ok(
    src.includes("NEXT_PUBLIC_GROWTH_PREVIEW"),
    "应引用预览开关环境变量",
  );
  assert.ok(
    src.includes("VERIFIED_SCHOOLS_PREVIEW"),
    "应引用官方库模块",
  );
  assert.ok(
    src.includes("previewMode"),
    "应包含 previewMode 条件分支",
  );
  assert.ok(
    src.includes("当前为预览数据") || src.includes("当前展示西安市多区"),
    "应包含数据准确性声明文案",
  );
  // 预览开关须独立于演示开关，不得被 DEMO 逻辑替代
  assert.ok(
    src.includes("NEXT_PUBLIC_GROWTH_DEMO_MODE"),
    "演示开关引用仍应保留",
  );
});

// ===== 5. 全量库不得包含过渡招生政策字段（保留位，本批未使用） =====
test("5) 全量库均不含 enrollmentPolicyStatus（过渡政策字段保留位）", () => {
  for (const s of VERIFIED_SCHOOLS_PREVIEW) {
    assert.equal(
      s.enrollmentPolicyStatus,
      undefined,
      `${s.id} 不应设置过渡招生政策字段`,
    );
  }
});

// ===== 6. 高中阶段条目已接入且均含真实录取数据（无伪造空数据） =====
test("6) 高中阶段条目已填充，且均含录取层次/录取线/历年线之一（无伪造空数据）", () => {
  const sen = VERIFIED_SCHOOLS_PREVIEW.filter(isSeniorSchool);
  assert.ok(
    sen.length > 100,
    `高中阶段应已接入中考录取库（当前 ${sen.length} 所）`,
  );
  for (const s of sen) {
    // 质量底线：所有高中（含分校）必须仍为官方 A 级——分校不再整体跳过校验。
    assert.equal(
      s.verificationLevel,
      "A",
      `${s.id} 高中（含分校）应为官方公开 A 级`,
    );
    const hasData =
      (s.admissionTier && s.admissionTier.trim().length > 0) ||
      s.admissionScore != null ||
      (s.cutHistory && Object.keys(s.cutHistory).length > 0);
    if (hasData) {
      // 有录取数据者：摘要须非空（杜绝空壳条目）
      assert.ok(
        formatAdmissionLine(s).length > 0,
        `${s.id} 录取摘要须非空`,
      );
      continue;
    }
    // 无录取数据的分校：须为 branchOf 且附 verificationNote 注明来源未含录取线，
    // 透明留痕、绝不编造录取线；非分校高中一律不得留白（维持原闸门强度）。
    assert.ok(
      s.branchOf && s.verificationNote && s.verificationNote.trim().length > 0,
      `${s.id} 无录取数据须为分校(branchOf)且 verificationNote 注明来源未含录取线，不得静默留白`,
    );
  }
});
