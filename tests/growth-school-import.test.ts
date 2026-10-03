// 步骤08：学校 CSV 导入、字段映射、质量校验与发布闸门测试。
// 运行：node --test --experimental-strip-types tests/growth-school-import.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCsv,
  importSchoolsCsv,
  HEADER_MAP,
  REQUIRED_HEADERS,
  OWNERSHIP_UNVERIFIED,
  PUBLISH_BLOCK_CODES,
  isOwnershipConfirmed,
} from "../app/lib/growth-school-import.ts";

// 保证列对齐的构造器：headers 长度必须与每行数组长度一致。
function csv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(","), ...rows.map((r) => r.join(","))];
  return lines.join("\n");
}

// 基础表头（覆盖展示字段 + 保留字段）
const H = [
  "学校ID",
  "学校名称",
  "学段",
  "所在区",
  "学校性质",
  "详细地址",
  "官方电话",
  "年度学费",
  "餐费",
  "餐食情况",
  "课程体系",
  "特色标签",
  "招生范围",
  "报名材料",
  "信息来源名称",
  "信息来源链接",
  "可信等级",
  "采集日期",
  "备注",
  "是否演示数据",
];

// 构造一行（默认是一条完整可发布的 A 级记录）
function rowA(over: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    学校ID: "S-A-01",
    学校名称: "示范小学",
    学段: "小学",
    所在区: "碑林区",
    学校性质: "公办",
    详细地址: "示例路1号",
    官方电话: "029-87654321",
    年度学费: "8000",
    餐费: "2000",
    餐食情况: "三餐两点",
    课程体系: "基础素养课程",
    特色标签: "家校沟通|阅读",
    招生范围: "以当年公告为准",
    报名材料: "户籍材料",
    信息来源名称: "市教育局官网",
    信息来源链接: "https://edu.example.gov",
    可信等级: "A",
    采集日期: "2026-08-01",
    备注: "来自市教育局公开公示",
    是否演示数据: "false",
  };
  return H.map((h) => (h in over ? (over[h] ?? "") : base[h]));
}

// ===== 一、解析器边界 =====
test("1) 去除 UTF-8 BOM", () => {
  const text = "﻿a,b\n1,2";
  const { headers } = parseCsv(text);
  assert.equal(headers[0], "a");
  assert.equal(headers[1], "b");
});

test("2) CRLF 与 LF 均能解析", () => {
  const crlf = parseCsv("a,b\r\n1,2\r\n");
  const lf = parseCsv("a,b\n1,2\n");
  assert.deepEqual(crlf.headers, ["a", "b"]);
  assert.deepEqual(crlf.rows.map((r) => r.normalized), [["1", "2"]]);
  assert.deepEqual(lf.rows.map((r) => r.normalized), [["1", "2"]]);
});

test("3) 双引号字段内的逗号不被拆分", () => {
  const { rows } = parseCsv('a,b\n"x,y",z');
  assert.deepEqual(rows[0].normalized, ["x,y", "z"]);
});

test("4) 双引号转义（\"\"）还原为单个引号", () => {
  const input = 'a\n"他说""你好"""';
  const { rows } = parseCsv(input);
  assert.equal(rows[0].normalized[0], '他说"你好"');
});

test("5) 空字段保留为空串（非被丢弃）", () => {
  const { rows } = parseCsv("a,b,c\n,,\n");
  assert.deepEqual(rows[0].normalized, ["", "", ""]);
});

test("6) 空行被跳过，行号正确", () => {
  const { rows } = parseCsv("a,b\n1,2\n\n3,4\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[1].rowNumber, 4);
});

test("7) 列数不一致的脏行仍按字段数解析且不崩溃", () => {
  const { rows } = parseCsv("a,b,c\n1,2\n9,8,7\n");
  assert.equal(rows[0].normalized.length, 2);
  assert.equal(rows[1].normalized.length, 3);
});

test("8) 中文表头与中文数据正确解析", () => {
  const { headers, rows } = parseCsv(H.join(",") + "\n" + rowA().join(","));
  assert.equal(headers.length, H.length);
  assert.equal(rows[0].normalized[1], "示范小学");
});

// ===== 二、字段映射 =====
test("9) 按中文表头名映射，与列位置无关", () => {
  // 打乱列顺序：把 学校ID 放到最后、学段放到最前
  const shuffled = [
    "学段",
    "所在区",
    "学校名称",
    "可信等级",
    "是否演示数据",
    "学校ID",
    "学校性质",
  ];
  const data = ["小学", "碑林区", "示范小学", "A", "false", "S-A-01", "公办"];
  const r = importSchoolsCsv(shuffled.join(",") + "\n" + data.join(","));
  assert.equal(r.validRows, 1);
  assert.equal(r.schools[0].id, "S-A-01");
  assert.equal(r.schools[0].stage, "primary");
});

test("10) 缺失必要表头直接报错", () => {
  const headers = H.filter((h) => h !== "是否演示数据");
  const r = importSchoolsCsv(csv(headers, [rowA()]));
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes("missing_required_header"));
});

