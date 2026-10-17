// AIfy Agent: the sales assistant on every page of aify.solutions. Streams replies (SSE).
// Separate from the dealership demo agent (functions/demo).
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { TOOLS, runTool } from "./tools.mjs";
import { runAgent, sanitizeMessages } from "../../lib/llm.mjs";
import { guard, json, corsHeaders, sseResponse, dailyLimit } from "../../lib/http.mjs";

export const config = { path: "/api/agent" };

export default async (req) => {
  const early = guard(req); if (early) return early;
  const origin = req.headers.get("origin") || "";
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders(origin));
  let body; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, corsHeaders(origin)); }
  const messages = sanitizeMessages(body && body.messages);
  if (!messages) return json({ error: "bad_messages" }, 400, corsHeaders(origin));
  const page = typeof body.page === "string" ? body.page.slice(0, 80) : "";
  const limited = await dailyLimit(req, "agent", Number(process.env.AGENT_DAILY_LIMIT || 150), corsHeaders(origin)); if (limited) return limited;

  return sseResponse(origin, async (send) => {
    await runAgent({
      system: SYSTEM_PROMPT({ page, bookingUrl: process.env.BOOKING_URL || "", now: new Date() }),
      messages, tools: TOOLS, runTool,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      maxTokens: 700, maxRounds: 3,
      onText: (delta) => send({ type: "text", delta }),
      onTool: (name) => send({ type: "tool", name }),
      onToolResult: (name, input, out) => { if (out && out.ui) send({ type: "card", card: out.ui }); },
    });
  });
};
