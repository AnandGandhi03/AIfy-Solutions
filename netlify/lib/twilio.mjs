// Twilio helpers shared by the phone functions: TwiML, signature checks, SMS and outbound calls.
import crypto from "node:crypto";

export const VOICE = () => process.env.TWILIO_VOICE || "Polly.Joanna-Neural";
export const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
export const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "content-type": "text/xml" } });
export const say = (text) => `<Say voice="${esc(VOICE())}">${esc(text)}</Say>`;
export const gatherTo = (action, inner) => `<Gather input="speech" action="${esc(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true">${inner}</Gather>`;

export function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}
export function publicUrl(req) {
  const u = new URL(req.url);
  return process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") + u.pathname + u.search : u.toString();
}
export function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
}
// Returns null when the request is genuinely from Twilio (or no token is set), else a 403 Response.
export function verifyTwilio(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) { console.warn("TWILIO_AUTH_TOKEN not set: Twilio signature not verified"); return null; }
  const expected = twilioSignature(token, publicUrl(req), params);
  const got = req.headers.get("x-twilio-signature") || "";
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    console.warn("bad twilio signature");
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}
const auth = () => "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

export async function sendSms(to, body, from) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  from = from || process.env.TWILIO_FROM_NUMBER || process.env.DEMO_PHONE_NUMBER;
  if (!sid || !tok || !from || !to) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!r.ok) console.warn("twilio sms", r.status, await r.text().catch(() => ""));
  return r.ok;
}

export async function placeCall({ to, from, url, statusCallback }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: to, From: from, Url: url, Method: "POST",
      StatusCallback: statusCallback, StatusCallbackMethod: "POST",
      MachineDetection: "Enable", Timeout: "25", TimeLimit: "900",
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("twilio call failed", r.status, JSON.stringify(body).slice(0, 300)); return null; }
  return body.sid || "queued";
}

// Canadian / US numbers only, returned as +1XXXXXXXXXX, or null.
export function normalizeNanp(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d.length === 10 ? d : null;
  if (!ten || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  if (/^(800|833|844|855|866|877|888|900|976)/.test(ten)) return null; // toll-free and premium
  return "+1" + ten;
}
export const prettyNumber = (e164) => { const d = String(e164 || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164; };

// Calling hours under the CRTC Telemarketing Rules: 9:00-21:30 weekdays, 10:00-18:00 weekends, in the
// recipient's local time. We keep a small margin and find the time zone from the area code. For an unknown
// area code (for example a US number) the call must fit both the Eastern and Pacific windows.
const TZ_BY_AREA = {
  "America/Vancouver": [604, 778, 236, 250, 672],
  "America/Edmonton": [403, 587, 780, 825, 368, 867],
  "America/Regina": [306, 639, 474],
  "America/Winnipeg": [204, 431, 584],
  "America/Toronto": [416, 647, 437, 905, 289, 365, 742, 613, 343, 753, 705, 249, 683, 519, 226, 548, 807, 514, 438, 450, 579, 418, 581, 367, 819, 873, 468, 263, 354],
  "America/Halifax": [902, 782, 506, 428],
  "America/St_Johns": [709, 879],
};
export function timeZonesFor(e164) {
  const area = Number(String(e164 || "").replace(/\D/g, "").slice(-10, -7));
  for (const [tz, codes] of Object.entries(TZ_BY_AREA)) if (codes.includes(area)) return [tz];
  return ["America/New_York", "America/Los_Angeles"];
}
function okIn(tz, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  return weekend ? mins >= 10 * 60 && mins < 17 * 60 + 30 : mins >= 9 * 60 && mins < 21 * 60;
}
export function inCallingHours(e164, now = new Date()) {
  return timeZonesFor(e164).every((tz) => okIn(tz, now));
}