test("11) 重复表头直接报错", () => {
  const headers = [...H, "学校ID"]; // 末尾再出现一次 学校ID
  const r = importSchoolsCsv(headers.join(",") + "\n" + [...rowA(), "X"].join(","));
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes("duplicate_header"));
});

test("12) 未识别表头进入 warnings，不静默丢弃", () => {
  const headers = [...H, "未知列"];
  const r = importSchoolsCsv(headers.join(",") + "\n" + [...rowA(), "啥"].join(","));
  assert.ok(r.warnings.some((w) => w.includes("未知列")));
  // 仍应正常导入其余字段
  assert.equal(r.validRows, 1);
});

test("13) 白名单保留字段进入 extra，敏感字段不进入", () => {
  const r = importSchoolsCsv(csv(H, [rowA()]));
  const s = r.schools[0];
  // 白名单内的非个人、非敏感机构元数据应进入 extra
  assert.equal(s.extra?.["餐费"], "2000");
  // 白名单外：官方电话（无法核验公开来源）、复核人员（个人姓名）不得进入标准化结果
  assert.ok(!("官方电话" in (s.extra ?? {})), "官方电话不应进入 extra");
  assert.ok(!("复核人员" in (s.extra ?? {})), "复核人员不应进入 extra");
  // 展示字段不被保留字段污染
  assert.equal(s.tuitionText, "8000");
  assert.ok(!("餐费" in s));
});

test("40) 隐私白名单：官方电话/复核人员即使格式合法也不进入 extra", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 复核人员: "示例审核员", 官方电话: "029-87654321" })]));
  assert.equal(r.validRows, 1);
  const s = r.schools[0];
  assert.ok(!("官方电话" in (s.extra ?? {})), "官方电话不进入 extra");
  assert.ok(!("复核人员" in (s.extra ?? {})), "复核人员不进入 extra");
  // 白名单内的仍进入
  assert.equal(s.extra?.["餐费"], "2000");
});

test("41) 未闭合引号视为 CSV 语法错误并抛出", () => {
  assert.throws(() => parseCsv('a,b\n"未闭合'), /CSV 语法错误|未闭合/);
});

test("14) 标签按统一分隔符拆分并去重", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 特色标签: "阅读|家校沟通|阅读" })]));
  assert.deepEqual(r.schools[0].featureTags, ["阅读", "家校沟通"]);
});

// ===== 三、基础校验 =====
test("15) 学校ID 为空报错", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校ID: "" })]));
  assert.ok(r.errors.some((e) => e.code === "missing_id"));
  assert.equal(r.validRows, 0);
});

test("16) 学校ID 重复仅保留首条", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校ID: "DUP" }), rowA({ 学校ID: "DUP", 学校名称: "另一所" })]));
  assert.equal(r.validRows, 1);
  assert.ok(r.errors.some((e) => e.code === "duplicate_id"));
  assert.equal(r.schools[0].name, "示范小学");
});

test("17) 学校名称为空报错", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校名称: "" })]));
  assert.ok(r.errors.some((e) => e.code === "missing_name"));
});

