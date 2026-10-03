# WorkBuddy 执行交接：老友升学 · 四档升学报告（真实数据版）

## 项目与部署

- 生产站：`https://laoyou.love`（Caddy 静态托管 `C:\caddy\www\laoyou`，HTTPS 80/443）
- 源码：`C:\Users/Administrator\Documents\中考网站架构\finalapp`（Vinext / Next.js 16 + React 19 + Vite 8 + TS 5.9 + Tailwind 4）
- 构建：`npm run build` → `dist/client` → `robocopy /MIR /XD data` 到 `C:\caddy\www\laoyou`
- 运行时 Node：`C:\Users/Administrator\.workbuddy\binaries\node\versions\22.22.2`
- 支付后端：独立 Node 进程监听 127.0.0.1:8787（凭证固化于 `C:\caddy\start-node.bat`，非仓库内；微信/支付宝已真实配置并收款）

## 本次目标：四档报告一比一复刻（真实数据，非静态拷贝）

四档对应家长四个问题，结论由真实用户数据驱动，展示数值受真实性闸门约束：

| 档位 | 家长问题 | 报告交付 |
|---|---|---|
| 免费 | 我能报哪些学校？ | 完整候选池、基础定位、定向生范围、核验清单 |
| 29.9 元 | 志愿怎么排？ | 真实冲稳保、具体顺序、分数变化预案、定向生名额（待官方发布） |
| 199 元 | 学校适合孩子吗？ | 适配结论、高压/舒适区/通勤/985·211口径/班型、志愿建议 |
| 599 元 | 我的方案会不会出错？ | 老师复核、编号风险、修改前后 diff、最终方案、提交前清单 |

## 关键源码（报告特性）

- 视觉：`app/components/report/report.css`（复制自 `handoff/reports/report.css` 并追加生产样式）+ `ReportShell.tsx`（**必须 import report.css**）。
- 真实性闸门：`app/lib/reports/{types,verification,competition,analysis}.ts` —— 所有「数字能否作为确定结论」集中此处判定，UI 不硬编码显示逻辑。
- 报告组件：`app/components/report/{FreeReport,SortReport,FitReport,ReviewReport}.tsx` + 共享 `report-parts.tsx`。
- 渲染/路由：`app/components/report/ReportsRenderer.tsx`（权益判定 + 数据接线）、`app/reports/{free,sort,fit,review}/page.tsx`、`app/downloads/page.tsx`。
- 数据：`app/lib/volunteer-data.ts`（45 校库）、`app/lib/profile-lock.ts`（`ly_profile_locked`）、`app/lib/entitlements.ts`（权益状态机）。
- 测试：`tests/reports-truth-gates.test.ts`（10 项闸门单测，Node 22 原生 `--experimental-strip-types --test`）。
- 文档：`docs/superpowers/plans/production-file-map.md`（完整文件映射与验收清单）。

## WorkBuddy 必做

1. 仅从 `finalapp` 构建与部署，不要回退到旧 `publish2` / 根目录旧 HTML。
2. 运行 `node --experimental-strip-types --test tests/reports-truth-gates.test.ts`，10 项必须全过。
3. 构建失败先修复，不发布失败版本。
4. 部署后验证：`/`、`/downloads`、`/reports/free|sort|fit|review`、`/checkout?plan=match_29_9` 均 200 且报告有样式、无控制台报错。
5. 报告结论由真实数据计算；985/211、定向生名额、班型等缺官方口径者必须显示「待核验/待官方发布/无法判断」，不得展示推算数字或承诺性话术。

## 真实性硬规则（违反即缺陷）

- 定向生名额无「官方分学校生源计划」→ 显示「待2026官方分学校计划」，绝不把全区计划写成某初中名额。
- 竞争度缺「资格人数/本校名额/校内位次」任一 → 「无法判断」，不生成伪精确百分比。
- 985/211 缺届次/分母/来源 → 「待统一口径数据」。
- 班型仅采信学校官方招生说明，否则「学校未公开，无法判断」。
- 禁止「稳进、保证录取、专属名额、100%上岸」等承诺。
- 真实数据与演示数据不得混用；演示身份须标注「示例」。

## 当前已知边界

- 校库 45 所字段齐全，但 `g985/g211`、`dingxiang` 缺官方届次/分母/来源，故报告中按规则锁定为「待核验」，不显示为确定结论；排序/适配/复核等结论逻辑使用真实数据。
- 支付已生产态真实配置并收款（非仓库内、非空壳）。
- 报告为纯前端 + localStorage（`ly_profile_locked` / `ly_paid_plans`），权益以后端 `/api` 校验为准。

## 交付验收

- 四档报告均成功构建为静态页并部署，线上可访问且加载报告样式（无未样式化/崩溃）。
- 视觉与 `handoff/reports/report.css` 参考成品一比一一致；桌面 1440×1024 与移动 390×844 均无溢出/破版。
- 四档报告均可打印为结构完整的 PDF（封面定位→核心结论→分析依据→最终方案→收尾行动）。
- 不把测试数据、冒烟数据或支付测试结果展示为真实生产数据；未拿到支付回调验签前不声称已完成真实收款。
