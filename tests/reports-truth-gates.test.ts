// 真实性闸门单元测试（node --experimental-strip-types --test）
import assert from "node:assert/strict";
import test from "node:test";

import {
  isDisplayableExactQuota,
  isDisplayableRate,
  getMetricLabel,
  getVerificationLabel,
  makeNotPublishedSource,
  makeHistoricalSource,
} from "../app/lib/reports/verification.ts";
import { getCompetitionLevel, COMPETITION_LABELS } from "../app/lib/reports/competition.ts";
import type { DirectionalQuota } from "../app/lib/reports/types.ts";

function quota(partial: Partial<DirectionalQuota>): DirectionalQuota {
  return {
    highSchoolId: "x",
    highSchoolName: "示例高中",
    middleSchoolId: "m",
    middleSchoolName: "示例初中",
    year: 2026,
    quota: 3,
    eligibleStudentCount: 10,
    schoolRank: 2,
    historicalLowestRank: 5,
    competitionLevel: "unknown",
    source: {
      status: "official_verified",
      sourceUrl: "https://edu.xa.gov.cn/example",
      sourceTitle: "2026分配文件",
      publishedAt: "2026-05-01",
      updatedAt: "2026-05-01",
      cohort: null,
      notes: null,
    },
    ...partial,
  };
}

test("官方已核验且字段齐全的定向生名额可显示", () => {
  assert.equal(isDisplayableExactQuota(quota({})), true);
});

test("缺少本初中名称的定向生名额不可显示为确定数字", () => {
  assert.equal(isDisplayableExactQuota(quota({ middleSchoolName: "" })), false);
});

test("尚未发布的定向生名额不可显示", () => {
  assert.equal(
    isDisplayableExactQuota(
      quota({ source: { ...makeNotPublishedSource(), status: "not_published" } as any })
    ),
    false
  );
});

test("缺少名额的定向生名额不可显示", () => {
  assert.equal(isDisplayableExactQuota(quota({ quota: null })), false);
});

test("竞争度：核心字段齐全时返回具体等级", () => {
  assert.equal(
    getCompetitionLevel({ eligibleStudentCount: 10, quota: 3, schoolRank: 2, historicalLowestRank: 5 }),
    "high"
  );
  assert.equal(
    getCompetitionLevel({ eligibleStudentCount: 4, quota: 3, schoolRank: 2, historicalLowestRank: 5 }),
    "low"
  );
});

test("竞争度：缺少本初中资格人数时返回 unknown（无法判断）", () => {
  assert.equal(
    getCompetitionLevel({ eligibleStudentCount: null, quota: 3, schoolRank: 2, historicalLowestRank: 5 }),
    "unknown"
  );
});

test("竞争度：缺少校内位次与历史记录时返回 unknown", () => {
  assert.equal(
    getCompetitionLevel({ eligibleStudentCount: 10, quota: 3, schoolRank: null, historicalLowestRank: null }),
    "unknown"
  );
});

test("升学率：具备届次与来源URL时可显示，否则锁定", () => {
  const ok = makeHistoricalSource("2024", "x");
  ok.status = "official_verified" as any;
  ok.cohort = "2024届";
  ok.sourceUrl = "https://example.com";
  assert.equal(isDisplayableRate(66, ok), true);
  // 本项目真实数据：仅有百分比，无届次/来源 -> 锁定
  assert.equal(isDisplayableRate(66, makeHistoricalSource("2023-2024")), false);
});

test("来源标签：官方已核验带更新时间，未发布显示尚未发布", () => {
  const official = quota({}).source;
  assert.match(getMetricLabel(official), /官方已核验/);
  assert.match(getMetricLabel(makeNotPublishedSource()), /尚未发布/);
  assert.match(getMetricLabel(makeHistoricalSource("2023届")), /历史核验 · 2023届/);
});

test("核验状态标签映射完整", () => {
  assert.equal(getVerificationLabel("incomplete"), "口径不完整");
  assert.equal(getVerificationLabel("not_available"), "暂无数据");
  assert.equal(COMPETITION_LABELS.unknown, "无法判断");
});
