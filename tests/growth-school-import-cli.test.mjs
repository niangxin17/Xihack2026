// 步骤08收尾：学校 CSV 校验 CLI 测试（真实启动子进程，验证只读、退出码与脱敏输出）。
// 运行：node --test tests/growth-school-import-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CLI = resolve(ROOT, "scripts", "validate-growth-schools-csv.mjs");
const NODE = process.execPath; // 当前 node 运行时
const FIX = (n) => resolve(__dirname, "fixtures", "growth-schools", n);

// 真实启动 CLI 子进程（复用 .ts 核心逻辑，需启用类型剥离）。
// extraArgs 用于传入 --require-publishable 等参数。
function runCli(relPath, ...extraArgs) {
  return spawnSync(NODE, ["--experimental-strip-types", CLI, relPath, ...extraArgs], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

// 无位置参数（仅参数或完全不带参数）的调用。
function runCliArgsOnly(...args) {
  return spawnSync(NODE, ["--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

function sha256Of(path) {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

// ===== 一、各夹具退出码 =====
test("1) valid.csv 退出 0", () => {
  const r = runCli(FIX("valid.csv"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("2) warning-only.csv 仅有警告，退出 0", () => {
  const r = runCli(FIX("warning-only.csv"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("警告数: 1"), "应报告 1 条警告");
});

test("3) invalid-headers.csv（缺必要表头）退出 1", () => {
  const r = runCli(FIX("invalid-headers.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("missing_required_header"));
});

test("4) duplicate-id.csv 退出 1", () => {
  const r = runCli(FIX("duplicate-id.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("duplicate_id"));
});

test("5) invalid-enum.csv 退出 1", () => {
  const r = runCli(FIX("invalid-enum.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("invalid_stage"));
});

test("6) invalid-url.csv 退出 1", () => {
  const r = runCli(FIX("invalid-url.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("invalid_source_url"));
});

test("7) invalid-date.csv 退出 1", () => {
  const r = runCli(FIX("invalid-date.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("invalid_date"));
});

test("8) formula-injection.csv 退出 1", () => {
  const r = runCli(FIX("formula-injection.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("formula_injection"));
});

test("9) script-injection.csv 退出 1", () => {
  const r = runCli(FIX("script-injection.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("script_injection"));
});

test("10) unverified.csv 格式正确但 publishable=0，退出 0", () => {
  const r = runCli(FIX("unverified.csv"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("可发布记录: 0"), "应报告可发布记录为 0");
  assert.ok(r.stdout.includes("有效记录: 1"), "应报告有效记录为 1");
});

test("11) mixed-results.csv（含错误）退出 1", () => {
  const r = runCli(FIX("mixed-results.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test("12) 文件不存在退出 1", () => {
  const r = runCli(FIX("does-not-exist.csv"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

// ===== 二、输出内容约束 =====
test("13) 输出包含统计摘要", () => {
  const r = runCli(FIX("mixed-results.csv"));
  for (const key of ["文件:", "记录数:", "有效记录:", "可发布记录:", "错误数:", "警告数:"]) {
    assert.ok(r.stdout.includes(key), `缺失摘要项：${key}`);
  }
});

test("14) 输出包含行号和错误码（逐行明细）", () => {
  const r = runCli(FIX("mixed-results.csv"));
  assert.ok(r.stdout.includes("--- 错误明细 ---"), "应有错误明细区块");
  // 错误行格式：<code>\t第<line>行\t<field>\t<脱敏说明>
  assert.ok(/invalid_source_url\t第\d+行/.test(r.stdout), "错误行应含错误码与行号");
});

test("15) 输出不包含敏感完整值（手机号等）", () => {
  const r = runCli(FIX("valid.csv"));
  // valid.csv 含 官方电话 029-87654321，但官方电话已排除出标准化结果，CLI 从不回显原值。
  assert.ok(!r.stdout.includes("029-87654321"), "CLI 不应输出完整官方电话");
});

test("16) 执行前后输入文件 SHA256 不变（只读）", () => {
  const p = FIX("valid.csv");
  const before = sha256Of(p);
  runCli(p);
  const after = sha256Of(p);
  assert.equal(before, after, "输入文件不应被 CLI 修改");
});

test("17) 执行前后 Git 工作区没有生成 JSON 或临时输出", () => {
  const statusBefore = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  runCli(FIX("mixed-results.csv"));
  runCli(FIX("valid.csv"));
  const statusAfter = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  assert.equal(statusBefore, statusAfter, "CLI 不应在工作区生成任何新文件");
  assert.ok(!/\.json$/.test(statusAfter), "工作区不应出现新生成的 JSON");
});

// ===== 三、办学性质发布闸门（错误码 / 统计 / 退出码）=====
test("19) 性质未确认记录：统计为有效 3 / 可发布 2 / 闸门拦截 1，默认退出 0", () => {
  const r = runCli(FIX("ownership-unverified.csv"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("记录数: 3"), r.stdout);
  assert.ok(r.stdout.includes("有效记录: 3"), "性质未确认仍是结构有效记录");
  assert.ok(r.stdout.includes("可发布记录: 2"), r.stdout);
  assert.ok(r.stdout.includes("闸门拦截记录: 1"), r.stdout);
  assert.ok(r.stdout.includes("错误数: 0"), "闸门拦截不得计入错误数");
});

test("20) 输出含 OWNERSHIP_UNVERIFIED 错误码、行号与字段名，且位于拦截明细区块", () => {
  const r = runCli(FIX("ownership-unverified.csv"));
  assert.ok(r.stdout.includes("--- 发布闸门拦截明细 ---"), "应有拦截明细区块");
  assert.ok(
    /OWNERSHIP_UNVERIFIED\t第4行\t学校性质\t/.test(r.stdout),
    `拦截行应含错误码/行号/字段名：\n${r.stdout}`,
  );
  // 拦截明细不得混入错误明细区块（两套口径分开呈现）。
  assert.ok(!r.stdout.includes("--- 错误明细 ---"), "无结构错误时不应出现错误明细区块");
  const blockCount = (r.stdout.match(/OWNERSHIP_UNVERIFIED/g) ?? []).length;
  assert.equal(blockCount, 1, "恰好 1 条性质未确认拦截");
});

test("21) --require-publishable 时存在闸门拦截 -> 退出 3", () => {
  const r = runCli(FIX("ownership-unverified.csv"), "--require-publishable");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("闸门拦截记录: 1"), r.stdout);
});

test("22) 性质全部明确且来源齐全 -> --require-publishable 仍退出 0", () => {
  const r = runCli(FIX("ownership-all-confirmed.csv"), "--require-publishable");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("有效记录: 2"), r.stdout);
  assert.ok(r.stdout.includes("可发布记录: 2"), r.stdout);
  assert.ok(r.stdout.includes("闸门拦截记录: 0"), r.stdout);
  assert.ok(!r.stdout.includes("OWNERSHIP_UNVERIFIED"), "无拦截时不应输出该错误码");
});

test("23) 结构错误优先于闸门拦截：含 error 时即使加 --require-publishable 也退出 1", () => {
  const r = runCli(FIX("mixed-results.csv"), "--require-publishable");
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test("24) 未知参数退出 2（拼写错误不得被静默忽略）", () => {
  const r = runCli(FIX("ownership-unverified.csv"), "--require-publishabel");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("未知参数"), r.stderr);
});

test("25) 不带 CSV 路径退出 2", () => {
  const r = runCliArgsOnly("--require-publishable");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("用法"), r.stderr);
});

test("26) 输出口径提示：可发布不等于资料完整，也不等于允许公开展示", () => {
  const r = runCli(FIX("ownership-unverified.csv"));
  assert.ok(
    r.stdout.includes("不等于资料完整") && r.stdout.includes("不等于允许公开展示"),
    `缺少口径提示：\n${r.stdout}`,
  );
});

test("27) --require-publishable 仍为只读：输入文件 SHA256 不变、工作区无新增文件", () => {
  const p = FIX("ownership-unverified.csv");
  const before = sha256Of(p);
  const statusBefore = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  runCli(p, "--require-publishable");
  assert.equal(sha256Of(p), before, "输入文件不应被 CLI 修改");
  const statusAfter = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  assert.equal(statusBefore, statusAfter, "CLI 不应在工作区生成任何新文件");
});

// ===== 四、npm 脚本可真实执行 =====
test("18) package.json 的 validate:growth-data 脚本可真实执行", () => {
  const rel = "tests/fixtures/growth-schools/valid.csv";
  const r = spawnSync("npm", ["run", "validate:growth-data", "--", rel], {
    encoding: "utf8",
    cwd: ROOT,
    shell: true, // 由 shell 解析 npm 命令（沙箱中子进程 PATH 不含 npm 可执行）
  });
  assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
  assert.ok(r.stdout.includes("记录数:"), "npm 脚本应正常输出统计摘要");
});
