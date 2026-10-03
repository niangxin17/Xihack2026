// 长安成长地图 · 学校 CSV 只读校验 CLI（默认只读，不写文件、不生成 JSON、不修改源码数据）。
//
// 复用同一套校验逻辑：app/lib/growth-school-import.ts（TypeScript）。
// 运行方式（项目已有方式，启用类型剥离以导入 .ts）：
//   node --experimental-strip-types scripts/validate-growth-schools-csv.mjs <CSV路径> [--require-publishable]
//
// 退出码：
//   0  仅警告或完全通过（无 error）
//   1  存在 error / 文件不存在 / 表头错误 / 编码或 CSV 语法错误
//   2  未提供路径参数 / 未知参数
//   3  指定 --require-publishable 时，存在被发布闸门拦截的记录（如办学性质未确认）
//
// 口径说明（输出中的三个数字互不等价，不得互相代称）：
//   有效记录     = 结构合法（可解析、枚举合法、无安全问题）
//   可发布记录   = 结构合法且通过发布闸门；仍不代表资料完整或允许公开展示
//   闸门拦截记录 = 结构合法但被闸门拦截（例如 OWNERSHIP_UNVERIFIED）
//
// 隐私与只读约束：
//   - 仅读取输入文件，绝不写入任何文件，也不生成临时 JSON；
//   - 不修改输入 CSV 与源码演示数据；
//   - 输出不含完整手机号、身份证号、微信号或整行原始数据（错误说明一律脱敏）。

import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve, isAbsolute } from "node:path";
import { importSchoolsCsv } from "../app/lib/growth-school-import.ts";

function fail(message) {
  process.stderr.write(`[错误] ${message}\n`);
  process.exit(1);
}

const KNOWN_FLAGS = new Set(["--require-publishable"]);

function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith("--"));
  const positional = argv.filter((a) => !a.startsWith("--"));

  // 未知参数显式报错，避免拼写错误被静默忽略而误判为「已启用严格模式」。
  const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
  if (unknownFlags.length > 0) {
    process.stderr.write(`未知参数: ${unknownFlags.join(" ")}\n`);
    process.stderr.write(`支持的参数: ${[...KNOWN_FLAGS].join(" ")}\n`);
    process.exit(2);
  }
  const requirePublishable = flags.includes("--require-publishable");

  const arg = positional[0];
  if (!arg) {
    process.stderr.write(
      "用法: npm run validate:growth-data -- <CSV绝对路径或项目相对路径> [--require-publishable]\n",
    );
    process.exit(2);
  }

  // 路径解析：绝对路径直接使用，相对路径基于当前工作目录。
  const path = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);

  // 1) 读取（不存在 / 无权限直接退出 1）。
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    fail(`文件不存在或无法读取: ${path}`);
  }

  // 2) 编码校验：必须为合法 UTF-8（无 BOM 亦可）。
  if (typeof Buffer.isUtf8 === "function" && !Buffer.isUtf8(buf)) {
    fail(`文件编码不是合法 UTF-8: ${path}`);
  }

  // 3) 解码为文本（UTF-8）。
  let text;
  try {
    text = buf.toString("utf8");
  } catch {
    fail(`文件解码失败（编码异常）: ${path}`);
  }

  // 4) 复用核心校验逻辑（CSV 语法错误会在此抛出）。
  let result;
  try {
    result = importSchoolsCsv(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    fail(`CSV 解析失败（语法错误）: ${msg}`);
  }

  const errCount = result.errors.length;
  const warnCount = result.warnings.length;

  // 5) 统计摘要。
  process.stdout.write(`文件: ${path}\n`);
  process.stdout.write(`记录数: ${result.totalRows}\n`);
  process.stdout.write(`有效记录: ${result.validRows}\n`);
  process.stdout.write(`可发布记录: ${result.publishableRows}\n`);
  process.stdout.write(`闸门拦截记录: ${result.blockedRows}\n`);
  process.stdout.write(`错误数: ${errCount}\n`);
  process.stdout.write(`警告数: ${warnCount}\n`);

  // 6) 逐行错误：错误码 / 行号 / 字段名 / 脱敏说明（不含原始完整值）。
  if (errCount > 0) {
    process.stdout.write("--- 错误明细 ---\n");
    for (const e of result.errors) {
      const line = e.line === undefined ? "-" : String(e.line);
      const field = e.field ?? "-";
      process.stdout.write(`${e.code}\t第${line}行\t${field}\t${e.message}\n`);
    }
  }

  // 7) 发布闸门拦截明细：结构合法但不得进入正式发布（不计入错误数）。
  if (result.publishBlockers.length > 0) {
    process.stdout.write("--- 发布闸门拦截明细 ---\n");
    for (const b of result.publishBlockers) {
      const line = b.line === undefined ? "-" : String(b.line);
      const field = b.field ?? "-";
      process.stdout.write(`${b.code}\t第${line}行\t${field}\t${b.message}\n`);
    }
  }

  // 8) 警告（保留表头等未识别列）。
  if (warnCount > 0) {
    process.stdout.write("--- 警告 ---\n");
    for (const w of result.warnings) process.stdout.write(`警告\t${w}\n`);
  }

  // 9) 口径提示：避免把闸门结果误读为「资料完整」或「可对外公开」。
  process.stdout.write(
    "说明: 可发布记录仅表示通过导入闸门，不等于资料完整，也不等于允许公开展示。\n",
  );

  // 10) 退出码：有 error 即 1；--require-publishable 下存在闸门拦截则 3。
  if (errCount > 0) process.exit(1);
  if (requirePublishable && result.blockedRows > 0) process.exit(3);
  process.exit(0);
}

main();
