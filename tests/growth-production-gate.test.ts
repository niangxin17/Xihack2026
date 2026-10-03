// 步骤12收尾纠偏 · 生产展示闸门测试
// 运行：node --test --experimental-strip-types tests/growth-production-gate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEMO_SCHOOLS,
  getVisibleGrowthSchools,
  isPublishable,
  type GrowthSchool,
} from "../app/lib/growth-schools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function mkRealSchool(over: Partial<GrowthSchool> = {}): GrowthSchool {
  return {
    id: "REAL-001",
    name: "真实学校测试",
    stage: "junior",
    district: "雁塔区",
    ownership: "public",
    address: "测试地址",
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
    sourceName: "教育局公示",
    sourceUrl: "https://example.com/gov",
    sourceUpdatedAt: "2026-07-01",
    verificationLevel: "A",
    verificationLabel: "官方公开",
    verificationNote: "经官方公示核验",
    isDemo: false,
    ...over,
  };
}

// ===== 1. 默认不显示演示机构 =====
test("1) 默认模式（demoMode=false, verifiedSchools=[]）不返回任何学校", () => {
  const visible = getVisibleGrowthSchools({
    demoMode: false,
    verifiedSchools: [],
  });
  assert.equal(visible.length, 0, "默认模式下不应展示任何学校（含演示数据）");
});

// ===== 2. 环境变量缺失 → 不显示演示机构 =====
test("2) demoMode=false 时即使有 verifiedSchools 也不混入演示数据", () => {
  // 模拟：verifiedSchools 有真实数据，但 demoMode=false → 仅返回通过闸门的真实数据
  const verified = [mkRealSchool({ id: "R1", name: "学校A" })];
  const visible = getVisibleGrowthSchools({
    demoMode: false,
    verifiedSchools: verified,
  });
  assert.equal(visible.length, 1, "应返回通过闸门的真实数据");
  assert.equal(visible[0].id, "R1");
  // 不得混入演示数据
  for (const s of visible) {
    assert.equal(s.isDemo, false, `学校 ${s.id} 不应是演示数据`);
  }
});

// ===== 3. demoMode=true 才显示演示机构 =====
test("3) demoMode=true 返回 DEMO_SCHOOLS 并保持演示标识", () => {
  const visible = getVisibleGrowthSchools({
    demoMode: true,
    verifiedSchools: [],
  });
  assert.equal(visible.length, DEMO_SCHOOLS.length);
  for (const s of visible) {
    assert.equal(s.isDemo, true, `演示模式下 ${s.id} 应为演示数据`);
    assert.equal(s.verificationLevel, "UNVERIFIED");
  }
});

// ===== 4. 演示模式声明存在 =====
test("4) GrowthExplorer 源码包含演示模式条件声明", () => {
  const src = readFileSync(
    join(ROOT, "app/growth/components/GrowthExplorer.tsx"),
    "utf8",
  );
  assert.ok(
    src.includes("当前为功能演示数据"),
    "应包含演示数据声明文案",
  );
  assert.ok(
    src.includes("demoMode"),
    "应包含 demoMode 条件分支",
  );
  assert.ok(
    src.includes("NEXT_PUBLIC_GROWTH_DEMO_MODE"),
    "应引用 NEXT_PUBLIC_GROWTH_DEMO_MODE 环境变量",
  );
});

// ===== 5. 生产空状态存在 =====
test("5) 生产空状态文案存在", () => {
  const src = readFileSync(
    join(ROOT, "app/growth/components/GrowthExplorer.tsx"),
    "utf8",
  );
  assert.ok(
    src.includes("学校资料正在核验中，暂未开放公开查询。"),
    "生产模式下无数据时应显示核验中空状态",
  );
});

// ===== 6. isDemo=true 不可进入正式结果 =====
test("6) isDemo=true 被 isPublishable 拒绝", () => {
  const demo = DEMO_SCHOOLS[0];
  assert.equal(isPublishable(demo), false, "isDemo=true 不得发布");
  // 即使其他字段满足 A 级要求也不得发布
  const disguised = { ...demo, isDemo: true, verificationLevel: "A" as const };
  assert.equal(isPublishable(disguised), false, "即使等级为 A，isDemo=true 也不得发布");
});

// ===== 7. UNVERIFIED 不可进入正式结果 =====
test("7) UNVERIFIED 被 isPublishable 拒绝", () => {
  const unverified = mkRealSchool({ verificationLevel: "UNVERIFIED" });
  assert.equal(isPublishable(unverified), false, "UNVERIFIED 不得发布");
});

