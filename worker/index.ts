/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COLLECT_WRITE_TOKEN?: string;
  COLLECT_READ_TOKEN?: string;
  WECHAT_MCH_ID?: string;
  WECHAT_API_KEY?: string;
  ALIPAY_APP_ID?: string;
  ALIPAY_PRIVATE_KEY?: string;
  IMAGES: { input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } } };
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }

const analyticsTable = "CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, session_id TEXT, environment TEXT NOT NULL DEFAULT 'production', properties TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)";
const ordersTable = "CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, amount INTEGER NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)";
const plans: Record<string, number> = { draft_9_9: 990, match_29_9: 2990, simulation_199: 19900, review_599: 59900, planning_5999: 599900 };

function isAuthorized(request: Request, expected?: string, allowSameOrigin = false) { if (allowSameOrigin && request.headers.get("origin") === "https://laoyou.love") return true; return !expected || request.headers.get("authorization") === `Bearer ${expected}`; }
async function ensureTables(env: Env) { await env.DB.prepare(analyticsTable).run(); try { await env.DB.prepare("ALTER TABLE analytics_events ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'").run(); } catch { } await env.DB.prepare(ordersTable).run(); await env.DB.prepare("DELETE FROM analytics_events WHERE session_id IN ('smoke-v9','acceptance-v10','verification') OR name = 'production_security_check'").run(); }

async function analyticsCollect(request: Request, env: Env) {
  if (!isAuthorized(request, env.COLLECT_WRITE_TOKEN, true)) return new Response("Unauthorized", { status: 401 });
  if (!env.DB) return Response.json({ error: "D1 binding DB is not configured" }, { status: 503 });
  try { const body = await request.json() as { name?: string; event?: string; sessionId?: string; sid?: string; environment?: string; properties?: unknown; payload?: unknown }; const name = String(body.name ?? body.event ?? "").trim(); if (!name) return Response.json({ error: "name is required" }, { status: 400 }); await ensureTables(env); const environment = body.environment === "test" ? "test" : "production"; await env.DB.prepare("INSERT INTO analytics_events (name, session_id, environment, properties) VALUES (?, ?, ?, ?)").bind(name, body.sessionId ?? body.sid ?? null, environment, JSON.stringify(body.properties ?? body.payload ?? {})).run(); return new Response(null, { status: 204 }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid event" }, { status: 400 }); }
}

async function analyticsMetrics(request: Request, env: Env) {
  if (!isAuthorized(request, env.COLLECT_READ_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401 }); if (!env.DB) return Response.json({ error: "D1 binding DB is not configured" }, { status: 503 }); await ensureTables(env);
  const where = " WHERE environment = 'production'"; const [total, sessions, counts, recent] = await Promise.all([env.DB.prepare(`SELECT COUNT(*) AS value FROM analytics_events${where}`).first(), env.DB.prepare(`SELECT COUNT(DISTINCT session_id) AS value FROM analytics_events${where} AND session_id IS NOT NULL`).first(), env.DB.prepare(`SELECT name, COUNT(*) AS value FROM analytics_events${where} GROUP BY name ORDER BY value DESC`).all(), env.DB.prepare(`SELECT name, session_id, created_at FROM analytics_events${where} ORDER BY id DESC LIMIT 30`).all()]);
  const funnel = await Promise.all(["score_submitted", "school_match_viewed", "volunteer_simulation_started", "volunteer_plan_generated"].map(async (name) => { const row = await env.DB.prepare(`SELECT COUNT(DISTINCT session_id) AS value FROM analytics_events${where} AND name = ? AND session_id IS NOT NULL`).bind(name).first<{ value: number }>(); return [name, Number(row?.value ?? 0)]; })); return Response.json({ totalEvents: Number((total as { value?: number })?.value ?? 0), sessions: Number((sessions as { value?: number })?.value ?? 0), counts: counts.results, funnel: Object.fromEntries(funnel), recent: recent.results });
}

async function createOrder(request: Request, env: Env) {
  if (!env.DB) return Response.json({ error: "D1 binding DB is not configured" }, { status: 503 }); try { const body = await request.json() as { planId?: string; channel?: string; sessionId?: string }; const planId = String(body.planId ?? ""); const channel = String(body.channel ?? ""); if (!(planId in plans)) return Response.json({ error: "Invalid plan" }, { status: 400 }); if (!["wechat", "alipay"].includes(channel)) return Response.json({ error: "Invalid channel" }, { status: 400 }); await ensureTables(env); const orderId = crypto.randomUUID(); const amount = plans[planId]; await env.DB.prepare("INSERT INTO orders (order_id, plan_id, amount, channel, status, session_id) VALUES (?, ?, ?, ?, ?, ?)").bind(orderId, planId, amount, channel, "pending_payment", body.sessionId ?? null).run(); const paymentReady = channel === "wechat" ? Boolean(env.WECHAT_MCH_ID && env.WECHAT_API_KEY) : Boolean(env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY); return Response.json({ orderId, status: "pending_payment", paymentReady }, { status: 201 }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid order" }, { status: 400 }); }
}

async function paymentNotify(request: Request, env: Env, channel: "wechat" | "alipay") { const ready = channel === "wechat" ? Boolean(env.WECHAT_MCH_ID && env.WECHAT_API_KEY) : Boolean(env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY); if (!ready) return Response.json({ error: "Payment channel is not configured" }, { status: 503 }); return Response.json({ error: "Payment signature adapter is not enabled" }, { status: 501 }); }

const worker = { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> { const url = new URL(request.url); if (url.pathname === "/api/collect" && request.method === "POST") return analyticsCollect(request, env); if (url.pathname === "/api/metrics" && request.method === "GET") return analyticsMetrics(request, env); if (url.pathname === "/api/orders" && request.method === "POST") return createOrder(request, env); if (url.pathname === "/api/payments/wechat/notify" && request.method === "POST") return paymentNotify(request, env, "wechat"); if (url.pathname === "/api/payments/alipay/notify" && request.method === "POST") return paymentNotify(request, env, "alipay"); if (url.pathname === "/_vinext/image") { const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES]; return handleImageOptimization(request, { fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))), transformImage: async (body, { width, format, quality }) => { const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality }); return result.response(); } }, allowedWidths); } return handler.fetch(request, env, ctx); } };
export default worker;