test("18) 学段非法枚举报错，合法值正确映射", () => {
  const bad = importSchoolsCsv(csv(H, [rowA({ 学段: "高中" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_stage"));
  const ok = importSchoolsCsv(csv(H, [rowA({ 学段: "幼儿园" })]));
  assert.equal(ok.schools[0].stage, "kindergarten");
  const ok2 = importSchoolsCsv(csv(H, [rowA({ 学段: "初中" })]));
  assert.equal(ok2.schools[0].stage, "junior");
});

test("19) 办学性质非法枚举报错，合法值正确映射", () => {
  const bad = importSchoolsCsv(csv(H, [rowA({ 学校性质: "私立" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_ownership"));
  const ok = importSchoolsCsv(csv(H, [rowA({ 学校性质: "民办" })]));
  assert.equal(ok.schools[0].ownership, "private");
});

test("20) 可信等级非法枚举报错，多种写法均可识别", () => {
  const bad = importSchoolsCsv(csv(H, [rowA({ 可信等级: "X级" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_verification"));
  const pairs: [string, string][] = [
    ["A", "A"],
    ["官方公开", "A"],
    ["B", "B"],
    ["学校确认", "B"],
    ["C", "C"],
    ["平台核验", "C"],
    ["D", "D"],
    ["家长反馈", "D"],
    ["UNVERIFIED", "UNVERIFIED"],
    ["暂未核实", "UNVERIFIED"],
  ];
  for (const [input, expected] of pairs) {
    const r = importSchoolsCsv(csv(H, [rowA({ 可信等级: input })]));
    assert.equal(r.schools[0].verificationLevel, expected, `输入 ${input}`);
  }
});

test("21) isDemo 严格解析为 true/false", () => {
  const t = importSchoolsCsv(csv(H, [rowA({ 是否演示数据: "true" })]));
  assert.equal(t.schools[0].isDemo, true);
  const f = importSchoolsCsv(csv(H, [rowA({ 是否演示数据: "false" })]));
  assert.equal(f.schools[0].isDemo, false);
  const bad = importSchoolsCsv(csv(H, [rowA({ 是否演示数据: "是" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_isdemo"));
  const empty = importSchoolsCsv(csv(H, [rowA({ 是否演示数据: "" })]));
  assert.ok(empty.errors.some((e) => e.code === "missing_isdemo"));
});

test("22) 信息来源链接必须为 http/https", () => {
  const bad = importSchoolsCsv(csv(H, [rowA({ 信息来源链接: "ftp://x.com" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_source_url"));
  const ok = importSchoolsCsv(csv(H, [rowA({ 信息来源链接: "https://x.com" })]));
  assert.equal(ok.schools[0].sourceUrl, "https://x.com");
});

test("23) 采集日期必须为合法日期", () => {
  const ok = importSchoolsCsv(csv(H, [rowA({ 采集日期: "2026-08-04" })]));
  assert.equal(ok.schools[0].sourceUpdatedAt, "2026-08-04");
  const ok2 = importSchoolsCsv(csv(H, [rowA({ 采集日期: "2026/08/04" })]));
  assert.equal(ok2.schools[0].sourceUpdatedAt, "2026/08/04");
  const bad = importSchoolsCsv(csv(H, [rowA({ 采集日期: "2026-13-99" })]));
  assert.ok(bad.errors.some((e) => e.code === "invalid_date"));
  const bad2 = importSchoolsCsv(csv(H, [rowA({ 采集日期: "不是日期" })]));
  assert.ok(bad2.errors.some((e) => e.code === "invalid_date"));
});

// ===== 四、安全校验（不因“内部 CSV”而降低）=====
test("24) 公式注入前缀 = + - @ 被拒绝", () => {
  for (const prefix of ["=SUM(A1)", "+1", "-1", "@cmd"]) {
    const r = importSchoolsCsv(csv(H, [rowA({ 学校名称: prefix })]));
    assert.ok(r.errors.some((e) => e.code === "formula_injection"), `前缀 ${prefix}`);
  }
});

test("25) 脚本 / 危险链接被拒绝", () => {
  const r1 = importSchoolsCsv(csv(H, [rowA({ 备注: "<script>alert(1)</script>" })]));
  assert.ok(r1.errors.some((e) => e.code === "script_injection"));
  const r2 = importSchoolsCsv(csv(H, [rowA({ 备注: "javascript:alert(1)" })]));
  assert.ok(r2.errors.some((e) => e.code === "script_injection"));
});

test("26) 违规承诺用语被拒绝", () => {
  const r1 = importSchoolsCsv(csv(H, [rowA({ 备注: "保证录取名额" })]));
  assert.ok(r1.errors.some((e) => e.code === "illegal_promise"));
  const r2 = importSchoolsCsv(csv(H, [rowA({ 招生范围: "内部名额预留" })]));
  assert.ok(r2.errors.some((e) => e.code === "illegal_promise"));
});

test("27) 明文手机号 / 身份证号被拒绝", () => {
  const r1 = importSchoolsCsv(csv(H, [rowA({ 备注: "联系13800138000" })]));
  assert.ok(r1.errors.some((e) => e.code === "pii_contact"));
  const r2 = importSchoolsCsv(csv(H, [rowA({ 备注: "身份证11010119900307123X" })]));
  assert.ok(r2.errors.some((e) => e.code === "pii_contact"));
});

// ===== 五、可信等级校验与发布闸门 =====
test("28) A 级且字段齐全 -> 可发布", () => {
  const r = importSchoolsCsv(csv(H, [rowA()]));
  assert.equal(r.results[0].publishable, true);
  assert.equal(r.publishableRows, 1);
});

test("29) A 级缺失来源名称 -> 不可发布", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 信息来源名称: "" })]));
  assert.equal(r.results[0].publishable, false);
  assert.ok(r.results[0].publishReasons.some((x) => x.includes("A 官方公开")));
  assert.equal(r.publishableRows, 0);
});

test("30) B 级缺失可信度说明 -> 不可发布", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 可信等级: "B", 备注: "" })]));
  assert.equal(r.results[0].publishable, false);
  assert.ok(r.results[0].publishReasons.some((x) => x.includes("B 学校确认")));
});

test("31) C 级缺失采集日期 -> 不可发布", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 可信等级: "C", 采集日期: "" })]));
  assert.equal(r.results[0].publishable, false);
  assert.ok(r.results[0].publishReasons.some((x) => x.includes("C 平台核验")));
});

test("32) D 级缺失可信度说明 -> 不可发布", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 可信等级: "D", 备注: "" })]));
  assert.equal(r.results[0].publishable, false);
  assert.ok(r.results[0].publishReasons.some((x) => x.includes("D 家长反馈")));
});

test("33) UNVERIFIED 允许来源缺失，但不得进入正式发布", () => {
  const r = importSchoolsCsv(
    csv(H, [rowA({ 可信等级: "UNVERIFIED", 信息来源名称: "", 信息来源链接: "", 采集日期: "", 备注: "演示数据" })]),
  );
  assert.equal(r.validRows, 1);
  assert.equal(r.results[0].publishable, false);
  assert.ok(r.results[0].publishReasons.some((x) => x.includes("UNVERIFIED")));
  assert.equal(r.publishableRows, 0);
});

test("34) 不根据学校名称推断区县/性质/等级", () => {
  // 名称含“雁塔区”，但所在区留空 -> 应报缺失，而非自动填入
  const r = importSchoolsCsv(csv(H, [rowA({ 学校名称: "雁塔区第一小学", 所在区: "" })]));
  assert.ok(r.errors.some((e) => e.code === "missing_district"));
});

test("35) 空字符串存为空串（暂未核实），extra 不存空值", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 详细地址: "", 官方电话: "" })]));
  assert.equal(r.schools[0].address, "");
  assert.ok(!("官方电话" in (r.schools[0].extra ?? {})));
});

