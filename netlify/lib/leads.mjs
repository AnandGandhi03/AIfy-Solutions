// Every lead is kept in Netlify Blobs ("leads") and, when configured, emailed (Resend) and posted to a webhook.
import { store } from "./store.mjs";

const clip = (v, n = 2000) => String(v ?? "").slice(0, n);
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

export async function saveLead(lead, { subject, kind = "lead" } = {}) {
  const record = { kind, at: new Date().toISOString(), ...Object.fromEntries(Object.entries(lead).map(([k, v]) => [k, typeof v === "object" ? v : clip(v)])) };
  console.log("LEAD", JSON.stringify(record).slice(0, 4000));
  let stored = false;
  try {
    const s = await store("leads");
    await s.setJSON(`${record.at}-${kind}-${Math.random().toString(36).slice(2, 8)}`, record);
    stored = s.durable;
  } catch (e) { console.warn("lead store failed", e); }

  const jobs = [];
  // Also file every lead as a Netlify Forms entry ("ify-lead", registered in public/__forms.html),
  // so Netlify's form notifications can email the team. The visitor never fills a form.
  if (process.env.NETLIFY || process.env.PUBLIC_BASE_URL) jobs.push(fileFormEntry(record));
  if (process.env.LEAD_WEBHOOK_URL) {
    jobs.push(fetch(process.env.LEAD_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) }));
  }
  if (process.env.RESEND_API_KEY) {
    const text = Object.entries(record).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v, null, 2) : v}`).join("\n");
    jobs.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.LEAD_EMAIL_FROM || "AIfy website <agent@aify.solutions>",
        to: [process.env.LEAD_EMAIL_TO || "info@aify.solutions"],
        ...(validEmail(record.email) ? { reply_to: record.email } : {}),
        subject: subject || `New ${kind}: ${record.name || record.phone || "website visitor"}${record.business ? `, ${record.business}` : ""}`,
        text,
      }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  const sent = results.some((r) => r.status === "fulfilled" && r.value.ok);
  if (jobs.length && !sent) console.error("lead delivery failed", results.map((r) => r.status === "fulfilled" ? r.value.status : String(r.reason)));
  return { ok: stored || sent || !jobs.length, record };
}

const FORM_FIELDS = ["name", "email", "phone", "business", "interest"];
async function fileFormEntry(record) {
  const base = (process.env.PUBLIC_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!base) throw new Error("no site URL for form entry");
  const kinds = { "chat-lead": "Ify website chat", "demo-request": "Dealership demo form", callme: "Call-me request", "visibility-check": "AI visibility check", "demo-call": "Demo line call", "sales-call": "AI sales call" };
  const body = new URLSearchParams({ "form-name": "ify-lead", type: kinds[record.kind] || record.kind || "lead" });
  for (const k of FORM_FIELDS) if (record[k]) body.set(k, String(record[k]));
  const rest = Object.entries(record).filter(([k]) => !FORM_FIELDS.includes(k) && k !== "kind");
  body.set("details", rest.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n").slice(0, 6000));
  const r = await fetch(`${base}/__forms.html`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
  return { ok: r.status >= 200 && r.status < 400, status: r.status };
}
