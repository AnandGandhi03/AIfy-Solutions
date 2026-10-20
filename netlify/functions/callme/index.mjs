// POST /api/callme  { name, business, phone, consent: true }  ->  AIfy's AI sales assistant calls the visitor now.
// Only calls with express consent (CRTC: automated / synthesized-voice sales calls need it), inside calling hours,
// never a number on AIfy's do-not-call list. Every consent is recorded in Netlify Blobs ("consents").
// Env: ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SALES_FROM_NUMBER (or DEMO_PHONE_NUMBER),
//      optional CALLME_DAILY_CAP (default 60 calls a day in total), BOOKING_URL, PUBLIC_BASE_URL.
import crypto from "node:crypto";
import { guard, json, corsHeaders, dailyLimit } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";
import { saveLead } from "../../lib/leads.mjs";
import { normalizeNanp, prettyNumber, inCallingHours, placeCall, baseUrl } from "../../lib/twilio.mjs";
import { isDoNotCall } from "../../lib/sales/tools.mjs";

export const config = { path: "/api/callme" };

export const CONSENT_TEXT = "I agree that AIfy Solutions may call this number now with an AI voice assistant about AIfy's services, and that the call is transcribed. I can ask it to stop at any time.";
const clip = (s, n) => String(s || "").trim().slice(0, n);

async function bump(key, limit) {
  const s = await store("limits");
  const used = (await s.getJSON(key)) || 0;
  if (used >= limit) return false;
  await s.setJSON(key, used + 1);
  return true;
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  if (req.method === "GET") {
    const on = !!(process.env.ANTHROPIC_API_KEY && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.SALES_FROM_NUMBER || process.env.DEMO_PHONE_NUMBER));
    return json({ enabled: on, consent_text: CONSENT_TEXT }, 200, { ...cors, "cache-control": "public, max-age=300" });
  }
  const early = guard(req); if (early) return early;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, cors); }
  if (!b || b.website) return json({ ok: true, calling: false, message: "Thanks!" }, 200, cors); // honeypot

  const from = process.env.SALES_FROM_NUMBER || process.env.DEMO_PHONE_NUMBER;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !from) return json({ error: "not_configured", message: "Calls aren't switched on yet. Please book a time instead." }, 503, cors);

  const name = clip(b.name, 80), business = clip(b.business, 120), phone = normalizeNanp(b.phone);
  if (!name) return json({ error: "Please add your name." }, 400, cors);
  if (!phone) return json({ error: "Please enter a Canadian or US phone number, like (604) 555-0123." }, 400, cors);
  if (b.consent !== true) return json({ error: "Please tick the box to agree to the call." }, 400, cors);

  const limited = await dailyLimit(req, "callme", 3, cors); if (limited) return limited;
  const day = new Date().toISOString().slice(0, 10);
  if (!(await bump(`callme-phone-${day}-${phone}`, 2))) return json({ error: "We've already called this number today. Pick a time on the contact page instead." }, 429, cors);
  if (!(await bump(`callme-total-${day}`, Number(process.env.CALLME_DAILY_CAP || 60)))) return json({ error: "We've reached today's limit for instant calls. Please book a time on the contact page." }, 429, cors);
  if (await isDoNotCall(phone)) return json({ error: "This number is on our do-not-call list. Email info@aify.solutions if you'd like to hear from us." }, 409, cors);

  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const at = new Date().toISOString();
  const consents = await store("consents");
  await consents.setJSON(`${phone}-${at}`, { phone, name, business, consent_text: CONSENT_TEXT, at, ip, user_agent: clip(req.headers.get("user-agent"), 200), page: clip(b.page, 80) });

  if (!inCallingHours(phone)) {
    await saveLead({ name, business, phone, source: "Call-me request outside calling hours", page: clip(b.page, 80) }, { kind: "callme", subject: `Call request (after hours): ${name}${business ? `, ${business}` : ""}` });
    return json({ ok: true, calling: false, message: "It's outside calling hours right now, so our team will call you on the next business day. Want a set time? Pick one on the contact page." }, 200, cors);
  }

  const cid = crypto.randomUUID();
  const calls = await store("sales-calls");
  await calls.setJSON(cid, { cid, phone, name, business, startedAt: at, convo: [], transcript: [], turns: 0, silence: 0 });
  const base = baseUrl(req);
  const callSid = await placeCall({ to: phone, from, url: `${base}/api/sales-voice?cid=${cid}`, statusCallback: `${base}/api/sales-voice?event=status&cid=${cid}` });
  if (!callSid) {
    await calls.delete(cid);
    await saveLead({ name, business, phone, source: "Call-me request (call failed to start)" }, { kind: "callme", subject: `Call request needs a callback: ${name}` });
    return json({ error: "We couldn't start the call just now. Our team will call you back shortly." }, 502, cors);
  }
  return json({ ok: true, calling: true, message: `Calling you now from ${prettyNumber(from)}. Pick up and say hi.` }, 200, cors);
};
