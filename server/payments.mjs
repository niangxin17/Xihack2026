/**
 * payments.mjs — 微信支付 v3 + 支付宝 接入（Node 原生实现，参照 IJPay 的 API 契约）
 *
 * 设计：
 *   - 不依赖任何第三方 MVC / SDK，仅用 node:crypto + qrcode（Native 二维码）。
 *   - 价格权威在服务端（priceForPlan），前端只可信展示。
 *   - 凭证全部来自环境变量；未配置时进入“沙盒模式”，订单照常创建但 paymentReady=false。
 *   - 微信：支持 JSAPI（微信内，需 openid）与 Native（扫码）；回调用「微信支付公钥」验签（推荐，无有效期）+ APIv3 密钥 AES-GCM 解密；未配置公钥时回退平台证书验签。
 *   - 支付宝：支持 wap（手机）与 page（电脑）；回调用支付宝公钥验签。
 *
 * 环境变量：
 *   WECHAT_MCH_ID / WECHAT_MCH_SERIAL / WECHAT_API_V3_KEY / WECHAT_APP_ID
 *   WECHAT_MCH_PRIVATE_KEY          （PEM，\n 可写成 \\n）
 *   WECHAT_MCH_PRIVATE_KEY_FILE     （PEM 文件路径，二选一）
 *   WECHAT_PAY_PUBLIC_KEY           （微信支付公钥 PEM，\n 可写成 \\n）
 *   WECHAT_PAY_PUBLIC_KEY_FILE     （微信支付公钥文件路径，二选一，推荐）
 *   ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY / ALIPAY_PUBLIC_KEY
 *   ALIPAY_APP_PRIVATE_KEY_FILE / ALIPAY_PUBLIC_KEY_FILE  （二选一）
 *   ALIPAY_GATEWAY                  （默认 https://openapi.alipay.com/gateway.do）
 *   NOTIFY_BASE                     （默认 https://laoyou.love，回调/return 的基础地址）
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const DATA_DIR = process.env.LAOYOU_DATA_DIR || "C:/caddy/data";
const ORDERS_FILE = path.join(DATA_DIR, "laoyou-orders.json");
const WX_CERT_CACHE = path.join(DATA_DIR, "laoyou-wx-certs.json");
const NOTIFY_BASE = process.env.NOTIFY_BASE || "https://laoyou.love";

// ---------- 套餐价格（服务端唯一权威） ----------
// 方案第九/十六节：29.9（冲稳保分析）/ 199（AI 志愿规划）/ 599（老师复审）
export const PLAN_PRICES = {
  upgrade_99: 99,
  match_29_9: 29.9,
  planning_199: 199,
  review_599: 599,
};
export const PLAN_NAMES = {
  upgrade_99: "升学会员",
  match_29_9: "冲稳保分析",
  planning_199: "AI 志愿规划",
  review_599: "老师复审",
};

export function priceForPlan(planId, shareFriends = 0) {
  const base = PLAN_PRICES[planId];
  if (base == null) return null;
  let price = base;
  let discount = 0;
  if (planId === "match_29_9") {
    const n = Math.max(0, Math.floor(Number(shareFriends) || 0));
    if (n >= 10) {
      price = 0;
      discount = base;
    } else if (n >= 3) {
      price = 9.9;
      discount = +(base - 9.9).toFixed(2);
    }
  }
  return { base, price, discount, amountFen: Math.round(price * 100) };
}

// ---------- 订单持久化 ----------
function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
  } catch {
    return {};
  }
}
function writeOrders(o) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2), "utf-8");
  } catch (e) {
    console.error("[payments] writeOrders failed", e);
  }
}
function genOrderId() {
  return "LY" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString("hex").toUpperCase();
}
export function getOrder(id) {
  return readOrders()[id] || null;
}
export function markOrderPaid(orderId, transactionId, feedback) {
  const all = readOrders();
  const o = all[orderId];
  if (!o) return null;
  if (o.status === "paid") {
    // 已支付：仅补充首次回调原始数据，避免重复处理
    if (feedback && !o.feedback) {
      o.feedback = feedback;
      o.notifiedAt = o.notifiedAt || Date.now();
      writeOrders(all);
    }
    return o;
  }
  o.status = "paid";
  o.paidAt = Date.now();
  o.notifiedAt = Date.now();
  o.transactionId = transactionId || o.transactionId || "UNKNOWN";
  o.feedback = feedback || o.feedback || null;
  writeOrders(all);
  return o;
}

// 后台拉取订单（按支付时间倒序）；可按 status 过滤
export function listOrders({ status } = {}) {
  const all = readOrders();
  let arr = Object.values(all);
  if (status) arr = arr.filter((o) => o.status === status);
  arr.sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
  return arr;
}

// ---------- 凭证读取 ----------
function readEnvKey(envFile, envInline) {
  if (envFile) {
    try {
      return fs.readFileSync(envFile, "utf-8");
    } catch {
      return "";
    }
  }
  return (envInline || "").replace(/\\n/g, "\n");
}
function getWechatConfig() {
  const mchid = process.env.WECHAT_MCH_ID;
  const serial = process.env.WECHAT_MCH_SERIAL;
  const apiV3 = process.env.WECHAT_API_V3_KEY;
  const appId = process.env.WECHAT_APP_ID;
  const privateKey = ensurePrivateKeyPem(readEnvKey(process.env.WECHAT_MCH_PRIVATE_KEY_FILE, process.env.WECHAT_MCH_PRIVATE_KEY));
  const configured = !!(mchid && serial && apiV3 && appId && privateKey);
  return { configured, mchid, serial, apiV3, appId, privateKey };
}
// 收集所有支付宝平台公钥候选（支持密钥轮换：旧/新公钥都收进来逐枚验签）
function collectAlipayPublicKeys() {
  const keys = [];
  const add = (raw) => {
    if (!raw) return;
    const blocks = raw.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g);
    if (blocks) { for (const b of blocks) keys.push(b); return; }
    for (const piece of raw.split(/\s+/).filter(Boolean)) keys.push(ensurePublicKeyPem(piece));
  };
  add(process.env.ALIPAY_PUBLIC_KEY);
  if (process.env.ALIPAY_PUBLIC_KEY_FILE) { try { add(fs.readFileSync(process.env.ALIPAY_PUBLIC_KEY_FILE, "utf-8")); } catch {} }
  if (process.env.ALIPAY_PUBLIC_KEYS_FILE) { try { add(fs.readFileSync(process.env.ALIPAY_PUBLIC_KEYS_FILE, "utf-8")); } catch {} }
  return [...new Set(keys)];
}
export function getAlipayConfig() {
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = readEnvKey(process.env.ALIPAY_APP_PRIVATE_KEY_FILE, process.env.ALIPAY_APP_PRIVATE_KEY);
  const publicKeys = collectAlipayPublicKeys();
  const gateway = process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do";
  const configured = !!(appId && privateKey && publicKeys.length);
  return { configured, appId, privateKey, publicKeys, gateway };
}

// 微信支付公钥（验签回调用，推荐模式：无有效期、永不过期）
function getWechatPayPublicKey() {
  const k = readEnvKey(process.env.WECHAT_PAY_PUBLIC_KEY_FILE, process.env.WECHAT_PAY_PUBLIC_KEY);
  return k ? ensurePublicKeyPem(k) : "";
}

// ---------- 微信支付 v3 签名 ----------
function buildWxAuth(method, urlPath, body, cfg) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.createSign("RSA-SHA256").update(message).sign(cfg.privateKey, "base64");
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serial}"`;
}
function buildJsapiPayParams(prepayId, cfg) {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(12).toString("hex");
  const pkg = `prepay_id=${prepayId}`;
  const message = `${cfg.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const paySign = crypto.createSign("RSA-SHA256").update(message).sign(cfg.privateKey, "base64");
  return { appId: cfg.appId, timeStamp, nonceStr, package: pkg, signType: "RSA", paySign };
}

async function createWechatOrder(order, { jsapi } = {}) {
  const cfg = getWechatConfig();
  const urlPath = jsapi ? "/v3/pay/transactions/jsapi" : "/v3/pay/transactions/native";
  const bodyObj = {
    mchid: cfg.mchid,
    appid: cfg.appId,
    description: PLAN_NAMES[order.planId] || "升学服务",
    out_trade_no: order.orderId,
    notify_url: NOTIFY_BASE + "/api/pay/wechat/notify",
    amount: { total: order.amountFen, currency: "CNY" },
  };
  if (jsapi) {
    if (!order.openid) throw new Error("JSAPI 支付需要 openid");
    bodyObj.payer = { openid: order.openid };
  }
  const body = JSON.stringify(bodyObj);
  const auth = buildWxAuth("POST", urlPath, body, cfg);
  const res = await fetch("https://api.mch.weixin.qq.com" + urlPath, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  const data = await res.json();
  if (data.code) throw new Error("微信下单失败: " + data.code + " " + (data.message || ""));
  if (jsapi) {
    return { method: "jsapi", payParams: buildJsapiPayParams(data.prepay_id, cfg) };
  }
  const qrDataUrl = await QRCode.toDataURL(data.code_url, { width: 280, margin: 1 });
  return { method: "native", codeUrl: data.code_url, qrDataUrl };
}

// 平台证书（验签回调用）
async function getPlatformCert(serial) {
  const cache = readJson(WX_CERT_CACHE, {});
  if (cache[serial] && cache[serial].exp > Date.now()) return cache[serial].publicKey;
  const cfg = getWechatConfig();
  const urlPath = "/v3/certificates";
  const auth = buildWxAuth("GET", urlPath, "", cfg);
  const res = await fetch("https://api.mch.weixin.qq.com" + urlPath, {
    headers: { Authorization: auth, Accept: "application/json", "Accept-Language": "zh-CN" },
  });
  const data = await res.json();
  const map = {};
  for (const c of data.data || []) {
    const pub = decryptAesGcm(Buffer.from(cfg.apiV3, "utf-8"), c.encrypt_certificate.nonce, c.encrypt_certificate.ciphertext, c.encrypt_certificate.associated_data);
    map[c.serial_no] = { publicKey: pub, exp: Date.now() + 12 * 3600 * 1000 };
  }
  writeJson(WX_CERT_CACHE, map);
  if (!map[serial]) throw new Error("未找到对应序列号的微信平台证书");
  return map[serial].publicKey;
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}
function decryptAesGcm(key, nonce, ciphertextB64, associatedData) {
  const buf = Buffer.from(ciphertextB64, "base64");
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "utf-8"));
  decipher.setAuthTag(authTag);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf-8"));
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}

// 微信回调验签 + 解密，返回明文交易对象
export async function verifyWechatNotify(rawBody, headers) {
  const ts = headers["wechatpay-timestamp"];
  const nonce = headers["wechatpay-nonce"];
  const sig = headers["wechatpay-signature"];
  const serial = headers["wechatpay-serial"];
  const message = `${ts}\n${nonce}\n${rawBody}\n`;
  // 优先用「微信支付公钥」验签（无有效期，避免平台证书过期导致验签失败）
  const pubKey = getWechatPayPublicKey();
  let ok = false;
  if (pubKey) {
    ok = crypto.createVerify("RSA-SHA256").update(message).verify(pubKey, Buffer.from(sig, "base64"));
  }
  // 兜底：未配置公钥时回退到平台证书模式
  if (!ok && !pubKey && serial) {
    const cert = await getPlatformCert(serial);
    ok = crypto.createVerify("RSA-SHA256").update(message).verify(cert, Buffer.from(sig, "base64"));
  }
  if (!ok) throw new Error("微信回调签名校验失败");
  const payload = JSON.parse(rawBody);
  const cfg = getWechatConfig();
  const plaintext = decryptAesGcm(Buffer.from(cfg.apiV3, "utf-8"), payload.resource.nonce, payload.resource.ciphertext, payload.resource.associated_data);
  return JSON.parse(plaintext);
}

// 裸 base64 自动补 PEM 头（用户常把密钥直接粘成单行 base64）
function ensurePrivateKeyPem(k) {
  if (k && !k.includes("-----BEGIN")) return "-----BEGIN PRIVATE KEY-----\n" + k.trim() + "\n-----END PRIVATE KEY-----";
  return k;
}
function ensurePublicKeyPem(k) {
  if (k && !k.includes("-----BEGIN")) return "-----BEGIN PUBLIC KEY-----\n" + k.trim() + "\n-----END PUBLIC KEY-----";
  return k;
}
// ---------- 支付宝 ----------
function alipaySign(params, privateKey) {
  privateKey = ensurePrivateKeyPem(privateKey);
  // 支付宝 RSA2 发起请求签名：除 sign 外的所有参数（含 sign_type）都参与签名。
  // 注意与回调验签(verifyAlipay)的不对称设计——回调验签才剔除 sign_type。
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "" && k !== "sign")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createSign("RSA-SHA256").update(sorted, "utf-8").sign(privateKey, "base64");
}
export function verifyAlipay(params, publicKeys) {
  const sign = params.sign;
  if (!sign) return false;
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
  for (const pk of keys) {
    if (!pk) continue;
    try {
      if (crypto.createVerify("RSA-SHA256").update(sorted, "utf-8").verify(ensurePublicKeyPem(pk), Buffer.from(sign, "base64"))) {
        return true;
      }
    } catch {}
  }
  return false;
}
function createAlipayOrder(order, { wap } = {}) {
  const cfg = getAlipayConfig();
  const method = wap ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const returnUrl = NOTIFY_BASE + "/checkout?plan=" + order.planId + "&orderId=" + order.orderId + "&paid=1&channel=alipay";
  const params = {
    app_id: cfg.appId,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
    notify_url: NOTIFY_BASE + "/api/pay/alipay/notify",
    return_url: returnUrl,
    biz_content: JSON.stringify({
      out_trade_no: order.orderId,
      total_amount: order.amountYuan.toFixed(2),
      subject: PLAN_NAMES[order.planId] || "升学服务",
      product_code: wap ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
    }),
  };
  params.sign = alipaySign(params, cfg.privateKey);
  const query = new URLSearchParams(params).toString();
  return { method: "redirect", redirectUrl: cfg.gateway + "?" + query };
}

// ---------- 主动查单（用户点击“刷新状态”时兜底用） ----------
export async function queryWechatOrder(orderId) {
  const cfg = getWechatConfig();
  if (!cfg.configured) throw new Error("微信支付未配置");
  const urlPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${cfg.mchid}`;
  const auth = buildWxAuth("GET", urlPath, "", cfg);
  const res = await fetch("https://api.mch.weixin.qq.com" + urlPath, {
    headers: { Authorization: auth, Accept: "application/json", "Accept-Language": "zh-CN" },
  });
  const data = await res.json();
  if (data.code) throw new Error("微信查单失败: " + data.code + " " + (data.message || ""));
  if (data.trade_state === "SUCCESS" && data.out_trade_no === orderId) {
    return { paid: true, transactionId: data.transaction_id, channel: "wechat", raw: data };
  }
  return { paid: false, tradeState: data.trade_state, raw: data };
}
export async function queryAlipayOrder(orderId) {
  const cfg = getAlipayConfig();
  if (!cfg.configured) throw new Error("支付宝未配置");
  const params = {
    app_id: cfg.appId,
    method: "alipay.trade.query",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: orderId }),
  };
  params.sign = alipaySign(params, cfg.privateKey);
  const query = new URLSearchParams(params).toString();
  const res = await fetch(cfg.gateway, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query,
  });
  const data = await res.json();
  const resp = data.alipay_trade_query_response;
  if (!resp) throw new Error("支付宝查单响应异常");
  if (resp.code !== "10000") throw new Error("支付宝查单失败: " + resp.code + " " + (resp.msg || resp.sub_msg || ""));
  if ((resp.trade_status === "TRADE_SUCCESS" || resp.trade_status === "TRADE_FINISHED") && resp.out_trade_no === orderId) {
    return { paid: true, transactionId: resp.trade_no, channel: "alipay", raw: resp };
  }
  return { paid: false, tradeStatus: resp.trade_status, raw: resp };
}

// ---------- 微信 openid（OAuth snsapi_base） ----------
const WX_OAUTH_STATE = "ly_pay";
export function wxOauthAuthorizeUrl(redirectBack) {
  const appId = process.env.WECHAT_APP_ID;
  const cb = NOTIFY_BASE + "/api/wechat/oauth/callback?back=" + encodeURIComponent(redirectBack);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${encodeURIComponent(cb)}&response_type=code&scope=snsapi_base&state=${WX_OAUTH_STATE}#wechat_redirect`;
}
export async function wxOauthExchange(code) {
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${secret}&code=${code}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error("openid 获取失败: " + data.errmsg);
  return data.openid;
}

// ---------- 入口：创建订单 ----------
export async function createOrder(input) {
  const { planId, channel, shareFriends = 0, sessionId = "", openid = "", mobile = false } = input;
  const price = priceForPlan(planId, shareFriends);
  if (!price) throw new Error("未知套餐: " + planId);
  const orderId = genOrderId();
  const order = {
    orderId,
    planId,
    channel,
    shareFriends,
    sessionId,
    openid,
    amountYuan: price.price,
    amountFen: price.amountFen,
    discount: price.discount,
    status: "created",
    createdAt: Date.now(),
    paidAt: null,
    transactionId: null,
  };
  const all = readOrders();
  all[orderId] = order;
  writeOrders(all);

  // 免费单直接标记已支付
  if (order.amountFen <= 0) {
    order.status = "paid";
    order.paidAt = Date.now();
    order.transactionId = "FREE";
    writeOrders(all);
    return { orderId, status: "paid", paymentReady: true, free: true, amount: order.amountYuan };
  }

  // 凭证未配置 → 沙盒模式
  if (channel === "wechat" && !getWechatConfig().configured) {
    return { orderId, status: "created", paymentReady: false, reason: "微信支付凭证未配置" };
  }
  if (channel === "alipay" && !getAlipayConfig().configured) {
    return { orderId, status: "created", paymentReady: false, reason: "支付宝凭证未配置" };
  }

  let pay;
  if (channel === "wechat") {
    pay = await createWechatOrder(order, { jsapi: !!order.openid });
  } else {
    pay = createAlipayOrder(order, { wap: !!mobile });
  }
  return { orderId, status: "created", paymentReady: true, channel, amount: order.amountYuan, ...pay };
}

// 配置探测（给前端显示通道可用状态）
export function paymentConfigStatus() {
  return {
    wechat: getWechatConfig().configured,
    alipay: getAlipayConfig().configured,
    wechatNeedsOpenid: getWechatConfig().configured, // 微信内支付需要 openid
    wechatPubKeyMode: !!getWechatPayPublicKey(), // 是否已启用微信支付公钥验签（彻底规避平台证书过期）
  };
}
