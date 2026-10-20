// Tools for AIfy's sales call agent. state collects what happened for the call log.
import { store } from "../store.mjs";

const clip = (s, n) => String(s || "").slice(0, n);

export async function isDoNotCall(phone) {
  try { const s = await store("dnc"); return !!(await s.getJSON(phone)); } catch { return false; }
}
export async function addDoNotCall(phone, reason, source) {
  const s = await store("dnc");
  // Kept for 3 years and 14 days, as the CRTC Telemarketing Rules require; the record carries its own date.
  await s.setJSON(phone, { phone, reason: clip(reason, 300), source, at: new Date().toISOString() });
}

export function makeSalesTools({ phone, sendSms, bookingUrl, canTransfer, state }) {
  return async (name, input) => {
    switch (name) {
      case "send_booking_link": {
        if (!bookingUrl) return { data: { sent: false, note: "No booking link configured. Offer to have the team email them, and capture their email in save_notes." } };
        const note = clip(input.note, 120);
        const body = `AIfy Solutions: thanks for the chat${note ? `. ${note}` : ""}. Pick a time for a 15-minute call with our team: ${bookingUrl} Reply STOP to opt out.`;
        const ok = await sendSms(phone, body);
        state.bookingLinkSent = ok;
        return { data: ok ? { sent: true } : { sent: false, note: "The text didn't go through. Offer to have the team email the link instead." } };
      }
      case "save_notes":
        state.notes = Object.fromEntries(Object.entries(input || {}).map(([k, v]) => [k, clip(v, 500)]));
        return { data: { saved: true } };
      case "transfer_to_person":
        state.transfer = { reason: clip(input.reason, 200) };
        return { data: canTransfer
          ? { transferring: true, note: "Tell them in one short sentence you're connecting them to someone on the team now." }
          : { transferring: false, note: "Nobody can take a live transfer right now. Offer to text the booking link and have the team call back." } };
      case "do_not_call":
        await addDoNotCall(phone, input.reason, "sales call");
        state.doNotCall = true;
        return { data: { added: true, note: "Confirm they won't be called again, apologise if it was unwanted, then end the call." } };
      case "end_call":
        state.ended = true; state.summary = { summary: clip(input.summary, 600), outcome: input.outcome };
        return { data: { ok: true } };
      default:
        return { data: { error: "unknown tool" } };
    }
  };
}