// ===== 六、汇总与边界 =====
test("36) 导入结果汇总计数正确", () => {
  const r = importSchoolsCsv(
    csv(H, [
      rowA(),
      rowA({ 学校ID: "S-B-02", 可信等级: "UNVERIFIED", 信息来源名称: "", 信息来源链接: "", 采集日期: "", 备注: "演示", 是否演示数据: "true" }),
    ]),
  );
  assert.equal(r.totalRows, 2);
  assert.equal(r.validRows, 2);
  assert.equal(r.publishableRows, 1);
  assert.equal(r.publishableSchools.length, 1);
});

test("37) 行数上限触发 too_many_rows", () => {
  const rows = [rowA(), rowA({ 学校ID: "S-02" })];
  const r = importSchoolsCsv(csv(H, rows), { maxRows: 1 });
  assert.ok(r.errors.some((e) => e.code === "too_many_rows"));
});

// ===== 七、源码约束 =====
test("38) 未使用 line.split(',') 式简易解析", () => {
  const src = readFileSync(
    new URL("../app/lib/growth-school-import.ts", import.meta.url),
    "utf8",
  );
  // 真实解析器应基于 tokenize 状态机；不允许直接用逗号切分整行。
  assert.ok(src.includes("function tokenize"));
  assert.ok(!/\.split\(\s*["']?,["']?\s*\)/.test(src));
});

test("39) HEADER_MAP 覆盖必要表头，且确实存在 extra 保留字段", () => {
  for (const h of REQUIRED_HEADERS) {
    assert.ok(h in HEADER_MAP, `必要表头未映射：${h}`);
  }
  const extras = Object.values(HEADER_MAP).filter((v) => v === "extra");
  assert.ok(extras.length >= 5, `保留字段过少：${extras.length}`);
});

// ===== 八、办学性质发布闸门 =====
// 口径前提（不得在后续改动中放宽）：
//   性质未确认的记录仍是「结构有效」记录，只是不得进入 publishableSchools；
//   拦截不写入 errors，两套口径互相独立，恒等式 validRows = publishableRows + blockedRows。

// 构造 n 行公办 A 级完整记录；unknownIndexes 指定的行把 学校性质 改为「暂未核实」。
function ownershipId(i: number): string {
  return `S-OWN-${String(i + 1).padStart(2, "0")}`;
}

function ownershipBatch(n: number, unknownIndexes: number[] = []): string[][] {
  const unknownSet = new Set(unknownIndexes);
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) {
    const over: Record<string, string> = {
      学校ID: ownershipId(i),
      学校名称: `样例学校${i + 1}`,
    };
    if (unknownSet.has(i)) over["学校性质"] = "暂未核实";
    rows.push(rowA(over));
  }
  return rows;
}

test("42) isOwnershipConfirmed 只认公办/民办/融合特教，unknown 与空值一律未确认", () => {
  assert.equal(isOwnershipConfirmed("public"), true);
  assert.equal(isOwnershipConfirmed("private"), true);
  assert.equal(isOwnershipConfirmed("inclusive"), true);
  assert.equal(isOwnershipConfirmed("unknown"), false);
  assert.equal(isOwnershipConfirmed(null), false);
  assert.equal(isOwnershipConfirmed(undefined), false);
});

test("43) 学校性质为「暂未核实」：结构有效但被闸门拦截（OWNERSHIP_UNVERIFIED）", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校性质: "暂未核实" })]));
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.validRows, 1, "性质未确认不影响结构有效性");
  assert.equal(r.publishableRows, 0);
  assert.equal(r.blockedRows, 1);
  assert.equal(r.schools[0].ownership, "unknown");
  assert.equal(r.results[0].publishable, false);
  assert.deepEqual(
    r.results[0].publishBlockers.map((b) => b.code),
    [OWNERSHIP_UNVERIFIED],
  );
  assert.equal(r.publishBlockers.length, 1);
  assert.equal(r.publishBlockers[0].field, "学校性质");
  assert.equal(r.publishBlockers[0].line, 2, "拦截项应带可定位行号");
});

