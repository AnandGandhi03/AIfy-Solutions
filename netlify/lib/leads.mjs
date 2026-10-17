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
