// 步骤18 Phase 2A：研究数据 → 可发布数据 转换层测试。
// 运行：node --test --experimental-strip-types tests/growth-school-research-adapter.test.ts
//
// 本测试刻意读取真实研究数据（16-CSV 与 15.5 性质补采），以验证：
//  - 13 列研究 CSV 正确映射；
//  - 15.5 与 16 按 schoolId 正确合并；
//  - 12 条 UNVERIFIED 被排除；
//  - 5 条性质未确认（ownership=unknown）被排除；
//  - 高新 3 所过渡校政策字段保留但不提升招生范围状态；
//  - 16 条招生范围中仅满足条件者进入候选（实为 12 条）；
//  - sourceTrace 完整；
//  - 不读取浏览器存储（静态检查）；
//  - 复用统一发布闸门（publishableFromGate 与 convertedToPublishable 一致）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertResearchToPublishable } from "../app/lib/growth-school-research-adapter.ts";
import { parseCsv } from "../app/lib/growth-school-import.ts";

const RESEARCH_PATH = new URL(
  "../docs/product/changan-growth-map/research/16-28所学校招生范围补采记录.csv",
  import.meta.url,
);
const OWNERSHIP_PATH = new URL(
  "../docs/product/changan-growth-map/research/15.5-28所学校字段补采记录.csv",
  import.meta.url,
);

function loadInputs() {
  return {
    researchCsv: readFileSync(RESEARCH_PATH, "utf8"),
    ownershipCsv: readFileSync(OWNERSHIP_PATH, "utf8"),
  };
}

// 构建 research 中 schoolId -> enrollmentScope 的映射，用于回环校验（用正式解析器，避免逗号错位）。
function researchScopeMap(researchCsv: string): Map<string, string> {
  const { headers, rows } = parseCsv(researchCsv);
  const idIdx = headers.indexOf("schoolId");
  const scopeIdx = headers.indexOf("enrollmentScope");
  const m = new Map<string, string>();
  for (const r of rows) {
    m.set(r.normalized[idIdx], r.normalized[scopeIdx]);
  }
  return m;
}

test("1) 13 列研究 CSV 正确解析并映射为 28 条记录", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.counts.totalResearch, 28, "应解析出 28 条研究记录");
  assert.equal(r.counts.verifiedResearch, 16, "其中 16 条 VERIFIED");
  assert.equal(r.counts.unverifiedResearch, 12, "其中 12 条 UNVERIFIED");
});

test("2) 15.5 与 16 按 schoolId 正确合并（性质归一化带入）", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  // 未央 4 所（P-WY-01/02、J-WY-01/02）在 16 中为 VERIFIED，但 15.5 性质为 unknown
  const unknowns = r.excludedSchools.filter((e) => e.ownershipNormalized === "unknown");
  const ids = unknowns.map((e) => e.schoolId).sort();
  assert.deepEqual(
    ids,
    ["J-WY-01", "J-WY-02", "K-WY-02", "P-WY-01", "P-WY-02"].sort(),
    "5 条性质未确认应全部被排除",
  );
});

test("3) 12 条 UNVERIFIED 被排除（不进入正式候选）", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  assert.equal(r.counts.excludedUnverified, 12, "排除的 UNVERIFIED 应为 12");
  // 候选（converted）中不得含任何 UNVERIFIED
  for (const c of r.convertedSchools) {
    assert.notEqual(
      r.excludedSchools.find((e) => e.schoolId === c.id)?.verificationStatus,
      "UNVERIFIED",
    );
  }
  assert.equal(r.counts.candidatesPassedFilter, 12);
});

test("4) 5 条性质未确认（ownership=unknown）不得进入 publishable", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  assert.equal(r.counts.excludedUnknownOwnership, 5, "性质未确认排除数应为 5");
  // 所有 converted 的性质都必须是已确认（非 unknown）
  for (const c of r.convertedSchools) {
    assert.notEqual(c.ownership, "unknown", `转化结果含未知性质：${c.id}`);
  }
});

