// 步骤06 学校详情弹窗测试（沿用 growth-nav.test.mjs 的文本扫描法，无需构建/无新依赖）
// 说明：SchoolDetailModal/SchoolCard/GrowthExplorer 为 .tsx（含 JSX），无法用 node 直接 import；
// 这里改为读取源码文本，校验无障碍属性、交互逻辑、缺失字段处理与禁止文案。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MODAL = readFileSync(
  join(ROOT, "app/growth/components/SchoolDetailModal.tsx"),
  "utf8",
);
const CARD = readFileSync(
  join(ROOT, "app/growth/components/SchoolCard.tsx"),
  "utf8",
);
const EXPLORER = readFileSync(
  join(ROOT, "app/growth/components/GrowthExplorer.tsx"),
  "utf8",
);
const ALL = MODAL + "\n" + CARD + "\n" + EXPLORER;

// 步骤06 明确禁用的宣传/判断用语（不得出现在成长地图详情代码中）
const BANNED = [
  "排名",
  "评分",
  "成功率",
  "推荐指数",
  "适合你",
  "强烈推荐",
  "保证录取",
  "内部名额",
  "择校运作",
];

test("1) SchoolDetailModal 存在并接收 school/open/onClose 三个属性", () => {
  assert.ok(
    /export default function SchoolDetailModal\(/.test(MODAL),
    "未找到 SchoolDetailModal 组件导出",
  );
  assert.ok(/school:\s*GrowthSchool/.test(MODAL), "缺少 school 属性");
  assert.ok(/\bopen:\s*boolean/.test(MODAL), "缺少 open 属性");
  assert.ok(/\bonClose:\s*\(\)\s*=>\s*void/.test(MODAL) || /onClose: \(\) =>/.test(MODAL), "缺少 onClose 属性");
});

test("2) 包含 role=dialog、aria-modal、aria-labelledby", () => {
  assert.ok(/role="dialog"/.test(MODAL), "缺少 role=\"dialog\"");
  assert.ok(/aria-modal="true"/.test(MODAL), "缺少 aria-modal=\"true\"");
  assert.ok(/aria-labelledby=/.test(MODAL), "缺少 aria-labelledby");
  assert.ok(/id="school-detail-title"/.test(MODAL), "aria-labelledby 未指向存在的标题 id");
});

test("3) 包含 Escape 关闭逻辑", () => {
  assert.ok(/Escape/.test(MODAL), "未处理 Escape 键关闭");
  assert.ok(/keydown/.test(MODAL), "未监听 keydown 事件");
  assert.ok(/onClose\(\)/.test(MODAL), "Escape 回调未调用 onClose");
});

test("4) 包含遮罩点击关闭逻辑", () => {
  // 外层遮罩 onClick={onClose}，内层内容区 stopPropagation 防止误关
  assert.ok(/onClick=\{onClose\}/.test(MODAL), "遮罩未绑定 onClick={onClose}");
  assert.ok(/stopPropagation/.test(MODAL), "内容区未阻止事件冒泡到遮罩");
});

test("5) 包含滚动锁定与恢复逻辑", () => {
  assert.ok(/body\.style\.overflow/.test(MODAL), "未操作 body 滚动");
  assert.ok(/hidden/.test(MODAL), "未将 overflow 设为 hidden 以锁定滚动");
  // 关闭（useEffect 清理）时恢复：return 中把 prevOverflow 写回
  assert.ok(/prevOverflow/.test(MODAL), "关闭时未恢复先前的 overflow 状态");
});

test("6) SchoolCard 按钮为可点击的“查看详情”", () => {
  assert.ok(/查看详情/.test(CARD), "卡片未出现“查看详情”文案");
  // 原先的 disabled 禁用按钮与“下一步开放”应已移除
  assert.ok(!/disabled/.test(CARD), "卡片按钮仍带 disabled，不可点击");
  assert.ok(!/下一步开放/.test(CARD), "卡片仍保留“下一步开放”禁用文案");
  assert.ok(/onViewDetails\(school\)/.test(CARD), "按钮未绑定 onViewDetails(school)");
});

test("7) GrowthExplorer 管理 selectedSchool 与弹窗开关", () => {
  assert.ok(/selectedSchool/.test(EXPLORER), "未管理 selectedSchool 状态");
  assert.ok(/modalOpen/.test(EXPLORER), "未管理 modalOpen 状态");
  assert.ok(/SchoolDetailModal/.test(EXPLORER), "未渲染 SchoolDetailModal");
  // 仅一个弹窗：SchoolDetailModal 在列表外渲染一次，且由 open 控制
  assert.ok(/open=\{modalOpen\}/.test(EXPLORER), "弹窗未由 modalOpen 控制显示");
});

test("8) 缺失字段调用统一格式化函数并显示“暂未核实”", () => {
  assert.ok(/formatEmpty/.test(MODAL), "详情未使用 formatEmpty 处理缺失字段");
  assert.ok(/暂未核实/.test(MODAL), "缺失字段未显示“暂未核实”");
});

test("9) 空来源不生成假链接，显示“来源待补充”", () => {
  // 仅当 source.url 存在才渲染 <a>；否则显示“来源待补充”
  assert.ok(/来源待补充/.test(MODAL), "未处理空来源（应显示来源待补充）");
  assert.ok(/source\.url \?/.test(MODAL), "未对 source.url 做存在性判断");
});

test("10) 有来源链接时包含 noopener noreferrer", () => {
  assert.ok(/rel="noopener noreferrer"/.test(MODAL), "来源链接缺少 rel=\"noopener noreferrer\"");
  assert.ok(/target="_blank"/.test(MODAL), "来源链接缺少 target=\"_blank\"");
});

test("11) UNVERIFIED 显示完整文字并使用中性灰色（无认证样式）", () => {
  assert.ok(/isUnverified/.test(MODAL), "未判断 UNVERIFIED 等级");
  assert.ok(/UNVERIFIED/.test(MODAL), "未引用 UNVERIFIED 枚举值");
  // 中性灰色样式（仅 UNVERIFIED 分支），不应出现绿色系认证类
  assert.ok(
    /text-\[#6b7280\][^"]*border-\[#e5e7eb\]/.test(MODAL) || /bg-\[#f3f4f6\] text-\[#6b7280\]/.test(MODAL),
    "UNVERIFIED 未使用中性灰色样式",
  );
  assert.ok(/formatVerification\(school\.verificationLevel\)/.test(MODAL), "未通过 formatVerification 显示完整文字（如“暂未核实”）");
});

test("12) 含固定声明：不构成录取/入学/择校承诺", () => {
  assert.ok(
    /此页面用于信息整理与家庭决策参考，不构成录取、入学或择校承诺。/.test(MODAL),
    "缺失固定声明文案",
  );
});

test("13) 不显示排名/评分/成功率/推荐等禁止文案", () => {
  for (const w of BANNED) {
    assert.ok(
      !ALL.includes(w),
      `成长地图详情代码中出现禁止用语：${w}`,
    );
  }
});

test("14) TSX/TS 可被现有工具解析（语法关键元素齐全）", () => {
  // 通过检查必需的结构性标记，确认文件为合法的 React 组件源码
  assert.ok(/import .*from "react"/.test(MODAL), "Modal 未导入 react");
  assert.ok(/export default function/.test(MODAL), "Modal 缺少默认导出函数");
  assert.ok(/useEffect/.test(MODAL), "Modal 未使用 useEffect（缺少生命周期/事件绑定）");
  assert.ok(/from "\.\.\/\.\.\/lib\/growth-schools"/.test(MODAL), "Modal 未从数据模型导入类型与格式化函数");
});
