// 步骤09 · 家庭成长档案模型单元测试（node --experimental-strip-types --test）
// 覆盖：默认值、上限、互斥、notes 清洗/长度、监护人未确认不能生成摘要、
// 摘要依据/无诊断/无录取概率、建议筛选仅含 stage/district/ownership、清空回默认。
// 注意：测试注释与用例均不写入任何「未经真实业务数据证明」的具体数字，以免触发真实性闸门。
import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyFamilyProfile,
  clearFamilyProfile,
  toggleLimitedChoice,
  sanitizeFamilyNotes,
  validateFamilyProfile,
  buildPlanningSummary,
  deriveSuggestedSchoolFilters,
  MAX_MULTI_CHOICE,
  NOTES_MAX_LENGTH,
  type FamilyProfile,
  type Priority,
  type LearningObservation,
} from "../app/lib/growth-family-profile.ts";

// 构造一份已确认监护人的基础档案，便于复用。
function confirmed(p: Partial<FamilyProfile> = {}): FamilyProfile {
  return { ...createEmptyFamilyProfile(), guardianConfirmed: true, ...p };
}

test("1) 空档案默认值", () => {
  const p = createEmptyFamilyProfile();
  assert.equal(p.childStage, "unknown");
  assert.equal(p.familyDistrict, "undecided");
  assert.equal(p.schoolOwnershipPreference, "no_preference");
  assert.deepEqual(p.priorities, []);
  assert.deepEqual(p.learningObservations, []);
  assert.equal(p.notes, "");
  assert.equal(p.guardianConfirmed, false);
});

test("2) priorities 最多 5 项", () => {
  const all: Priority[] = [
    "admission_policy",
    "tuition",
    "commute",
    "meals",
    "teacher_stability",
    "teacher_patience",
  ];
  let cur: Priority[] = [];
  for (const v of all) {
    cur = toggleLimitedChoice(cur, v, { max: MAX_MULTI_CHOICE });
  }
  assert.equal(cur.length, MAX_MULTI_CHOICE);
  // 第 6 项被忽略（达到上限后不再增长）。
  assert.ok(!cur.includes("teacher_patience"));
  // 再次切换已选项可移除。
  cur = toggleLimitedChoice(cur, "meals", { max: MAX_MULTI_CHOICE });
  assert.ok(!cur.includes("meals"));
});

test("3) learningObservations 最多 5 项", () => {
  const all: LearningObservation[] = [
    "needs_interest_guidance",
    "needs_habit_support",
    "needs_reading_support",
    "needs_writing_support",
    "needs_calculation_support",
    "needs_language_environment",
  ];
  let cur: LearningObservation[] = [];
  for (const v of all) {
    cur = toggleLimitedChoice(cur, v, { max: MAX_MULTI_CHOICE });
  }
  assert.equal(cur.length, MAX_MULTI_CHOICE);
  assert.ok(!cur.includes("needs_language_environment"));
});

test("4) no_specific_observation 与其它观察互斥", () => {
  let cur = toggleLimitedChoice<LearningObservation>(
    ["needs_reading_support"],
    "no_specific_observation",
    { max: MAX_MULTI_CHOICE, exclusive: "no_specific_observation" },
  );
  assert.deepEqual(cur, ["no_specific_observation"]);
  // 选中其它观察时，互斥项被移除。
  cur = toggleLimitedChoice(cur, "needs_writing_support", {
    max: MAX_MULTI_CHOICE,
    exclusive: "no_specific_observation",
  });
  assert.deepEqual(cur, ["needs_writing_support"]);
  // 同时存在的非法组合应被校验拦截。
  const bad = confirmed({
    learningObservations: ["no_specific_observation", "needs_reading_support"],
  });
  const v = validateFamilyProfile(bad);
  assert.ok(v.errors.some((e) => e.code === "observation_exclusive"));
});

test("5) notes 长度限制（截断 + 防御性校验）", () => {
  const long = "补".repeat(NOTES_MAX_LENGTH + 50);
  const cleaned = sanitizeFamilyNotes(long);
  assert.ok(cleaned.length <= NOTES_MAX_LENGTH);
  // 未清洗直接塞入超长 notes，校验应报错。
  const bad = confirmed({ notes: "补".repeat(NOTES_MAX_LENGTH + 1) });
  const v = validateFamilyProfile(bad);
  assert.ok(v.errors.some((e) => e.code === "notes_too_long"));
});

test("6) notes 脚本与 HTML 清理", () => {
  assert.equal(
    sanitizeFamilyNotes("<script>alert(1)</script>希望重视家校沟通"),
    "希望重视家校沟通",
  );
  assert.equal(
    sanitizeFamilyNotes('onerror="alert(1)" 孩子需要阅读支持'),
    "孩子需要阅读支持",
  );
  assert.equal(
    sanitizeFamilyNotes("JAVASCRIPT:alert(1) 关注餐食"),
    "关注餐食",
  );
});

