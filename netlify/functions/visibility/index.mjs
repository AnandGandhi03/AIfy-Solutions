// Free AI visibility check (GEO / AEO lead magnet).
// POST /api/visibility { action: "start", business, website, category, city, name, email, consent } -> { id, questions }
// POST /api/visibility { action: "ask", id, index }  -> result for one question (run in parallel from the browser)
// POST /api/visibility { action: "finish", id }      -> score + recommendations; the lead is saved and the team notified
// GET  /api/visibility?id=...                        -> stored report (shareable link)
import { makeQuestions, askEngine, detectMention, extractBusinesses, recommend } from "../../lib/visibility.mjs";
import { store } from "../../lib/store.mjs";
import { saveLead, validEmail } from "../../lib/leads.mjs";
import { guard, json, corsHeaders } from "../../lib/http.mjs";

export const config = { path: "/api/visibility" };
const DAILY_PER_IP = Number(process.env.VISIBILITY_DAILY_LIMIT || 3);
const clip = (v, n) => String(v || "").trim().slice(0, n);
const publicView = (c) => ({ id: c.id, business: c.business, website: c.website, category: c.category, city: c.city, createdAt: c.createdAt, status: c.status, questions: c.questions, results: c.results, score: c.score, recommendations: c.recommendations, engine: c.engine });

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  const checks = await store("checks");
  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[a-z0-9]{10,40}$/.test(id)) return json({ error: "not_found" }, 404, cors);
    const c = await checks.getJSON(id);
    return c ? json(publicView(c), 200, cors) : json({ error: "not_found" }, 404, cors);
  }
  const early = guard(req); if (early) return early;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, cors); }

  if (b.action === "start") {
    if (b.website_url_confirm) return json({ error: "Please try again." }, 400, cors); // honeypot
    const c = {
      business: clip(b.business, 120), website: clip(b.website, 200), category: clip(b.category, 80), city: clip(b.city, 80), region: clip(b.region, 40),
      name: clip(b.name, 100), email: clip(b.email, 160), phone: clip(b.phone, 40),
    };
    if (!c.business || !c.category || !c.city) return json({ error: "Please add your business name, what you do and your city." }, 400, cors);
    if (!c.name || !validEmail(c.email)) return json({ error: "Please add your name and a valid email so we can send your report." }, 400, cors);
    if (!b.consent) return json({ error: "Please confirm we can email you the report." }, 400, cors);
    // light abuse protection: a few checks per IP per day
    const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const day = new Date().toISOString().slice(0, 10);
    const limits = await store("limits");
    const key = `vis-${day}-${ip}`;
    const used = (await limits.getJSON(key)) || 0;
    if (used >= DAILY_PER_IP) return json({ error: "You've reached today's limit for free checks. Email info@aify.solutions and we'll run a full one for you." }, 429, cors);
    await limits.setJSON(key, used + 1);
    let questions;
    try { questions = await makeQuestions(c); }
    catch (e) { console.error(e); return json({ error: "We couldn't start the check just now. Please try again in a minute." }, 502, cors); }
    const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);
    const check = { id, createdAt: new Date().toISOString(), status: "running", ...c, questions, results: questions.map((q) => ({ question: q, pending: true })), engine: process.env.VISIBILITY_ENGINE === "perplexity" ? "Perplexity" : "Claude with web search" };
    await checks.setJSON(id, check);
    return json({ id, questions, engine: check.engine }, 200, cors);
  }

  const id = clip(b.id, 40);
  if (!/^[a-z0-9]{10,40}$/.test(id)) return json({ error: "bad_id" }, 400, cors);
  const check = await checks.getJSON(id);
  if (!check) return json({ error: "not_found" }, 404, cors);

  if (b.action === "ask") {
    if (check.status === "done") return json({ error: "already_finished" }, 409, cors);
    const i = Number(b.index);
    if (!Number.isInteger(i) || i < 0 || i >= check.questions.length) return json({ error: "bad_index" }, 400, cors);
    const existing = await checks.getJSON(`${id}-r${i}`);
    if (existing && !existing.error) return json(existing, 200, cors); // never pay twice for the same answer
    const question = check.questions[i];
    let r;
    try {
      const { engine, answer, sources } = await askEngine({ question, city: check.city, region: check.region });
      const { mentioned, cited } = detectMention(check, answer, sources);
      const competitors = await extractBusinesses(answer, check.business);
      r = { question, engine, answer: answer.slice(0, 2000), sources, mentioned, cited, competitors };
    } catch (e) {
      console.error("visibility ask", e);
      r = { question, error: true };
    }
    await checks.setJSON(`${id}-r${i}`, r); // one key per answer, so parallel requests never overwrite each other
    return json(r, 200, cors);
  }

  if (b.action === "finish") {
    if (check.status === "done") return json(publicView(check), 200, cors);
    for (let i = 0; i < check.questions.length; i++) check.results[i] = (await checks.getJSON(`${id}-r${i}`)) || { question: check.questions[i], error: true };
    const done = check.results.filter((r) => !r.pending && !r.error);
    const mentioned = done.filter((r) => r.mentioned).length;
    check.score = { mentioned, checked: done.length, total: check.questions.length, percent: done.length ? Math.round((mentioned / done.length) * 100) : 0 };
    const counts = {};
    for (const r of done) for (const n of r.competitors || []) counts[n] = (counts[n] || 0) + 1;
    check.score.topCompetitors = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n }));
    const hosts = {};
    for (const r of done) for (const s of r.sources || []) hosts[s.host] = (hosts[s.host] || 0) + 1;
    check.score.topSources = Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([host, n]) => ({ host, n }));
    check.recommendations = await recommend({ ...check, results: done });
    check.status = "done";
    await checks.setJSON(id, check);
    const base = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
    await saveLead({
      name: check.name, email: check.email, phone: check.phone, business: check.business, website: check.website,
      interest: "GEO / AEO (free AI visibility check)", source: "AI visibility check",
      notes: `${check.category} in ${check.city}. Mentioned in ${mentioned} of ${done.length} AI answers. Report: ${base}/ai-visibility?id=${id}`,
    }, { kind: "visibility-check", subject: `AI visibility check: ${check.business} (${mentioned}/${done.length} mentions)` });
    // send the visitor their report link (when email is set up)
    if (process.env.RESEND_API_KEY) {
      const link = `${base}/ai-visibility?id=${id}`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.LEAD_EMAIL_FROM || "AIfy <agent@aify.solutions>",
          to: [check.email], reply_to: process.env.LEAD_EMAIL_TO || "info@aify.solutions",
          subject: `Your AI visibility report for ${check.business}`,
          text: `Hi ${check.name},\n\nYour free AI visibility check for ${check.business} is ready. AI assistants named you in ${mentioned} of ${done.length} answers to questions customers ask about a ${check.category} in ${check.city}.\n\nSee the full report, including who was recommended instead and what to fix first:\n${link}\n\nWant help fixing it? Reply to this email or book a 15-minute call: ${process.env.BOOKING_URL || base + "/contact"}\n\nThe AIfy team\nAIfy Solutions · Surrey, BC · aify.solutions`,
        }),
      }).catch((e) => console.warn("report email failed", e));
    }
    return json(publicView(check), 200, cors);
  }
  return json({ error: "bad_action" }, 400, cors);
};
