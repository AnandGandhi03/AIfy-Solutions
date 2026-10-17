// Tools for the Harbour Lane Motors demo. Sample data, except the confirmation text on the phone line,
// which is a real SMS to the caller's own number when Twilio is configured.
// Every tool returns { data } for the model and { step } for the live "behind the scenes" view.

export const DEMO_TOOLS = [
  { name: "check_schedule", description: "Find open service appointment times. Returns up to three open slots and the day's schedule.",
    input_schema: { type: "object", properties: {
      service: { type: "string" }, preferred_day: { type: "string", description: "e.g. Thursday, tomorrow, next week" },
      time_of_day: { type: "string", enum: ["morning", "afternoon", "any"] } }, required: ["service"] } },
  { name: "book_appointment", description: "Book the appointment in one of the open slots from check_schedule.",
    input_schema: { type: "object", properties: {
      customer_name: { type: "string" }, phone: { type: "string" }, vehicle: { type: "string", description: "Year make model" },
      service: { type: "string" }, slot: { type: "string", description: "Exactly as returned by check_schedule" },
      transport: { type: "string", enum: ["waiting", "drop-off", "loaner", "shuttle"] }, notes: { type: "string" } },
      required: ["customer_name", "vehicle", "service", "slot"] } },
  { name: "send_confirmation_text", description: "Text the appointment confirmation to the customer's mobile.",
    input_schema: { type: "object", properties: { phone: { type: "string" }, message: { type: "string", description: "Under 300 characters: date, time, service, vehicle, and what to bring." } }, required: ["message"] } },
  { name: "notify_advisor", description: "Send the service advisor a short note in their queue (new booking, callback request, customer on the way...).",
    input_schema: { type: "object", properties: { summary: { type: "string" }, customer_name: { type: "string" }, vehicle: { type: "string" },
      priority: { type: "string", enum: ["normal", "high"] } }, required: ["summary"] } },
  { name: "lookup_service_info", description: "Look up store information: hours, prices, loaners, shuttle, tire storage, warranty, payment, express service, location.",
    input_schema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
  { name: "check_recalls", description: "Check open safety recalls for a vehicle or VIN.",
    input_schema: { type: "object", properties: { vehicle_or_vin: { type: "string" } }, required: ["vehicle_or_vin"] } },
  { name: "repair_status", description: "Look up the status of a vehicle currently in for service, by customer name or vehicle.",
    input_schema: { type: "object", properties: { customer_name: { type: "string" }, vehicle: { type: "string" } } } },
  { name: "transfer_to_person", description: "Hand the call to a human service advisor.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
  { name: "end_call", description: "End the call after saying goodbye, with a summary for the call log.",
    input_schema: { type: "object", properties: { summary: { type: "string", description: "Two or three sentences: who called, what they needed, what was done." },
      outcome: { type: "string", enum: ["booked", "answered", "status", "transferred", "callback", "other"] },
      follow_up: { type: "string" } }, required: ["summary", "outcome"] } },
];

const KB = [
  { keys: ["hour", "open", "close", "weekend", "saturday", "sunday", "holiday"], answer: "Service hours: Monday to Friday 7:30 AM to 6 PM, Saturday 8 AM to 4 PM, closed Sundays and statutory holidays." },
  { keys: ["oil", "lube", "synthetic", "maintenance", "price", "cost", "how much"], answer: "Full synthetic oil change with multi-point inspection: from $89.95. 8,000 km maintenance package: from $149.95. Prices vary by vehicle; the advisor confirms before any work." },
  { keys: ["tire", "tyre", "swap", "winter", "storage", "season"], answer: "Seasonal tire swap on rims: $79.95. Tire storage: $129 per season, includes cleaning and inspection. Mount and balance new tires: $119.95." },
  { keys: ["brake"], answer: "Brake inspection is free with any service. Front brake pads replacement starts from $289.95 per axle, quoted after inspection." },
  { keys: ["diagnos", "check engine", "warning light", "noise"], answer: "Diagnostic: $149.95, applied to the repair if you go ahead. Book a drop-off so a technician can look at it." },
  { keys: ["align"], answer: "Four-wheel alignment: $139.95." },
  { keys: ["loaner", "rental", "courtesy car"], answer: "Loaner vehicles are available for work over two hours, by reservation, subject to availability. Driver must be 21 or older with a valid licence and insurance." },
  { keys: ["shuttle", "ride", "drive me"], answer: "Free shuttle within 10 km, 8 AM to 4 PM on weekdays." },
  { keys: ["wait", "lounge", "wifi", "coffee"], answer: "Customer lounge with Wi-Fi, coffee and workspaces. Oil changes usually take about an hour." },
  { keys: ["express", "walk", "without appointment", "no appointment"], answer: "Express oil change without an appointment, Monday to Friday 7:30 to 10 AM, first come first served." },
  { keys: ["warrant", "extended"], answer: "Factory warranty and extended warranty work is done here; bring the vehicle in and the advisor checks coverage. Warranty disputes go to the service manager." },
  { keys: ["pay", "card", "financ", "debit", "credit"], answer: "Visa, Mastercard, Amex, debit and service financing on approval. Pay at pickup." },
  { keys: ["where", "address", "location", "direction", "park"], answer: "Harbour Lane Motors is a sample dealership for this demo, so there's no real address. In a real store the agent would give the address and parking directions." },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function vanToday() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return new Date(Date.UTC(g("year"), g("month") - 1, g("day")));
}
const dayLabel = (d) => `${DAYS[d.getUTCDay()]}, ${d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}`;
const TIMES = { weekday: ["7:30 AM", "8:00 AM", "9:00 AM", "10:30 AM", "11:30 AM", "1:00 PM", "2:30 PM", "4:00 PM"], saturday: ["8:00 AM", "9:30 AM", "11:00 AM", "1:30 PM"] };
function seededBusy(d, t) { // deterministic "already booked" pattern so the schedule looks real
  const n = (d.getUTCDate() * 31 + t.length * 7 + t.charCodeAt(0) * 3 + d.getUTCDay()) % 5;
  return n < 2;
}
function pickDay(pref) {
  const base = vanToday();
  const p = String(pref || "").toLowerCase();
  let want = DAYS.findIndex((d) => p.includes(d.toLowerCase()));
  let start = 1;
  if (p.includes("today")) start = 0;
  if (p.includes("next week")) { start = 7 - base.getUTCDay() + 1; want = -1; }
  for (let i = start; i < start + 14; i++) {
    const d = new Date(base); d.setUTCDate(base.getUTCDate() + i);
    if (d.getUTCDay() === 0) continue;
    if (want >= 0 && d.getUTCDay() !== want) continue;
    return d;
  }
  const d = new Date(base); d.setUTCDate(base.getUTCDate() + 1); return d;
}
const isMorning = (t) => /AM/.test(t);
const mask = (ph) => { const d = String(ph || "").replace(/\D/g, ""); return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : "the customer's mobile"; };

export function makeDemoTools(ctx = {}) {
  // ctx: { channel: "web" | "phone", callerPhone?, sendSms?(to, body) }
  const state = ctx.state || { bookings: [] };
  return async function runDemoTool(name, input) {
    switch (name) {
      case "check_schedule": {
        const d = pickDay(input.preferred_day);
        const list = d.getUTCDay() === 6 ? TIMES.saturday : TIMES.weekday;
        const tod = input.time_of_day || "any";
        const slots = list.map((t) => ({ time: t, open: !seededBusy(d, t) }));
        const offered = slots.filter((s) => s.open && (tod === "any" || (tod === "morning") === isMorning(s.time))).slice(0, 3).map((s) => s.time);
        const label = dayLabel(d);
        return {
          data: { day: label, open_slots: offered.map((t) => `${label} at ${t}`), note: offered.length ? undefined : "No openings that day; offer the next day." },
          step: { step: "schedule", title: "Checked the service schedule", day: label, slots: slots.map((s) => ({ time: s.time, status: offered.includes(s.time) ? "offered" : s.open ? "open" : "booked" })) },
        };
      }
      case "book_appointment": {
        const code = "HL-" + String(Math.floor(1000 + Math.random() * 9000));
        const advisor = ["Dana", "Marcus", "Priya"][Math.floor(Math.random() * 3)];
        const b = { ...input, confirmation: code, advisor, bay: "Bay " + (2 + Math.floor(Math.random() * 6)) };
        state.bookings.push(b);
        return {
          data: { confirmed: true, confirmation: code, advisor, slot: input.slot, transport: input.transport || "waiting" },
          step: { step: "booked", title: "Appointment booked", booking: b },
        };
      }
      case "send_confirmation_text": {
        const to = ctx.channel === "phone" ? ctx.callerPhone : input.phone;
        const body = `${String(input.message || "").slice(0, 300)}\n— Harbour Lane Motors (demo by AIfy · aify.solutions/demo)`;
        let real = false;
        if (ctx.channel === "phone" && ctx.sendSms && to) { try { real = await ctx.sendSms(to, body); } catch (e) { console.warn("sms failed", e); } }
        return {
          data: { sent: true, to: mask(to) },
          step: { step: "text", title: real ? "Confirmation text sent" : "Confirmation text sent (simulated)", to: mask(to), body, real },
        };
      }
      case "notify_advisor":
        return { data: { delivered: true }, step: { step: "advisor", title: "Service advisor notified", note: input } };
      case "lookup_service_info": {
        const q = String(input.topic || "").toLowerCase();
        const hits = KB.filter((k) => k.keys.some((w) => q.includes(w)));
        const answer = hits.length ? hits.slice(0, 2).map((h) => h.answer).join(" ") : "Not in the knowledge base. Offer an advisor callback.";
        return { data: { answer, sample_store: true }, step: { step: "kb", title: "Answered from the store's knowledge base", topic: input.topic, answer } };
      }
      case "check_recalls": {
        const v = String(input.vehicle_or_vin || "").toLowerCase();
        const hit = /cr-?v/.test(v) && /2020/.test(v);
        const r = hit ? [{ campaign: "Fuel pump replacement", remedy: "Free, about 2 hours", parts: "In stock" }] : [];
        return { data: { open_recalls: r }, step: { step: "recall", title: hit ? "1 open recall found" : "No open recalls", vehicle: input.vehicle_or_vin, recalls: r } };
      }
      case "repair_status": {
        const v = `${input.vehicle || ""} ${input.customer_name || ""}`.toLowerCase();
        const ready = !/cr-?v|civic/.test(v);
        const data = ready
          ? { status: "Ready for pickup", ready_since: "3:40 PM today", work_done: "Oil and filter, front brake pads, tire rotation", total: "$412.60 including tax", pickup_until: "6 PM today" }
          : { status: "In progress", work: "Fuel pump recall", estimated_ready: "4:30 PM today", total: "$0, covered by recall" };
        return { data, step: { step: "status", title: ready ? "Repair order: ready for pickup" : "Repair order: in progress", who: input.customer_name || input.vehicle, ...data } };
      }
      case "transfer_to_person":
        state.transfer = { reason: input.reason };
        return {
          data: ctx.canTransfer
            ? { transferring: true, note: "The call will be connected to a member of the AIfy team right after you speak. Tell the caller you're connecting them to a person now, in one short sentence." }
            : { transferring: true, note: "Demo: no real transfer happens. Tell the caller an advisor will take it from here." },
          step: { step: "transfer", title: "Handed to a service advisor", reason: input.reason },
        };
      case "end_call":
        state.ended = true; state.summary = input;
        return { data: { ok: true }, step: { step: "summary", title: "Call summary logged", ...input, bookings: state.bookings } };
      default:
        return { data: { error: "unknown tool" } };
    }
  };
}