test("5) 高新 3 所过渡校政策字段保留，但不提升招生范围状态", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  for (const id of ["P-GX-01", "P-GX-02", "J-GX-01"]) {
    const ex = r.excludedSchools.find((e) => e.schoolId === id);
    assert.ok(ex, `${id} 应在排除列表中`);
    assert.equal(ex!.verificationStatus, "UNVERIFIED", `${id} 招生范围仍为未核实`);
    assert.equal(ex!.enrollmentPolicyStatus, "transition_policy_verified", `${id} 政策字段应保留`);
    assert.equal(ex!.enrollmentPolicyNote, "继续沿用原政策", `${id} 政策说明应保留`);
  }
  // 这 3 所绝不出现在 converted（已发布）结果中
  assert.equal(
    r.convertedSchools.filter((c) => ["P-GX-01", "P-GX-02", "J-GX-01"].includes(c.id)).length,
    0,
    "高新 3 所不得进入 converted",
  );
});

test("6) 16 条招生范围中仅满足条件者进入候选（实为 12，且不超过 16）", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  assert.ok(r.counts.candidatesPassedFilter <= 16, "候选不得超过 16");
  assert.equal(r.counts.candidatesPassedFilter, 12, "实际候选应为 12");
  assert.equal(r.counts.convertedToPublishable, 12, "可发布转化应为 12");
  assert.equal(r.counts.publishableFromGate, 12, "统一闸门可发布数应为 12");
  assert.equal(r.gate.publishableRows, 12, "底层闸门 publishableRows 应为 12");
});

test("7) 转换后招生范围与研究层原文一致（V2 CSV 映射未丢失/篡改）", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  const scopeMap = researchScopeMap(input.researchCsv);
  for (const c of r.convertedSchools) {
    assert.equal(c.enrollmentScope, scopeMap.get(c.id), `招生范围回环不符：${c.id}`);
    assert.equal(c.verificationLevel, "A", `${c.id} 应映射为 A（官方公开）`);
    assert.equal(c.isDemo, false, `${c.id} 必须是真实数据`);
  }
});

test("8) sourceTrace 完整：每条研究记录的关键字段均可追溯", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  // 28 条记录 × 至少 10 个关键字段条目
  assert.ok(r.sourceTrace.length >= 28 * 10, `sourceTrace 过少：${r.sourceTrace.length}`);
  const tracedIds = new Set(r.sourceTrace.map((t) => t.schoolId));
  assert.equal(tracedIds.size, 28, "28 所学校均应在 trace 中出现");
  // 抽样验证来源文件标注正确
  const pYt01 = r.sourceTrace.find(
    (t) => t.schoolId === "P-YT-01" && t.field === "ownershipNormalized",
  );
  assert.equal(pYt01?.sourceFile, "15.5-CSV", "性质应溯源到 15.5-CSV");
  const scopeTrace = r.sourceTrace.find(
    (t) => t.schoolId === "P-YT-01" && t.field === "enrollmentScope",
  );
  assert.equal(scopeTrace?.sourceFile, "16-CSV", "招生范围应溯源到 16-CSV");
});

test("9) 不读取浏览器存储（静态检查转换层源码）", () => {
  const src = readFileSync(
    new URL("../app/lib/growth-school-research-adapter.ts", import.meta.url),
    "utf8",
  );
  // 仅检测真实用法（带 . 或下标访问），避免注释中提及字样造成误报。
  for (const token of [
    "localStorage.",
    "localStorage[",
    "sessionStorage.",
    "sessionStorage[",
    "window.",
    "document.",
  ]) {
    assert.ok(!src.includes(token), `转换层不得引用浏览器存储：${token}`);
  }
  // 也不得写文件
  assert.ok(!/writeFileSync|fs\.writeFile|\.writeFile\(/.test(src), "转换层不得写文件");
});

test("10) 复用统一发布闸门，未另造发布规则", () => {
  const input = loadInputs();
  const r = convertResearchToPublishable(input);
  // 转化结果全部来自 gate.publishableSchools，且数量一致
  assert.equal(r.convertedSchools.length, r.gate.publishableSchools.length);
  // 若存在被底层闸门拦截者，应出现在 excluded 并带闸门原因
  const gateBlocked = r.gate.results.filter((x) => !x.publishable).length;
  const exWithGateReason = r.excludedSchools.filter((e) =>
    e.reasons.some((rs) => rs.includes("办学性质") || rs.includes("可信等级") || rs.includes("来源")),
  ).length;
  assert.ok(
    exWithGateReason >= gateBlocked,
    "底层闸门拦截应反映到 excluded 原因",
  );
});