test("44) 28 行性质全部明确（公办 A 级完整）-> 可发布 28、拦截 0", () => {
  const r = importSchoolsCsv(csv(H, ownershipBatch(28)));
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.totalRows, 28);
  assert.equal(r.validRows, 28);
  assert.equal(r.publishableRows, 28);
  assert.equal(r.blockedRows, 0);
  assert.equal(r.publishBlockers.length, 0);
  assert.equal(r.publishableSchools.length, 28);
});

test("45) 28 行中 5 行性质改为「暂未核实」-> 有效 28、可发布 23、恰好 5 条 OWNERSHIP_UNVERIFIED", () => {
  const unknownIdx = [1, 7, 12, 20, 27];
  const r = importSchoolsCsv(csv(H, ownershipBatch(28, unknownIdx)));
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.totalRows, 28);
  assert.equal(r.validRows, 28);
  assert.equal(r.publishableRows, 23);
  assert.equal(r.blockedRows, 5);
  const ownBlocked = r.publishBlockers.filter((b) => b.code === OWNERSHIP_UNVERIFIED);
  assert.equal(ownBlocked.length, 5, "应恰好 5 条性质未确认拦截");
  assert.equal(r.publishBlockers.length, 5, "不应混入其它拦截码");
  // 被拦截的正是那 5 所，其余 23 所全部进入 publishableSchools。
  const blockedIds = r.results.filter((x) => !x.publishable).map((x) => x.schoolId);
  assert.deepEqual(blockedIds, unknownIdx.map(ownershipId));
  assert.equal(r.publishableSchools.length, 23);
  assert.ok(
    r.publishableSchools.every((s) => s.ownership !== "unknown"),
    "publishableSchools 不得含性质未确认的学校",
  );
});

