# 老友中考志愿 · 新版本地验证报告

日期：2026-07-12
环境：WorkBuddy（Windows Server，Node 22.22.2，Cloudflare workerd 本地运行时）

## 源码来源
- 唯一正确包：`WORKBUDDY_FINAL_UI_PACKAGE.zip`（用户于 Desktop 提供，已复制到 `C:\caddy\finalapp`）。
- 架构：Next.js 16 (vinext) + Cloudflare Worker (`worker/index.ts`) + D1，本地用 vite + @cloudflare/vite-plugin + Miniflare 运行。

## 严格按顺序执行
1. ✅ `npm install` 完成。
2. ✅ `npm run dev` 启动本地 Cloudflare 运行时（端口 5173）。
   - 踩坑修复：Windows 缺 Visual C++ 2015–2022 Redistributable，导致 `workerd` 起不来、`vite` 报 `write EOF`。已下载并静默安装（x64+x86），`workerd 2026-05-15` 恢复正常。
3. ✅ 端点验证 **8/8 全过**（脚本 `verify-endpoints.sh`，以 `Host: terminal.local` 绕过 vite host 检查）：
   - 首页含「输入分数，找到更适合的高中」
   - `GET /checkout?plan=match_29_9` → 200
   - `GET /dashboard` → 200
   - `POST /api/orders` → 201 且 `paymentReady:false`
   - `POST /api/collect` → 204
   - `GET /api/metrics`（带 Bearer `test-read-token`）→ 200
   - `GET /api/metrics`（无 token）→ 401
   - 验证用 `.dev.vars` 仅设 `COLLECT_READ_TOKEN`，未设 `COLLECT_WRITE_TOKEN`，故 collect 走开放模式返回 204、metrics 区分 401/200 成立。

## 发现并修复的关键 bug（即用户严令禁止的"旧页面"风险）
- 旧版静态残留（`index.html`/`dashboard.html`/`detail.html`/`css/`/`js/`/`server/`/`deploy-manifest.json`/`ROUTES.md`）与新版 `app/`+`worker/` 并存于根目录。
- vite 在 dev 下把根目录旧 `index.html` 当成 `/` 的 SPA 入口，导致首页显示旧"示例测算"版（h1="先看清孩子的位置…"），新版 `app/page.tsx` 被盖掉。
- 处置：将上述旧文件整体迁入 `C:\caddy\finalapp\_old_version_backup\`（可逆）。`/` 现已正确落到新版首页。
- 已确认 `build/sites-vite-plugin.ts` 仅拷贝 `.openai/hosting.json` 与 `drizzle/`，不碰根 html，故生产构建也不会被污染。

## 构建验证（发布就绪）
- `npx vinext build` 成功；`/`、`/checkout`、`/dashboard` 均构建。
- `dist/` 无旧 `index.html`、无旧文案，仅含新版 `client/`、`server/` 与 `.openai/`。

## 当前状态与边界
- 本地 dev 仍在 5173 运行（仅供验证/检视，**非线上发布**）。
- 线上 `laoyou.love` 仍由另一 node 进程服务**旧 dia 版本**，未改动；按用户要求，待备用地址验证通过后再切换。
- **发布到备用地址 + 重绑 laoyou.love 无法在本 WorkBuddy 环境完成**：`CF_API_TOKEN`/`CLOUDFLARE_API_TOKEN` 均为空，`vinext deploy` 无法直连 Cloudflare；laoyou.love 绑定走 Sites 的 DNS TXT 验证（用户要求以 Sites 最新 TXT 为准）。这两项必须在 Cloudflare Sites / Codex 平台侧执行。

## 下一步
- 由用户提供 Cloudflare 凭证（或由 Codex/Sites 侧触发发布）→ 得到备用地址 → 在其上复核上述端点 → 确认无误后用 Sites 最新 TXT 重绑 laoyou.love。
- 全程未把本地 Miniflare 验证结果冒充为线上已发布。