// ===== 8. A/B/C/D 只有满足 publishable 条件才可进入 =====
test("8) 等级 A 须具备四要素（sourceName/sourceUrl/updatedAt/note）", () => {
  const good = mkRealSchool({ verificationLevel: "A" });
  assert.equal(isPublishable(good), true, "A 级四要素齐全应可发布");

  const noSourceName = mkRealSchool({ verificationLevel: "A", sourceName: "" });
  assert.equal(isPublishable(noSourceName), false, "A 级缺 sourceName 不可发布");

  const noSourceUrl = mkRealSchool({ verificationLevel: "A", sourceUrl: "" });
  assert.equal(isPublishable(noSourceUrl), false, "A 级缺 sourceUrl 不可发布");

  const noUpdatedAt = mkRealSchool({ verificationLevel: "A", sourceUpdatedAt: "" });
  assert.equal(isPublishable(noUpdatedAt), false, "A 级缺 updatedAt 不可发布");

  const noNote = mkRealSchool({ verificationLevel: "A", verificationNote: "" });
  assert.equal(isPublishable(noNote), false, "A 级缺 note 不可发布");
});

test("8b) 等级 B/C 须具备 sourceName + updatedAt + note", () => {
  const good = mkRealSchool({ verificationLevel: "B" });
  assert.equal(isPublishable(good), true, "B 级三要素齐全应可发布");

  const noSourceName = mkRealSchool({ verificationLevel: "B", sourceName: "" });
  assert.equal(isPublishable(noSourceName), false, "B 级缺 sourceName 不可发布");

  const noUpdatedAt = mkRealSchool({ verificationLevel: "C", sourceUpdatedAt: "" });
  assert.equal(isPublishable(noUpdatedAt), false, "C 级缺 updatedAt 不可发布");
});

test("8c) 等级 D 仅需 note 非空", () => {
  const good = mkRealSchool({ verificationLevel: "D", sourceName: "", sourceUrl: "", sourceUpdatedAt: "" });
  assert.equal(isPublishable(good), true, "D 级仅需 note 即可发布");

  const noNote = mkRealSchool({ verificationLevel: "D", verificationNote: "" });
  assert.equal(isPublishable(noNote), false, "D 级缺 note 不可发布");
});

// ===== 9. valid 不等于 publishable =====
test("9) valid（字段格式正确）不等于 publishable（可进入正式公开数据）", () => {
  // 模拟一个字段格式完全正确但 UNVERIFIED 的记录
  const validUnverified = mkRealSchool({
    id: "VALID-UNVERIFIED",
    name: "格式正确的未核实学校",
    verificationLevel: "UNVERIFIED",
    sourceName: "来源名称",
    sourceUrl: "https://example.com",
    sourceUpdatedAt: "2026-08-01",
    verificationNote: "待核验",
  });
  // 字段格式正确（name 非空等），但发布闸门拒绝
  assert.equal(isPublishable(validUnverified), false, "UNVERIFIED 的记录即使字段完整也不可发布");
  // 改为 A 级后应可发布
  const publishable = { ...validUnverified, verificationLevel: "A" as const };
  assert.equal(isPublishable(publishable), true, "同数据改为 A 级应可发布");
});

// ===== 9b. 空名称不可发布（即使 A 级） =====
test("9b) 空名称不可发布", () => {
  const noName = mkRealSchool({ name: "", verificationLevel: "A" });
  assert.equal(isPublishable(noName), false, "名称为空不可发布");
});

// ===== 10. 页面未自动读取或导入 CSV =====
test("10) growth 页面与 GrowthExplorer 不导入 CSV 或 growth-school-import", () => {
  const files = [
    "app/growth/page.tsx",
    "app/growth/components/GrowthExplorer.tsx",
  ];
  const forbidden = [
    "growth-school-import",
    "importSchoolsCsv",
    ".csv",
    "readFileSync",
    "readFile(",
  ];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const word of forbidden) {
      const lines = src.split("\n");
      let inBlockComment = false;
      for (const line of lines) {
        const trimmed = line.trim();
        // JSX 块注释 {/* ... */}
        if (trimmed.startsWith("{/*")) inBlockComment = true;
        if (inBlockComment) {
          if (trimmed.includes("*/}")) inBlockComment = false;
          continue;
        }
        // 单行注释
        if (trimmed.startsWith("//")) continue;
        assert.ok(
          !trimmed.includes(word),
          `${rel} 不应在代码中引用 ${word}`,
        );
      }
    }
  }
});

// ===== 11. DEMO_SCHOOLS 仍可被测试引用（但测试不会将演示数据用于生产断言） =====
test("11) 演示数据从 DEMO_SCHOOLS 导出且与生产闸门解耦", () => {
  assert.ok(DEMO_SCHOOLS.length >= 3, "应有至少 3 条演示数据供本地开发");
  // 确认与 getVisibleGrowthSchools 解耦：DEMO_SCHOOLS 自身不应被页面默认消费
  const gateResult = getVisibleGrowthSchools({ demoMode: false, verifiedSchools: [] });
  assert.equal(gateResult.length, 0, "非演示模式不应消费 DEMO_SCHOOLS");
});
