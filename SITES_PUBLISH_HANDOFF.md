# Sites / Codex 发布交接文档 — laoyou.love 新版

> 本文档供 **Codex / Sites 发布管道** 使用。WorkBuddy 侧已停止 `vinext deploy`（无 Cloudflare API 凭证），
> 仅保留本地验证能力。以下流程必须回到 Sites/Codex 平台侧执行。

## 一、WorkBuddy 侧已完成（本地，2026-07-12）

- 定位并确认正确源码包 `WORKBUDDY_FINAL_UI_PACKAGE.zip`（Next.js 16 + Cloudflare Worker + D1）。
- **清理项目根目录**：旧版静态残留（`index.html`、`dashboard.html`、`detail.html`、`css/`、`js/`、`server/`、`deploy-manifest.json`、`ROUTES.md`）已整体移出项目根，归档至
  `C:\caddy\_archive_old_version\_old_version_backup`（项目外，不随发布走）。
- `.gitignore` 已补充忽略 `.dev.vars`、`*.log`，确保本地测试 token 与日志不会进入发布源码。
- **本地 8/8 端点验证通过**（脚本 `verify-endpoints.sh`，基于本地 Miniflare 运行时）：
  - 首页含「输入分数，找到更适合的高中」
  - `GET /checkout?plan=match_29_9` → 200
  - `GET /dashboard` → 200
  - `POST /api/orders` → 201 且 `paymentReady:false`
  - `POST /api/collect` → 204
  - `GET /api/metrics`（带 token）→ 200
  - `GET /api/metrics`（无 token）→ 401
- `vinext build` 成功；`dist/` 产物干净，**无旧示例页面污染**。
- 修复的关键 bug：根目录旧 `index.html` 曾把新版首页 `app/page.tsx` 劫持（vite 开发态把旧 `index.html` 当 `/` 入口）。已隔离旧文件，新首页生效。

## 二、发布流程（Sites/Codex 侧，5 步）

### 1. 保存新 Sites 版本
- 源码根目录：`C:\caddy\finalapp`（已清理）。
- **不要**包含：`_old_version_backup/`（已移出）、`.dev.vars`、`*.log`、`dist/`（构建产物由 Sites 生成）。
- 入口：Cloudflare Worker = `worker/index.ts`（见 `vite.config.ts` 的 `main`）；前端 = `app/`（Next.js App Router）。

### 2. 部署到备用地址
- 在 Sites/Codex 触发发布，得到一个**备用地址**（如 `*.workers.dev` 或预览域名）。
- ⚠️ 此步**不是** laoyou.love，仅为备用/预览，用于线上验收。

### 3. 线上验证（WorkBuddy 用 `verify-online.sh` 复核）
发布到备用地址后，把备用 URL 交给 WorkBuddy，执行：
```bash
cd C:\caddy\finalapp
bash verify-online.sh https://<备用地址> [READ_TOKEN]
```
复核项（与本地 8 项一致）：
1. 首页含「输入分数，找到更适合的高中」
2. `GET /checkout?plan=match_29_9` → 200
3. `GET /dashboard` → 200
4. `POST /api/orders` → 201 且 `paymentReady:false`
5. `POST /api/collect` → 204
6. `GET /api/metrics`（无 token）→ 401
7. `GET /api/metrics`（带 token）→ 200（提供 token 时）

> 若 Sites 已配置 `COLLECT_READ_TOKEN`，把该值作为第 2 个参数传入即可做完整 200 校验。

### 4. 用 Sites 最新 TXT 记录重新绑定 `laoyou.love`
- 备用地址验收通过后，再在 Sites/Codex 用**最新生成的 DNS TXT 验证记录**绑定 `laoyou.love`。
- 以 Sites 平台返回的最新 TXT 为准（不要复用旧记录）。

### 5. 域名 active 后最终验收
- 确认 `laoyou.love` 解析/HTTPS 正常、TXT 验证 `active`。
- 对 `https://laoyou.love` 再跑一次 `verify-online.sh https://laoyou.love [READ_TOKEN]` 做最终验收。
- 验收期间：旧 `dia.zip` 版本站点仍作为回退保留，确认无误后再切换流量。

## 三、Sites 必须配置的环境变量（Secret）

| 变量 | 说明 | 验收要求 |
|------|------|----------|
| `COLLECT_READ_TOKEN` | `/api/metrics` 读取令牌 | **必须设置**，否则指标接口处于开放模式（无 token 直接 200），不符合 401 验收 |
| 微信支付商户密钥 | `WECHAT_*` | 保持**未配置** → `paymentReady=false`（验收要求，不模拟支付） |
| 支付宝商户密钥 | `ALIPAY_*` | 保持**未配置** → `paymentReady=false` |
| 其他 | 见 `.env.example` | 按需要 |

> `.dev.vars` 仅本地用（含 `COLLECT_READ_TOKEN=test-read-token`），已 gitignore，不会发布。生产值请在 Sites Secret 中设置。

## 四、验收红线（用户明确要求，不可越界）

- ❌ 不把本地 Miniflare 验证结果当作「线上已发布」。
- ❌ 不使用 `dia.zip`、旧 `index.html`、`publish`、`release` 或任何旧版发布文件。
- ❌ 测试事件 / 模拟支付结果**不视为**真实生产数据。
- ✅ 只有「备用地址线上验证通过」+「Sites TXT 绑定 active」后，才视为发布完成。
