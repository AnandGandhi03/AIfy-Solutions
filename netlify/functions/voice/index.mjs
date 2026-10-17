// Real phone line for the dealership demo, via Twilio (speech recognition + text-to-speech, no extra vendor).
// Twilio number settings:  "A call comes in" -> Webhook  POST https://aify.solutions/api/voice
//                           "Call status changes" ->      POST https://aify.solutions/api/voice?event=status
// Env: ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (also verifies Twilio's signature),
//      optional TWILIO_VOICE (default Polly.Joanna-Neural), VOICE_MODEL (default claude-haiku-5-5), PUBLIC_BASE_URL,
//      TRANSFER_TO_NUMBER (your cell, e.g. +16045551234: callers who ask for a person are put through to it).
import crypto from "node:crypto";
import { DEMO_PROMPT, DEMO_GREETING } from "../../lib/dealer/prompt.mjs";
import { DEMO_TOOLS, makeDemoTools } from "../../lib/dealer/tools.mjs";
import { runAgent } from "../../lib/llm.mjs";
import { store } from "../../lib/store.mjs";
import { saveLead } from "../../lib/leads.mjs";

export const config = { path: "/api/voice" };

const MAX_TURNS = 30;
const VOICE = () => process.env.TWILIO_VOICE || "Polly.Joanna-Neural";
const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "content-type": "text/xml" } });
const say = (text) => `<Say voice="${esc(VOICE())}">${esc(text)}</Say>`;
const gather = (inner) => `<Gather input="speech" action="/api/voice" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true">${inner}</Gather>`;

export function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}
function publicUrl(req) {
  const u = new URL(req.url);
  return process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") + u.pathname + u.search : u.toString();
}
async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM_NUMBER || process.env.DEMO_PHONE_NUMBER;
  if (!sid || !tok || !from || !to) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!r.ok) console.warn("twilio sms", r.status, await r.text().catch(() => ""));
  return r.ok;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const expected = twilioSignature(token, publicUrl(req), params);
    const got = req.headers.get("x-twilio-signature") || "";
    if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
      console.warn("bad twilio signature");
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    console.warn("TWILIO_AUTH_TOKEN not set: Twilio signature not verified");
  }

  const calls = await store("calls");
  const sid = params.CallSid || "unknown";
  const event = new URL(req.url).searchParams.get("event");

  if (event === "status") {
    if (params.CallStatus === "completed") {
      const st = await calls.getJSON(sid);
      if (st) {
        await saveLead({
          phone: params.From || st.from, source: "Demo phone line", duration_seconds: params.CallDuration,
          summary: st.summary ? st.summary.summary : "", outcome: st.summary ? st.summary.outcome : (st.transferred ? "transferred to a person" : ""),
          bookings: st.bookings, transcript: st.transcript,
        }, { kind: "demo-call", subject: `Demo line call from ${params.From || "unknown number"}${st.bookings && st.bookings.length ? " (booked a service)" : ""}` });
        await calls.delete(sid);
      }
    }
    return new Response(null, { status: 204 });
  }

  let st = await calls.getJSON(sid);
  if (!st) {
    if (!process.env.ANTHROPIC_API_KEY) return twiml(say("Sorry, this demo line isn't switched on yet. Please visit aify dot solutions.") + "<Hangup/>");
    st = { from: params.From || "", startedAt: new Date().toISOString(), convo: [{ role: "user", content: "(The call connects.)" }, { role: "assistant", content: DEMO_GREETING.phone }], transcript: [{ who: "agent", text: DEMO_GREETING.phone }], bookings: [], silence: 0, turns: 0 };
    await calls.setJSON(sid, st);
    return twiml(gather(say(DEMO_GREETING.phone)));
  }

  const heard = String(params.SpeechResult || "").trim();
  if (!heard) {
    st.silence = (st.silence || 0) + 1;
    await calls.setJSON(sid, st);
    if (st.silence >= 3) return twiml(say("I'll let you go for now. Thanks for calling Harbour Lane Motors. Goodbye!") + "<Hangup/>");
    return twiml(gather(say(st.silence === 1 ? "Sorry, I didn't catch that. How can I help?" : "Are you still there?")));
  }
  st.silence = 0; st.turns = (st.turns || 0) + 1;
  st.transcript.push({ who: "caller", text: heard });
  if (st.turns > MAX_TURNS) {
    await calls.setJSON(sid, st);
    return twiml(say("We've covered a lot! To see how this would work for your store, visit aify dot solutions. Thanks for calling, goodbye!") + "<Hangup/>");
  }

  const toolState = { bookings: st.bookings || [] };
  const transferTo = process.env.TRANSFER_TO_NUMBER || "";
  const runTool = makeDemoTools({ channel: "phone", callerPhone: st.from, sendSms, state: toolState, canTransfer: !!transferTo });
  let reply = "";
  try {
    const { convo, text } = await runAgent({
      system: DEMO_PROMPT({ channel: "phone", callerPhone: st.from, now: new Date() }),
      messages: st.convo.concat([{ role: "user", content: heard }]),
      tools: DEMO_TOOLS, runTool,
      model: process.env.VOICE_MODEL || "claude-haiku-5-5",
      maxTokens: 260, maxRounds: 4,
    });
    st.convo = convo.slice(-40);
    while (st.convo.length && (st.convo[0].role !== "user" || typeof st.convo[0].content !== "string")) st.convo.shift();
    reply = text.trim();
  } catch (e) {
    console.error("voice agent error", e);
    reply = "Sorry, I'm having trouble on my end. Could you say that again?";
  }
  if (!reply) reply = "Sorry, could you say that again?";
  st.transcript.push({ who: "agent", text: reply });
  st.bookings = toolState.bookings;
  if (toolState.summary) st.summary = toolState.summary;
  if (toolState.transfer) st.transferred = toolState.transfer.reason || true;
  await calls.setJSON(sid, st);
  if (toolState.transfer && transferTo) {
    // Warm hand-off to a real person (your cell). If nobody picks up, the caller hears a callback promise.
    const callerId = process.env.DEMO_PHONE_NUMBER ? ` callerId="${esc(process.env.DEMO_PHONE_NUMBER)}"` : "";
    return twiml(say(reply) + `<Dial timeout="25"${callerId}>${esc(transferTo)}</Dial>` + say("Sorry, nobody could pick up just now. We'll call you back shortly. Goodbye!") + "<Hangup/>");
  }
  return twiml(toolState.ended ? say(reply) + "<Hangup/>" : gather(say(reply)));
};
