import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SCHOOLS,
  VERIFICATION_LABELS,
  VERIFICATION_LEVELS,
  STAGE_LABELS,
  OWNERSHIP_LABELS,
  formatEmpty,
  formatVerification,
  formatSource,
  filterSchools,
  emptyFilter,
  distinctDistricts,
  type GrowthSchool,
  type VerificationLevel,
  type GrowthStage,
  type SchoolOwnership,
} from "../app/lib/growth-schools.ts";

const forbiddenSchoolHints = ["一中", "附中", "实验小学", "重点", "名校"];

test("1) verificationLevel 仅允许 A/B/C/D/UNVERIFIED", () => {
  assert.deepEqual(VERIFICATION_LEVELS, [
    "A",
    "B",
    "C",
    "D",
    "UNVERIFIED",
  ]);
  const allowed = new Set<VerificationLevel>([
    "A",
    "B",
    "C",
    "D",
    "UNVERIFIED",
  ]);
  for (const s of DEMO_SCHOOLS) {
    assert.ok(
      allowed.has(s.verificationLevel),
      `学校 ${s.id} 的可信度非法: ${s.verificationLevel}`,
    );
  }
});

test("2) 五种可信度文字映射正确", () => {
  assert.equal(VERIFICATION_LABELS.A, "官方公开");
  assert.equal(VERIFICATION_LABELS.B, "学校确认");
  assert.equal(VERIFICATION_LABELS.C, "平台核验");
  assert.equal(VERIFICATION_LABELS.D, "家长反馈");
  assert.equal(VERIFICATION_LABELS.UNVERIFIED, "暂未核实");
  // 不仅显示字母
  for (const v of VERIFICATION_LEVELS) {
    assert.notEqual(formatVerification(v), v, `等级 ${v} 不得仅显示字母`);
  }
});

test("3) 所有演示数据 isDemo=true", () => {
  assert.ok(DEMO_SCHOOLS.length > 0);
  for (const s of DEMO_SCHOOLS) {
    assert.equal(s.isDemo, true, `学校 ${s.id} 必须为演示数据`);
  }
});

test("4) 所有演示数据 verificationLevel=UNVERIFIED", () => {
  for (const s of DEMO_SCHOOLS) {
    assert.equal(
      s.verificationLevel,
      "UNVERIFIED",
      `学校 ${s.id} 必须为 UNVERIFIED`,
    );
  }
});

test("5) 示例名称不冒充真实学校", () => {
  for (const s of DEMO_SCHOOLS) {
    assert.ok(
      s.name.startsWith("示例"),
      `演示学校名称应以“示例”开头: ${s.name}`,
    );
    for (const hint of forbiddenSchoolHints) {
      assert.ok(
        !s.name.includes(hint),
        `演示名称不得包含真实学校暗示“${hint}”: ${s.name}`,
      );
    }
  }
});

test("6) 阶段筛选正确", () => {
  const k = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    stage: "kindergarten",
  });
  assert.equal(k.length, 1);
  assert.equal(k[0].stage, "kindergarten");

  const p = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    stage: "primary",
  });
  assert.equal(p.length, 1);
  assert.equal(p[0].stage, "primary");

  const j = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    stage: "junior",
  });
  assert.equal(j.length, 1);
  assert.equal(j[0].stage, "junior");
});

test("7) 区域筛选正确", () => {
  const r = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    district: "碑林区",
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "示例小学B");

  const none = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    district: "不存在区",
  });
  assert.equal(none.length, 0);
});

test("8) 性质筛选正确", () => {
  const r = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    ownership: "public",
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "示例幼儿园A");

  const inc = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    ownership: "inclusive",
  });
  assert.equal(inc.length, 1);
  assert.equal(inc[0].name, "示例初中C");
});

test("9) 关键词筛选正确", () => {
  const r = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    keyword: "雁塔",
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "示例幼儿园A");

  const byName = filterSchools(DEMO_SCHOOLS, {
    ...emptyFilter(),
    keyword: "小学",
  });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, "示例小学B");
});

test("10) 多条件组合筛选正确", () => {
  const hit = filterSchools(DEMO_SCHOOLS, {
    stage: "kindergarten",
    keyword: "",
    district: "雁塔区",
    ownership: "all",
    verification: "all",
  });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, "示例幼儿园A");

  const miss = filterSchools(DEMO_SCHOOLS, {
    stage: "kindergarten",
    keyword: "",
    district: "碑林区",
    ownership: "all",
    verification: "all",
  });
  assert.equal(miss.length, 0);

  const combo = filterSchools(DEMO_SCHOOLS, {
    stage: "all",
    keyword: "初中",
    district: "all",
    ownership: "inclusive",
    verification: "all",
  });
  assert.equal(combo.length, 1);
  assert.equal(combo[0].name, "示例初中C");
});

test("12) 缺失字段显示“暂未核实”（卡片渲染依赖此逻辑）", () => {
  assert.equal(formatEmpty(""), "暂未核实");
  assert.equal(formatEmpty(undefined), "暂未核实");
  assert.equal(formatEmpty(null), "暂未核实");
  assert.equal(formatEmpty("   "), "暂未核实");
  assert.equal(formatEmpty("公办"), "公办");

  // 演示数据事实字段为空 -> 经 formatEmpty 变为“暂未核实”
  const demo = DEMO_SCHOOLS[0] as GrowthSchool;
  assert.equal(formatEmpty(demo.tuitionText), "暂未核实");
});

test("来源为空时返回 null（不生成假链接）", () => {
  const empty = formatSource("演示数据", "");
  assert.equal(empty.url, null);
  const withUrl = formatSource("官方公示", "https://example.com");
  assert.equal(withUrl.url, "https://example.com");
});

test("阶段/性质映射完整且可枚举", () => {
  assert.deepEqual(Object.keys(STAGE_LABELS).sort(), [
    "junior",
    "kindergarten",
    "primary",
    "senior",
  ]);
  assert.deepEqual(Object.keys(OWNERSHIP_LABELS).sort(), [
    "inclusive",
    "private",
    "public",
    "unknown",
  ]);
});

test("distinctDistricts 去重排序", () => {
  const d = distinctDistricts(DEMO_SCHOOLS);
  assert.deepEqual(d, ["未央区", "碑林区", "雁塔区"]);
});
