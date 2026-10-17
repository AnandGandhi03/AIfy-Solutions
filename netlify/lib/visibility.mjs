// Free AI visibility check: generate realistic customer questions, ask AI assistants that search the live web,
// and record whether the business is named, who else is named, and which sources were used.
const API = "https://api.anthropic.com/v1/messages";

async function claude(body) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return res.json();
}
const textOf = (msg) => (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
function parseJSON(t) {
  const m = String(t).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : null;
}
const QUICK = () => process.env.VISIBILITY_QUICK_MODEL || "claude-haiku-5-5";
const SEARCH = () => process.env.VISIBILITY_MODEL || "claude-haiku-5-5";

// 1. Six questions a real customer might ask an AI assistant.
export async function makeQuestions({ business, category, city }) {
  const msg = await claude({
    model: QUICK(), max_tokens: 600,
    messages: [{ role: "user", content: `A customer near ${city} is looking for a ${category}. Write 6 short, natural questions they might type into an AI assistant like ChatGPT or Perplexity when choosing who to use. Mix: "best ... in ${city}", a specific service, a price or value question, an urgent or after-hours need, a trust or reviews question, and a comparison. Do not mention any business by name (the business being tested is "${business}", never include it). Reply with only a JSON array of 6 strings.` }],
  });
  const arr = parseJSON(textOf(msg));
  if (!Array.isArray(arr) || arr.length < 3) throw new Error("question generation failed");
  return arr.slice(0, 6).map((q) => String(q).slice(0, 200));
}

// 2. Ask one question the way an assistant with live web search would answer it.
export async function askEngine({ question, city, region }) {
  if (process.env.PERPLEXITY_API_KEY && process.env.VISIBILITY_ENGINE === "perplexity") return askPerplexity(question);
  const tool = { type: process.env.WEB_SEARCH_TOOL || "web_search_20250305", name: "web_search", max_uses: Number(process.env.VISIBILITY_MAX_SEARCHES || 2) };
  if (city) tool.user_location = { type: "approximate", city, region: region || undefined, country: "CA", timezone: "America/Vancouver" };
  let messages = [{ role: "user", content: question }];
  let msg;
  for (let i = 0; i < 3; i++) { // continue if the server pauses a long search turn
    msg = await claude({
      model: SEARCH(), max_tokens: 700, tools: [tool],
      system: "You are a helpful AI assistant answering a consumer's question. Search the web, then answer the way a good assistant would: recommend specific local businesses by name where appropriate, briefly say why, and keep it under 150 words.",
      messages,
    });
    if (msg.stop_reason !== "pause_turn") break;
    messages = messages.concat([{ role: "assistant", content: msg.content }]);
  }
  const sources = [];
  for (const b of msg.content || []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push({ url: r.url, title: r.title || "" });
    if (b.type === "text" && Array.isArray(b.citations)) for (const c of b.citations) if (c.url) sources.push({ url: c.url, title: c.title || "" });
  }
  return { engine: "Claude with web search", answer: textOf(msg), sources: dedupe(sources) };
}

async function askPerplexity(question) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.PERPLEXITY_MODEL || "sonar", messages: [{ role: "user", content: question }] }),
  });
  if (!res.ok) throw new Error(`perplexity ${res.status}`);
  const j = await res.json();
  const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  const urls = j.search_results ? j.search_results.map((r) => ({ url: r.url, title: r.title || "" })) : (j.citations || []).map((u) => ({ url: u, title: "" }));
  return { engine: "Perplexity", answer, sources: dedupe(urls) };
}

function dedupe(list) {
  const seen = new Set(); const out = [];
  for (const s of list) { let host = ""; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { continue; } if (seen.has(host)) continue; seen.add(host); out.push({ host, url: s.url, title: s.title }); }
  return out.slice(0, 8);
}

// 3. Was the business named? Who else was?
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/\b(inc|ltd|llc|corp|co|limited|the)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export function detectMention({ business, website }, answer, sources) {
  const a = norm(answer); const b = norm(business);
  let host = "";
  try { host = website ? new URL(/^https?:/.test(website) ? website : "https://" + website).hostname.replace(/^www\./, "") : ""; } catch {}
  const byName = b.length >= 3 && (` ${a} `).includes(` ${b} `);
  const byDomain = !!host && (String(answer).toLowerCase().includes(host) || sources.some((s) => s.host === host || s.host.endsWith("." + host)));
  const cited = !!host && sources.some((s) => s.host === host || s.host.endsWith("." + host));
  return { mentioned: byName || byDomain, cited };
}

export async function extractBusinesses(answer, business) {
  if (!answer) return [];
  try {
    const msg = await claude({ model: QUICK(), max_tokens: 300, messages: [{ role: "user", content: `List the names of specific businesses recommended or mentioned in this answer, excluding "${business}". Reply with only a JSON array of strings (empty if none).\n\n<answer>\n${answer.slice(0, 3000)}\n</answer>` }] });
    const arr = parseJSON(textOf(msg));
    return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 6) : [];
  } catch { return []; }
}

// 4. Recommendations from the results.
export async function recommend(check) {
  const lines = check.results.map((r, i) => `Q${i + 1}: ${r.question}\nMentioned: ${r.mentioned ? "yes" : "no"}; site cited: ${r.cited ? "yes" : "no"}; others named: ${(r.competitors || []).join(", ") || "none"}; sources: ${(r.sources || []).map((s) => s.host).join(", ") || "none"}`).join("\n\n");
  try {
    const msg = await claude({
      model: QUICK(), max_tokens: 700,
      messages: [{ role: "user", content: `You are a GEO/AEO consultant. A ${check.category} called "${check.business}" in ${check.city}${check.website ? ` (website ${check.website})` : ""} was tested with AI assistants. Results:\n\n${lines}\n\nGive 4 specific, practical recommendations to get it recommended more often, based on these results (e.g. which listing or review sites the AI relied on, missing service pages, structured data, reviews). Don't promise outcomes. Reply with only JSON: [{"title": short, "detail": one or two sentences}]` }],
    });
    const arr = parseJSON(textOf(msg));
    return Array.isArray(arr) ? arr.slice(0, 5).map((r) => ({ title: String(r.title || "").slice(0, 120), detail: String(r.detail || "").slice(0, 400) })) : [];
  } catch { return []; }
}
