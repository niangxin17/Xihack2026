/**
 * laoyou-server.mjs — laoyou.love 后端 API
 * 仅监听内网 127.0.0.1:8787，由 Caddy 反向代理 /api/* 转发到此。
 *
 * 提供接口：
 *   GET  /health                       健康检查（Caddy /health 也已转发）
 *   GET  /api/wechat/js-config?url=    微信 JS-SDK 签名（需服务端环境变量）
 *   GET  /api/referrals/count?ref=      查询某邀请人当前有效助力数 + 到手价
 *   POST /api/referrals/convert         好友完成查分后的有效转化（服务端计数）
 *
 * 安全约定：
 *   - WECHAT_APP_ID / WECHAT_APP_SECRET 仅来自服务端环境变量，绝不出现在前端。
 *   - 签名仅对配置的 HTTPS 域名（laoyou.love）生成，拒绝其它域名。
 *   - 订单价格由服务端根据有效邀请人数计算，前端只可信展示、不可自报价格。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createOrder,
  getOrder,
  markOrderPaid,
  verifyWechatNotify,
  verifyAlipay,
  paymentConfigStatus,
  wxOauthAuthorizeUrl,
  wxOauthExchange,
  getAlipayConfig,
  listOrders,
  PLAN_NAMES,
  queryWechatOrder,
  queryAlipayOrder,
} from "./payments.mjs";

const PORT = process.env.PORT || 8787;
const HOST = "127.0.0.1";

// 持久化数据目录（放在 www 之外，避免被静态托管泄露）
const DATA_DIR = process.env.LAOYOU_DATA_DIR || "C:/caddy/data";
const REFERRAL_FILE = path.join(DATA_DIR, "laoyou-referrals.json");
const WECHAT_CACHE_FILE = path.join(DATA_DIR, "laoyou-wechat-cache.json");

// 允许生成微信签名的域名白名单（仅 HTTPS）
const ALLOWED_SHARE_HOSTS = (process.env.WECHAT_ALLOWED_HOSTS || "laoyou.love")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ORIGINAL_PRICE = 599;

// ---------- 价格规则（服务端唯一权威） ----------
function priceForCount(c) {
  const n = Math.max(0, Math.floor(Number(c) || 0));
  let price;
  if (n <= 2) price = 19.9;
  else if (n <= 9) price = 9.9;
  else price = 0;
  const discount = +(ORIGINAL_PRICE - price).toFixed(1);
  return { price, discount, count: n };
}

// ---------- 文件持久化 ----------
function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return fallback;
  }
}
function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

// 推荐关系存储：{ [ref]: { friends: { [friendSessionId]: true }, count } }
let referrals = readJson(REFERRAL_FILE, {});

function persistReferrals() {
  writeJson(REFERRAL_FILE, referrals);
}

// ---------- 微信 JS-SDK 签名 ----------
function readWechatCache() {
  return readJson(WECHAT_CACHE_FILE, { token: null, ticket: null, tokenExp: 0, ticketExp: 0 });
}
function writeWechatCache(c) {
  writeJson(WECHAT_CACHE_FILE, c);
}

async function getAccessToken() {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) throw new Error("WECHAT_APP_ID / WECHAT_APP_SECRET 未配置");
  const cache = readWechatCache();
  const now = Date.now();
  if (cache.token && cache.tokenExp > now + 60_000) return cache.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error("获取 access_token 失败: " + data.errmsg);
  cache.token = data.access_token;
  cache.tokenExp = now + (data.expires_in || 7200) * 1000;
  writeWechatCache(cache);
  return cache.token;
}

async function getJsapiTicket(token) {
  const cache = readWechatCache();
  const now = Date.now();
  if (cache.ticket && cache.ticketExp > now + 60_000) return cache.ticket;
  const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error("获取 jsapi_ticket 失败: " + data.errmsg);
  cache.ticket = data.ticket;
  cache.ticketExp = now + (data.expires_in || 7200) * 1000;
  writeWechatCache(cache);
  return cache.ticket;
}

function signJsConfig(ticket, url) {
  const nonceStr = crypto.randomBytes(8).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const signature = crypto.createHash("sha1").update(raw).digest("hex");
  return { appId: process.env.WECHAT_APP_ID, timestamp, nonceStr, signature };
}

// ---------- 工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function wechatSignatureCheck(token, signature, timestamp, nonce) {
  const str = [token, timestamp, nonce].sort().join("");
  const hash = crypto.createHash("sha1").update(str).digest("hex");
  return hash === signature;
}
function parseWechatXml(xml) {
  const obj = {};
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    obj[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return obj;
}
function buildWechatTextReply(toUser, fromUser, content) {
  return `<xml>\n  <ToUserName><![CDATA[${toUser}]]></ToUserName>\n  <FromUserName><![CDATA[${fromUser}]]></FromUserName>\n  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>\n  <MsgType><![CDATA[text]]></MsgType>\n  <Content><![CDATA[${content}]]></Content>\n</xml>`;
}

// ---------- 路由 ----------
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  // 健康检查
  if (p === "/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, ts: Date.now() });
  }

  // 微信服务号消息 / 事件推送（被动回复）
  if (p === "/api/wechat/message") {
    const signature = url.searchParams.get("signature") || "";
    const timestamp = url.searchParams.get("timestamp") || "";
    const nonce = url.searchParams.get("nonce") || "";
    const token = process.env.WECHAT_MESSAGE_TOKEN || "";
    const checkOk = token && signature && timestamp && nonce && wechatSignatureCheck(token, signature, timestamp, nonce);
    if (!checkOk) {
      return res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("signature invalid");
    }
    if (req.method === "GET") {
      const echostr = url.searchParams.get("echostr") || "";
      return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(echostr);
    }
    if (req.method === "POST") {
      const raw = await readRaw(req);
      const msg = parseWechatXml(raw);
      const replyText = "西安中考成绩官方查询入口：https://222.91.162.190:7070/\n也可在 laoyou.love 首页底部点击「中考查分」按钮。";
      const shouldReply =
        msg.Event === "subscribe" ||
        (msg.MsgType === "text" && /(中考|查分)/i.test(msg.Content || ""));
      if (shouldReply) {
        const xml = buildWechatTextReply(msg.FromUserName, msg.ToUserName, replyText);
        return res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" }).end(xml);
      }
      return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("success");
    }
    return res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" }).end("method not allowed");
  }

  // 微信 JS-SDK 签名
  if (p === "/api/wechat/js-config" && req.method === "GET") {
    const pageUrl = url.searchParams.get("url") || "";
    // 入参校验（客户端错误 → 明确 400，绝不返回签名）
    try {
      const u = new URL(pageUrl);
      if (u.protocol !== "https:") {
        return sendJson(res, 400, { ok: false, error: "签名 URL 必须为 HTTPS" });
      }
      if (!ALLOWED_SHARE_HOSTS.includes(u.hostname)) {
        return sendJson(res, 400, { ok: false, error: "域名不在白名单，拒绝生成签名: " + u.hostname });
      }
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "签名 URL 非法" });
    }
    try {
      const token = await getAccessToken();
      const ticket = await getJsapiTicket(token);
      // 签名用 URL 必须去掉 #hash
      const signUrl = pageUrl.split("#")[0];
      const cfg = signJsConfig(ticket, signUrl);
      return sendJson(res, 200, cfg);
    } catch (e) {
      // 内部错误（token/ticket 获取失败）→ 明确 500，不返回假 signature
      return sendJson(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  // 查询邀请人当前有效助力数 + 到手价
  if (p === "/api/referrals/count" && req.method === "GET") {
    const ref = url.searchParams.get("ref") || "";
    const rec = referrals[ref];
    const count = rec ? rec.count : 0;
    const info = priceForCount(count);
    return sendJson(res, 200, { ref, friendCount: count, price: info.price, discount: info.discount });
  }

  // 好友完成查分后的有效转化
  if (p === "/api/referrals/convert" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "请求体非法" });
    }
    const ref = String(body.ref || "").trim();
    const friendSessionId = String(body.friendSessionId || "").trim();
    const score = Number(body.score);
    const district = String(body.district || "").trim();

    if (!ref || !friendSessionId) {
      return sendJson(res, 400, { ok: false, error: "缺少 ref 或 friendSessionId" });
    }

    if (!referrals[ref]) referrals[ref] = { friends: {}, count: 0 };
    const rec = referrals[ref];

    // 同一好友会话对同一邀请人只计数一次
    if (rec.friends[friendSessionId]) {
      const info = priceForCount(rec.count);
      return sendJson(res, 200, { valid: false, alreadyCounted: true, friendCount: rec.count, price: info.price, discount: info.discount });
    }

    rec.friends[friendSessionId] = true;
    rec.count = Object.keys(rec.friends).length;
    persistReferrals();

    const info = priceForCount(rec.count);
    return sendJson(res, 200, { valid: true, friendCount: rec.count, price: info.price, discount: info.discount });
  }

  // ---------- 支付：创建订单 ----------
  if (p === "/api/orders" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "请求体非法" });
    }
    try {
      const { planId, channel, shareFriends, sessionId, openid, mobile } = body;
      if (!planId || (channel !== "wechat" && channel !== "alipay")) {
        return sendJson(res, 400, { ok: false, error: "缺少 planId 或 channel 非法" });
      }
      const result = await createOrder({ planId, channel, shareFriends, sessionId, openid, mobile });
      return sendJson(res, 200, result);
    } catch (e) {
      const msg = String(e.message || e);
      const status = msg.includes("未知套餐") || msg.includes("channel") ? 400 : 500;
      return sendJson(res, status, { ok: false, error: msg });
    }
  }

  // 查询订单状态
  if (p.startsWith("/api/orders/") && req.method === "GET") {
    const id = p.slice("/api/orders/".length);
    const o = getOrder(id);
    if (!o) return sendJson(res, 404, { ok: false, error: "订单不存在" });
    return sendJson(res, 200, { orderId: o.orderId, status: o.status, planId: o.planId, channel: o.channel, amount: o.amountYuan, paidAt: o.paidAt });
  }

  // 主动查单（用户点“我已支付，刷新状态”时触发）
  if (p.startsWith("/api/orders/") && p.endsWith("/query") && req.method === "POST") {
    const id = p.slice("/api/orders/".length, -"/query".length);
    const o = getOrder(id);
    if (!o) return sendJson(res, 404, { ok: false, error: "订单不存在" });
    if (o.status === "paid") {
      return sendJson(res, 200, { ok: true, orderId: o.orderId, status: "paid", paidAt: o.paidAt, transactionId: o.transactionId, source: "local" });
    }
    try {
      const result = o.channel === "alipay" ? await queryAlipayOrder(id) : await queryWechatOrder(id);
      if (result.paid) {
        markOrderPaid(id, result.transactionId, result.raw);
        return sendJson(res, 200, { ok: true, orderId: id, status: "paid", transactionId: result.transactionId, source: result.channel });
      }
      return sendJson(res, 200, { ok: true, orderId: id, status: o.status, source: result.channel, detail: result.tradeState || result.tradeStatus || "未支付" });
    } catch (e) {
      console.error("[query order]", id, o.channel, e.message);
      return sendJson(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  // 支付通道配置状态
  if (p === "/api/pay/config" && req.method === "GET") {
    return sendJson(res, 200, paymentConfigStatus());
  }

  // 微信 openid OAuth：发起授权
  if (p === "/api/wechat/oauth/start" && req.method === "GET") {
    const back = url.searchParams.get("redirect") || "/checkout";
    return res.writeHead(302, { Location: wxOauthAuthorizeUrl(back) }).end();
  }
  // 微信 openid OAuth：回调，写 cookie 后跳回
  if (p === "/api/wechat/oauth/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const back = url.searchParams.get("back") || "/checkout";
    if (!code) return res.writeHead(302, { Location: back }).end();
    try {
      const openid = await wxOauthExchange(code);
      return res
        .writeHead(302, {
          "Set-Cookie": `ly_wx_openid=${openid}; Path=/; Max-Age=2592000; SameSite=Lax`,
          Location: back,
        })
        .end();
    } catch (e) {
      return res.writeHead(302, { Location: back + (back.includes("?") ? "&" : "?") + "openid_error=1" }).end();
    }
  }

  // 微信支付回调（验签 + 解密 + 标记已支付）
  if (p === "/api/pay/wechat/notify" && req.method === "POST") {
    const raw = await readRaw(req);
    try {
      const tx = await verifyWechatNotify(raw, req.headers);
      if (tx.trade_state === "SUCCESS" && tx.out_trade_no) {
        markOrderPaid(tx.out_trade_no, tx.transaction_id, tx);
      }
      return sendJson(res, 200, { code: "SUCCESS", message: "成功" });
    } catch (e) {
      console.error("[wechat notify]", e.message);
      return sendJson(res, 500, { code: "FAIL", message: String(e.message || e) });
    }
  }

  // 支付宝回调（验签 + 标记已支付）
  if (p === "/api/pay/alipay/notify" && req.method === "POST") {
    const raw = await readRaw(req);
    const params = Object.fromEntries(new URLSearchParams(raw));
    const cfg = getAlipayConfig();
    try {
      if (!verifyAlipay(params, cfg.publicKeys)) {
        return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("failure");
      }
      if ((params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED") && params.out_trade_no) {
        markOrderPaid(params.out_trade_no, params.trade_no, params);
      }
      return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("success");
    } catch (e) {
      console.error("[alipay notify]", e.message);
      return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("failure");
    }
  }

  // 后台：拉取订单反馈数据（受 ADMIN_TOKEN 保护）
  if (p === "/api/admin/orders" && req.method === "GET") {
    const token = url.searchParams.get("token") || req.headers["x-admin-token"] || "";
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) {
      return sendJson(res, 401, { ok: false, error: "未授权" });
    }
    const status = url.searchParams.get("status") || undefined;
    const orders = listOrders({ status });
    return sendJson(res, 200, {
      ok: true,
      count: orders.length,
      orders: orders.map((o) => ({
        orderId: o.orderId,
        planId: o.planId,
        planName: PLAN_NAMES[o.planId] || o.planId,
        channel: o.channel,
        amount: o.amountYuan,
        status: o.status,
        paidAt: o.paidAt,
        transactionId: o.transactionId,
        shareFriends: o.shareFriends || 0,
      })),
    });
  }

  // 兜底
  return sendJson(res, 404, { ok: false, error: "not found" });
}

const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`[laoyou-server] listening on http://${HOST}:${PORT}`);
  console.log(`[laoyou-server] wechat creds: ${process.env.WECHAT_APP_ID ? "configured" : "NOT configured (js-config will 500)"}`);
});

export { server };
