// 后台服务测试：双 token 开放/强制模式 + 10MB 滚动备份
// 使用动态 import + 查询串破坏 ESM 缓存，以便在不同环境变量下分别加载模块。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('PASS - ' + label); }
  else { fail++; console.log('FAIL - ' + label); }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = pathToFileURL(path.join(here, '../server/analytics-server.mjs')).href;
function importServer(query) {
  return import(BASE + (query || ''));
}
function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ly-ana-'));
}

async function startServer(mod) {
  const srv = mod.createServer();
  await new Promise((r) => srv.listen(0, r));
  return srv;
}
function portOf(srv) { return srv.address().port; }

async function postCollect(port, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(`http://localhost:${port}/collect`, { method: 'POST', headers, body: JSON.stringify(body || { ts: 1, sid: 'a', event: 'page_view' }) });
}
async function getMetrics(port, token) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(`http://localhost:${port}/api/metrics`, { headers });
}

// ===== 第一组：开放模式 + 强制鉴权（正常阈值）=====
{
  const tmp = mkTmp();
  process.env.ANALYTICS_DATA_DIR = tmp;
  delete process.env.COLLECT_WRITE_TOKEN;
  delete process.env.COLLECT_READ_TOKEN;
  const mod = await importServer('?grp=auth');
  const srv = await startServer(mod);
  const port = portOf(srv);

  // 开放模式：无 token 也应放行
  let r = await postCollect(port);
  check('开放模式 POST /collect 无 token → 204', r.status === 204);
  r = await getMetrics(port);
  check('开放模式 GET /api/metrics 无 token → 200', r.status === 200);

  // 强制写入 token
  process.env.COLLECT_WRITE_TOKEN = 'wsecret';
  r = await postCollect(port); // 无 token
  check('强制写入令牌：无 token → 401', r.status === 401);
  r = await postCollect(port, 'wrong');
  check('强制写入令牌：错误 token → 401', r.status === 401);
  r = await postCollect(port, 'wsecret');
  check('强制写入令牌：正确 token → 204', r.status === 204);

  // 强制读取 token
  process.env.COLLECT_READ_TOKEN = 'rsecret';
  r = await getMetrics(port); // 无 token
  check('强制读取令牌：无 token → 401', r.status === 401);
  r = await getMetrics(port, 'wrong');
  check('强制读取令牌：错误 token → 401', r.status === 401);
  r = await getMetrics(port, 'rsecret');
  check('强制读取令牌：正确 token → 200', r.status === 200);

  // 指标含刚刚写入的正确事件
  const m = await (await getMetrics(port, 'rsecret')).json();
  check('指标累计事件数 ≥ 1', m.total >= 1);
  check('漏斗含 4 个步骤', m.stepConversion.length === 4);

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.COLLECT_WRITE_TOKEN;
  delete process.env.COLLECT_READ_TOKEN;
}

// ===== 第二组：10MB 滚动备份（极小阈值触发）=====
{
  const tmp = mkTmp();
  process.env.ANALYTICS_DATA_DIR = tmp;
  process.env.EVENTS_MAX_BYTES = '40';   // 单条事件约 80B，必然触发滚动
  process.env.EVENTS_MAX_BACKUPS = '3';
  const mod = await importServer('?grp=rotate');
  const srv = await startServer(mod);
  const port = portOf(srv);

  // 写入 6 条事件，应触发多次滚动，且仅保留最新 3 份备份
  for (let i = 0; i < 6; i++) {
    await postCollect(port, null, { ts: Date.now() + i, sid: 's' + i, event: 'page_view', payload: { n: i } });
  }
  const files = fs.readdirSync(tmp).filter((f) => /^events-.*\.jsonl$/.test(f));
  check('滚动备份生成了归档文件', files.length >= 1);
  check('备份份数不超过 EVENTS_MAX_BACKUPS(3)', files.length <= 3);
  check('当前 events.jsonl 仍存在', fs.existsSync(path.join(tmp, 'events.jsonl')));

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.EVENTS_MAX_BYTES;
  delete process.env.EVENTS_MAX_BACKUPS;
}

console.log(`\nserver test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