test("7) notes 联系方式与身份证样式拦截", () => {
  // 手机号被去除（词边界，不会误吞身份证内数字）。
  assert.equal(sanitizeFamilyNotes("电话13800138000关注通勤"), "电话关注通勤");
  // 身份证样式（18 位）被去除。
  assert.equal(
    sanitizeFamilyNotes("证件61011320200101123X关注课程"),
    "证件关注课程",
  );
  // 微信号提示被去除。
  assert.equal(sanitizeFamilyNotes("微信号 abc_123 关注师资"), "关注师资");
  // 邮箱地址被去除（"邮箱"为普通中文词，予以保留）。
  assert.equal(sanitizeFamilyNotes("邮箱a@b.com关注管理"), "邮箱关注管理");
});

test("8) guardian 未确认不能生成摘要", () => {
  const p = createEmptyFamilyProfile(); // guardianConfirmed=false
  assert.equal(buildPlanningSummary(p), null);
  const withData = confirmed({
    childStage: "primary_lower",
    priorities: ["commute", "meals"],
  });
  assert.notEqual(buildPlanningSummary(withData), null);
});

test("9) 摘要包含生成依据", () => {
  const p = confirmed({
    childStage: "primary_lower",
    familyDistrict: "雁塔区",
    schoolOwnershipPreference: "public",
    priorities: ["commute", "meals"],
  });
  const s = buildPlanningSummary(p);
  assert.ok(s);
  assert.ok(s!.basis.length > 0);
  // 依据中应出现阶段、区域、性质的映射说明。
  const joined = s!.basis.join("；");
  assert.ok(joined.includes("阶段"));
  assert.ok(joined.includes("区域"));
  assert.ok(joined.includes("性质"));
});

test("10) 摘要不产生诊断", () => {
  const p = confirmed({
    learningObservations: ["needs_reading_support", "adapts_slowly"],
  });
  const s = buildPlanningSummary(p);
  assert.ok(s);
  const all = [
    ...s!.filledConditions,
    ...s!.planningFocus,
    ...s!.basis,
  ].join("；");
  // 不得出现诊断/心理/智力/人格相关表述。
  for (const forbidden of [
    "智力",
    "智商",
    "人格",
    "心理诊断",
    "诊断",
    "疾病",
  ]) {
    assert.ok(!all.includes(forbidden), `摘要不应包含「${forbidden}」`);
  }
});

test("11) 摘要不产生录取概率与排名", () => {
  const p = confirmed({ childStage: "junior" });
  const s = buildPlanningSummary(p);
  assert.ok(s);
  const all = [
    ...s!.filledConditions,
    ...s!.planningFocus,
    ...s!.suggestedVerifications,
    ...s!.basis,
  ].join("；");
  for (const forbidden of [
    "录取概率",
    "概率",
    "排名",
    "最适合",
    "保证",
    "一定成功",
  ]) {
    assert.ok(!all.includes(forbidden), `摘要不应包含「${forbidden}」`);
  }
});

test("12) 建议筛选只包含 stage/district/ownership", () => {
  const p = confirmed({
    childStage: "primary_upper",
    familyDistrict: "未央区",
    schoolOwnershipPreference: "private",
    annualBudgetBand: "1w_3w",
    commutePreference: "under_30m",
    priorities: ["tuition", "commute"],
  });
  const f = deriveSuggestedSchoolFilters(p);
  // 关键映射正确。
  assert.equal(f.stage, "primary");
  assert.equal(f.district, "未央区");
  assert.equal(f.ownership, "private");
  // 预算/通勤/关注点不进入筛选对象（仅 stage/district/ownership）。
  const keys = Object.keys(f).sort();
  assert.deepEqual(keys, ["district", "ownership", "stage"]);
  // 摘要中预算仅用于提示而非筛选。
  const s = buildPlanningSummary(p);
  assert.ok(s);
  assert.equal(s!.suggestedFilters.district, "未央区");
});

test("12b) 未决定区域不伪造区域匹配", () => {
  const p = confirmed({ familyDistrict: "undecided" });
  const f = deriveSuggestedSchoolFilters(p);
  assert.equal(f.district, "all");
  const p2 = confirmed({ familyDistrict: "outside_xian" });
  assert.equal(deriveSuggestedSchoolFilters(p2).district, "all");
});

test("13) 清空后回到默认值", () => {
  const filled = confirmed({
    childStage: "kindergarten",
    familyDistrict: "碑林区",
    priorities: ["meals", "commute"],
    notes: "希望重视餐食",
  });
  const cleared = clearFamilyProfile();
  assert.deepEqual(cleared, createEmptyFamilyProfile());
});