test("46) 闸门拦截不计入 errors，且满足 validRows = publishableRows + blockedRows", () => {
  const r = importSchoolsCsv(csv(H, ownershipBatch(28, [0, 1, 2, 3, 4])));
  assert.equal(r.errors.length, 0, "闸门拦截不是结构错误，不得写入 errors");
  assert.equal(r.validRows, r.publishableRows + r.blockedRows);
});

test("47) 民办与融合/特教不被性质闸门拦截", () => {
  const pairs: [string, string][] = [
    ["民办", "private"],
    ["融合/特教", "inclusive"],
  ];
  for (const [cn, en] of pairs) {
    const r = importSchoolsCsv(csv(H, [rowA({ 学校性质: cn })]));
    assert.equal(r.schools[0].ownership, en, cn);
    assert.equal(r.publishableRows, 1, cn);
    assert.equal(r.blockedRows, 0, cn);
  }
});

test("48) 性质未确认 + 可信等级 UNVERIFIED：两个拦截码并存，性质检查在前", () => {
  const r = importSchoolsCsv(
    csv(H, [
      rowA({
        学校性质: "暂未核实",
        可信等级: "UNVERIFIED",
        信息来源名称: "",
        信息来源链接: "",
        采集日期: "",
        备注: "演示数据",
      }),
    ]),
  );
  assert.equal(r.validRows, 1);
  assert.equal(r.publishableRows, 0);
  assert.deepEqual(
    r.results[0].publishBlockers.map((b) => b.code),
    [OWNERSHIP_UNVERIFIED, PUBLISH_BLOCK_CODES.verificationUnverified],
  );
});

test("49) publishable 不等于资料完整：性质明确但学费/餐食/课程/招生范围全空仍可发布", () => {
  const r = importSchoolsCsv(
    csv(H, [
      rowA({
        详细地址: "",
        年度学费: "",
        餐食情况: "",
        课程体系: "",
        特色标签: "",
        招生范围: "",
        报名材料: "",
      }),
    ]),
  );
  assert.equal(r.publishableRows, 1, "闸门不校验资料完整度");
  assert.equal(r.blockedRows, 0);
  assert.equal(r.schools[0].enrollmentScope, "", "空值仍是空值，不得编造");
});

test("50) 学校性质为空：既报结构错误，也给出性质未确认定位，且不进入 publishableSchools", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校性质: "" })]));
  assert.ok(r.errors.some((e) => e.code === "missing_ownership"));
  assert.equal(r.validRows, 0);
  assert.equal(r.publishableRows, 0);
  assert.equal(r.results[0].publishable, false);
  assert.deepEqual(
    r.results[0].publishBlockers.map((b) => b.code),
    [OWNERSHIP_UNVERIFIED],
  );
  // 结构非法行已在 errors 中报告，不在顶层拦截明细里重复计数。
  assert.equal(r.publishBlockers.length, 0);
  assert.equal(r.blockedRows, 0);
});

test("51) 不认识的性质写法（如「私立」）同样视为性质未确认", () => {
  const r = importSchoolsCsv(csv(H, [rowA({ 学校性质: "私立" })]));
  assert.ok(r.errors.some((e) => e.code === "invalid_ownership"));
  assert.equal(r.publishableRows, 0);
  assert.deepEqual(
    r.results[0].publishBlockers.map((b) => b.code),
    [OWNERSHIP_UNVERIFIED],
  );
});

test("52) 源码约束：发布闸门必须实际执行性质检查（防止后续悄悄放宽）", () => {
  const src = readFileSync(
    new URL("../app/lib/growth-school-import.ts", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("isOwnershipConfirmed"), "应保留性质确认判定函数");
  assert.ok(src.includes("OWNERSHIP_UNVERIFIED"), "应保留结构化错误码");
  assert.ok(
    /publishable:\s*publishBlockers\.length === 0/.test(src),
    "publishable 必须由拦截列表决定，不得写死为 true",
  );
});
