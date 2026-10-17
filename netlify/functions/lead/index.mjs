// POST /api/lead — "Get this for your store" form on the demo page (and any other page that posts JSON).
import { saveLead, validEmail } from "../../lib/leads.mjs";
import { guard, json, corsHeaders, dailyLimit } from "../../lib/http.mjs";

export const config = { path: "/api/lead" };

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const early = guard(req, { needsKey: false }); if (early) return early;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders(origin));
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, corsHeaders(origin)); }
  if (!b || b.website) return json({ ok: true }, 200, corsHeaders(origin)); // honeypot: pretend success
  const limited = await dailyLimit(req, "lead", 10, corsHeaders(origin)); if (limited) return limited;
  if (!String(b.name || "").trim() || !validEmail(b.email)) return json({ error: "Please add your name and a valid email." }, 400, corsHeaders(origin));
  const lead = {
    name: b.name, email: b.email, phone: b.phone, business: b.business, role: b.role,
    interest: b.interest || "AI voice agent for dealership service", notes: b.notes,
    source: String(b.source || "website form").slice(0, 80),
    demo_summary: typeof b.demo_summary === "string" ? b.demo_summary.slice(0, 1500) : undefined,
    page: String(b.page || "").slice(0, 80),
  };
  const { ok } = await saveLead(lead, { kind: "demo-request", subject: `Demo request: ${lead.name}${lead.business ? `, ${lead.business}` : ""}` });
  return json(ok ? { ok: true } : { error: "Couldn't send just now. Please email info@aify.solutions." }, ok ? 200 : 502, corsHeaders(origin));
};
