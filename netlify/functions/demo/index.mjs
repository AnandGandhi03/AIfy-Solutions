// Live dealership demo (web voice call). Separate from AIfy Agent.
// GET  /api/demo -> { greeting, phone }   (phone = the real demo line, if configured)
// POST /api/demo { messages } -> SSE: text deltas, tool status, workflow steps
import { DEMO_PROMPT, DEMO_GREETING } from "../../lib/dealer/prompt.mjs";
import { DEMO_TOOLS, makeDemoTools } from "../../lib/dealer/tools.mjs";
import { runAgent, sanitizeMessages } from "../../lib/llm.mjs";
import { guard, json, corsHeaders, sseResponse, dailyLimit } from "../../lib/http.mjs";

export const config = { path: "/api/demo" };

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "GET") {
    return json({ greeting: DEMO_GREETING.web, phone: process.env.DEMO_PHONE_NUMBER || null, live: !!process.env.ANTHROPIC_API_KEY }, 200, { ...corsHeaders(origin), "cache-control": "public, max-age=300" });
  }
  const early = guard(req); if (early) return early;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders(origin));
  let body; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, corsHeaders(origin)); }
  const raw = Array.isArray(body && body.messages) ? body.messages.slice(-40) : [];
  if (raw.length && raw[0] && raw[0].role === "assistant") raw.unshift({ role: "user", content: "(The call connects.)" });
  const messages = sanitizeMessages(raw, { maxTurns: 41, maxChars: 600 });
  if (!messages) return json({ error: "bad_messages" }, 400, corsHeaders(origin));
  const limited = await dailyLimit(req, "demo", Number(process.env.DEMO_DAILY_LIMIT || 150), corsHeaders(origin)); if (limited) return limited;

  return sseResponse(origin, async (send) => {
    const runTool = makeDemoTools({ channel: "web" });
    await runAgent({
      system: DEMO_PROMPT({ channel: "web", now: new Date() }),
      messages, tools: DEMO_TOOLS, runTool,
      model: process.env.DEMO_MODEL || "claude-haiku-5-5",
      maxTokens: 400, maxRounds: 6,
      onText: (delta) => send({ type: "text", delta }),
      onTool: (name) => send({ type: "tool", name }),
      onToolResult: (name, input, out) => { if (out && out.step) send({ type: "step", ...out.step }); },
    });
  });
};
