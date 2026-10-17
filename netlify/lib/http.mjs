// CORS, JSON and server-sent-event helpers shared by the functions.
import { store } from "./store.mjs";

// Simple per-IP daily cap to protect API spend. Returns a Response when over the limit, else null.
export async function dailyLimit(req, name, limit, headers = {}) {
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const key = `${name}-${new Date().toISOString().slice(0, 10)}-${ip}`;
  try {
    const s = await store("limits");
    const used = (await s.getJSON(key)) || 0;
    if (used >= limit) return json({ error: "rate_limited" }, 429, headers);
    await s.setJSON(key, used + 1);
  } catch (e) { console.warn("limit store unavailable", e); }
  return null;
}
function allowedList() {
  return (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}
export function originAllowed(origin) {
  const list = allowedList();
  if (!list.length || !origin) return true;
  try { return list.includes(origin) || /\.netlify\.app$/.test(new URL(origin).hostname); } catch { return false; }
}
export function corsHeaders(origin) {
  const list = allowedList();
  const allow = !list.length ? "*" : (list.includes(origin) ? origin : list[0]);
  return { "access-control-allow-origin": allow, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "content-type": "application/json" } });
}
// Guards common to the browser-facing endpoints. Returns a Response to send back, or null to continue.
export function guard(req, { needsKey = true } = {}) {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  if (needsKey && !process.env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 503, cors);
  return null;
}
export function sseResponse(origin, run) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try { await run(send); send({ type: "done" }); }
      catch (err) {
        console.error("stream error", err);
        const m = String((err && err.message) || "");
        const code = (m.match(/anthropic (\d{3})/) || [])[1];
        const why = /credit|billing/i.test(m) ? "billing" : /model/i.test(m) ? "model" : /web_search|tool/i.test(m) ? "tool" : "";
        send({ type: "error", code: code ? `ai_${code}${why ? "_" + why : ""}` : "server", message: "Sorry, something went wrong on our side. Please try again, or email info@aify.solutions." + (code ? ` (ref ${code}${why ? "-" + why : ""})` : "") });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { ...corsHeaders(origin), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" } });
}
