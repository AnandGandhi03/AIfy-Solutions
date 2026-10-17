// Minimal Anthropic Messages API client: streaming, tool-use loop. No SDK needed.
const API = "https://api.anthropic.com/v1/messages";

export async function streamTurn({ system, messages, tools, model, maxTokens = 700, onText }) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, tools, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const blocks = [];
  let stopReason = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === "content_block_start") {
        blocks[ev.index] = ev.content_block.type === "tool_use"
          ? { type: "tool_use", id: ev.content_block.id, name: ev.content_block.name, _json: "" }
          : { type: "text", text: "" };
      } else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index];
        if (!b) continue;
        if (ev.delta.type === "text_delta") { b.text += ev.delta.text; onText && onText(ev.delta.text); }
        else if (ev.delta.type === "input_json_delta") b._json += ev.delta.partial_json;
      } else if (ev.type === "content_block_stop") {
        const b = blocks[ev.index];
        if (b && b.type === "tool_use") { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; } delete b._json; }
      } else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        throw new Error(`anthropic stream error: ${JSON.stringify(ev.error)}`);
      }
    }
  }
  return { content: blocks.filter(Boolean).filter((b) => !(b.type === "text" && !b.text)), stopReason };
}

// Runs the model, executes tools, repeats. Returns the full conversation and all text written.
export async function runAgent({ system, messages, tools, runTool, model, maxTokens, maxRounds = 4, onText, onTool, onToolResult }) {
  const convo = messages.slice();
  let text = "";
  for (let round = 0; round <= maxRounds; round++) {
    const { content, stopReason } = await streamTurn({
      system, messages: convo, tools, model, maxTokens,
      onText: (d) => { text += d; onText && onText(d); },
    });
    if (content.length) convo.push({ role: "assistant", content });
    if (stopReason !== "tool_use") break;
    const results = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      onTool && onTool(block.name, block.input);
      let out;
      try { out = await runTool(block.name, block.input || {}); }
      catch (e) { out = { data: { error: String((e && e.message) || e) } }; }
      onToolResult && onToolResult(block.name, block.input, out);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out && out.data !== undefined ? out.data : out) });
    }
    convo.push({ role: "user", content: results });
    if (text && !/\s$/.test(text)) { text += " "; onText && onText(" "); }
  }
  return { convo, text };
}

// Accepts [{role, content: string}] from the browser; returns clean alternating turns ending on user.
export function sanitizeMessages(msgs, { maxTurns = 30, maxChars = 1200 } = {}) {
  if (!Array.isArray(msgs) || !msgs.length) return null;
  const out = [];
  for (const m of msgs.slice(-maxTurns)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const c = m.content.trim().slice(0, m.role === "user" ? maxChars : 4000);
    if (!c) continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n\n" + c;
    else out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}
