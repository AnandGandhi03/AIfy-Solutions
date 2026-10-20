// Twilio webhook for AIfy's outbound sales calls (started by /api/callme). Not the dealership demo line.
//   POST /api/sales-voice?cid=…               call answered / each caller turn
//   POST /api/sales-voice?event=status&cid=…  call finished -> saved as a lead with transcript and notes
import { SALES_PROMPT, SALES_TOOLS, SALES_GREETING, SALES_VOICEMAIL } from "../../lib/sales/prompt.mjs";
import { makeSalesTools } from "../../lib/sales/tools.mjs";
import { runAgent } from "../../lib/llm.mjs";
import { store } from "../../lib/store.mjs";
import { saveLead } from "../../lib/leads.mjs";
import { twiml, say, gatherTo, esc, verifyTwilio, sendSms } from "../../lib/twilio.mjs";

export const config = { path: "/api/sales-voice" };
const MAX_TURNS = 30;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const denied = verifyTwilio(req, params); if (denied) return denied;

  const q = new URL(req.url).searchParams;
  const cid = q.get("cid") || "";
  const calls = await store("sales-calls");
  const st = cid ? await calls.getJSON(cid) : null;
  const from = process.env.SALES_FROM_NUMBER || process.env.DEMO_PHONE_NUMBER;
  const bookingUrl = process.env.BOOKING_URL || "";

  if (q.get("event") === "status") {
    if (st) {
      const status = params.CallStatus || "";
      const answered = status === "completed" && !st.voicemail;
      if (!answered && bookingUrl && !st.textedAfterMiss) {
        await sendSms(st.phone, `AIfy Solutions: sorry we missed you. Pick a time for a 15-minute call with our team: ${bookingUrl} Reply STOP to opt out.`, from);
      }
      await saveLead({
        name: st.name, business: st.business, phone: st.phone, source: "Website call-me (AI sales call)",
        call_status: st.voicemail ? "voicemail" : status, duration_seconds: params.CallDuration,
        outcome: st.summary ? st.summary.outcome : (st.doNotCall ? "do not call" : ""), summary: st.summary ? st.summary.summary : "",
        notes: st.notes, booking_link_sent: !!st.bookingLinkSent, transferred: st.transferred || "", do_not_call: !!st.doNotCall, transcript: st.transcript,
      }, { kind: "sales-call", subject: `AI sales call: ${st.name}${st.business ? `, ${st.business}` : ""} (${st.summary ? st.summary.outcome : st.voicemail ? "voicemail" : status})` });
      await calls.delete(cid);
    }
    return new Response(null, { status: 204 });
  }

  if (!st) return twiml(say("Sorry, something went wrong on our end. Goodbye.") + "<Hangup/>");
  const action = `/api/sales-voice?cid=${cid}`;

  // First request: the call was just answered.
  if (!st.answered) {
    st.answered = true;
    if (String(params.AnsweredBy || "").startsWith("machine") || params.AnsweredBy === "fax") {
      st.voicemail = true;
      await calls.setJSON(cid, st);
      if (bookingUrl) { st.textedAfterMiss = await sendSms(st.phone, `AIfy Solutions: sorry we missed you. Pick a time for a 15-minute call with our team: ${bookingUrl} Reply STOP to opt out.`, from); await calls.setJSON(cid, st); }
      return twiml(say(SALES_VOICEMAIL({ name: st.name })) + "<Hangup/>");
    }
    const greet = SALES_GREETING({ name: st.name });
    st.convo = [{ role: "user", content: "(The person picks up the phone.)" }, { role: "assistant", content: greet }];
    st.transcript.push({ who: "agent", text: greet });
    await calls.setJSON(cid, st);
    return twiml(gatherTo(action, say(greet)));
  }

  const heard = String(params.SpeechResult || "").trim();
  if (!heard) {
    st.silence = (st.silence || 0) + 1;
    await calls.setJSON(cid, st);
    if (st.silence >= 3) return twiml(say("I'll let you go. We'll text you a link to book a time. Goodbye!") + "<Hangup/>");
    return twiml(gatherTo(action, say(st.silence === 1 ? "Sorry, I didn't catch that." : "Are you still there?")));
  }
  st.silence = 0; st.turns = (st.turns || 0) + 1;
  st.transcript.push({ who: "person", text: heard });
  if (st.turns > MAX_TURNS) {
    await calls.setJSON(cid, st);
    return twiml(say("Thanks for all of that. I'll text you the booking link so you can talk to the team. Goodbye!") + "<Hangup/>");
  }

  const transferTo = process.env.TRANSFER_TO_NUMBER || "";
  const state = { bookingLinkSent: st.bookingLinkSent, notes: st.notes };
  const runTool = makeSalesTools({ phone: st.phone, sendSms: (to, body) => sendSms(to, body, from), bookingUrl, canTransfer: !!transferTo, state });
  let reply = "";
  try {
    const { convo, text } = await runAgent({
      system: SALES_PROMPT({ name: st.name, business: st.business, now: new Date(), bookingUrl }),
      messages: st.convo.concat([{ role: "user", content: heard }]),
      tools: SALES_TOOLS, runTool,
      model: process.env.SALES_MODEL || process.env.VOICE_MODEL || "claude-haiku-5-5",
      maxTokens: 260, maxRounds: 4,
    });
    st.convo = convo.slice(-40);
    while (st.convo.length && (st.convo[0].role !== "user" || typeof st.convo[0].content !== "string")) st.convo.shift();
    reply = text.trim();
  } catch (e) {
    console.error("sales agent error", e);
    reply = "Sorry, I'm having trouble on my end. Could you say that again?";
  }
  if (!reply) reply = "Sorry, could you say that again?";
  st.transcript.push({ who: "agent", text: reply });
  Object.assign(st, { bookingLinkSent: state.bookingLinkSent, notes: state.notes });
  if (state.summary) st.summary = state.summary;
  if (state.doNotCall) st.doNotCall = true;
  if (state.transfer) st.transferred = state.transfer.reason || true;
  await calls.setJSON(cid, st);

  if (state.transfer && transferTo) {
    const callerId = from ? ` callerId="${esc(from)}"` : "";
    return twiml(say(reply) + `<Dial timeout="25"${callerId}>${esc(transferTo)}</Dial>` + say("Sorry, nobody could pick up just now. We'll text you a link to book a time. Goodbye!") + "<Hangup/>");
  }
  return twiml(state.ended || state.doNotCall ? say(reply) + "<Hangup/>" : gatherTo(action, say(reply)));
};
