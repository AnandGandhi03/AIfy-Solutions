/* AIfy live dealership demo: browser voice call + "what your team sees" view + lead form.
   Talks to /api/demo (the Harbour Lane Motors service-desk agent). Separate from AIfy Agent. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var callEl = $("#demo-call"); if (!callEl) return;
  var ENDPOINT = "/api/demo";
  var GREETING = "Thanks for calling Harbour Lane Motors service. I'm the AI assistant, how can I help you today?";

  var ui = {
    status: $("[data-demo-status-text]"), light: $("[data-demo-light]"), timer: $("[data-demo-timer]"),
    scroll: $("[data-demo-scroll]"), log: $("[data-demo-log]"), intro: $("[data-demo-intro]"),
    start: $("[data-demo-start]"), talk: $("[data-demo-talk]"), talkLabel: $("[data-demo-talk-label]"), end: $("[data-demo-end]"),
    type: $("[data-demo-type]"), input: $("[data-demo-input]"), note: $("[data-demo-note]"),
    feed: $("[data-demo-feed]"), steps: $("[data-demo-steps]"), form: $("[data-demo-form]"), formMsg: $("[data-demo-form-msg]"), after: $("[data-demo-after]")
  };
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis || null;

  var call = null; // { messages, startedAt, timerId, busy, ended, summary, bookings, firstUser }

  // ---------- config (real phone line number, if set) ----------
  fetch(ENDPOINT, { method: "GET" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    if (!c) return;
    if (c.greeting) GREETING = c.greeting;
    if (c.phone) {
      var a = $("[data-demo-phone]"), w = $("[data-demo-phone-wrap]");
      if (a && w) { a.textContent = prettyPhone(c.phone); a.href = "tel:" + c.phone; w.hidden = false; }
    }
  }).catch(function () {});
  function prettyPhone(p) { var d = String(p).replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : p; }

  if (!SR) {
    ui.note.textContent = "Voice input isn't available in this browser, so type what you'd say (replies are still spoken where supported). Sample store and data: nothing is really booked, texts are simulated.";
  }

  // ---------- call lifecycle ----------
  ui.start.addEventListener("click", startCall);
  ui.end.addEventListener("click", function () { endCall("You ended the call."); });
  ui.talk.addEventListener("click", function () {
    if (!call || call.ended) return;
    if (listening) { stopListening(); return; }
    stopSpeaking(); listen();
  });
  ui.type.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = ui.input.value.trim(); if (!v) return;
    ui.input.value = "";
    if (!call || call.ended) { startCall(v); return; }
    stopListening(); stopSpeaking(); userSays(v);
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-say]"); if (!b) return;
    var v = b.getAttribute("data-say");
    if (!call || call.ended) startCall(v); else { stopListening(); stopSpeaking(); userSays(v); }
  });

  function startCall(firstLine) {
    if (call && !call.ended) return;
    unlockSpeech();
    resetViews();
    call = { messages: [{ role: "assistant", content: GREETING }], startedAt: 0, busy: false, ended: false, summary: null, bookings: [], firstUser: "" };
    setStatus("Ringing…", "#9E9EA3");
    ui.start.hidden = true; ui.end.hidden = false; ui.talk.hidden = !SR;
    callEl.classList.remove("dm-idle");
    ring(2).then(function () {
      if (!call || call.ended) return;
      call.startedAt = Date.now();
      call.timerId = setInterval(tick, 500); tick();
      setStatus("Connected", "#1F5BFF");
      step("answered", "done", "Answered on the first ring at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      step("understood", "active");
      line("agent", GREETING);
      speak(GREETING, true);
      if (typeof firstLine === "string" && firstLine) { afterSpeech(function () { userSays(firstLine); }); }
      else afterSpeech(function () { if (SR) listen(); });
    });
  }

  function endCall(reason) {
    if (!call || call.ended) return;
    call.ended = true;
    stopListening(); clearInterval(call.timerId);
    setStatus("Call ended", "#5C5C5C");
    callEl.classList.add("dm-idle");
    ui.start.hidden = false; ui.start.lastChild.textContent = "Call again"; ui.end.hidden = true; ui.talk.hidden = true;
    if (reason) note(reason);
    // steps that never happened on this call
    $$(".dm-step", ui.steps).forEach(function (li) {
      if (!li.classList.contains("is-done")) { li.classList.remove("is-active"); li.classList.add("is-skipped"); li.querySelector("[data-detail]").textContent = "Not needed on this call"; }
    });
    if (ui.after) ui.after.hidden = false;
    var hint = el("div", "dm-card is-dark");
    hint.innerHTML = "<h3>Want this for your store?</h3><p>We'll build it around your hours, services and scheduler.</p>";
    var a = el("a"); a.href = "#get-this"; a.textContent = "Book a 15-minute call"; a.style.cssText = "align-self:flex-start;text-decoration:none;background:#FFFFFF;color:#0A0A0A;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600";
    hint.appendChild(a); addCard(hint);
  }

  function tick() {
    if (!call || !call.startedAt) return;
    var s = Math.floor((Date.now() - call.startedAt) / 1000);
    ui.timer.textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60);
    if (s > 600) endCall("Demo calls end after 10 minutes.");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function setStatus(t, c) { ui.status.textContent = t; ui.light.style.background = c; }

  // ---------- conversation ----------
  function userSays(text) {
    if (!call || call.ended || call.busy) return;
    text = String(text).slice(0, 600);
    if (!call.firstUser) call.firstUser = text;
    line("caller", text);
    call.messages.push({ role: "user", content: text });
    call.busy = true; setStatus("Thinking…", "#1F5BFF");
    var agentLine = null, said = "", spokenUpTo = 0;
    var thinking = line("agent", "…"); thinking.classList.add("dm-interim");

    fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: call.messages }) })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error(res.status === 503 ? "not_configured" : res.status === 429 ? "rate_limited" : "http_" + res.status);
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              var raw = buf.slice(0, i); buf = buf.slice(i + 2);
              if (raw.indexOf("data:") !== 0) continue;
              var ev; try { ev = JSON.parse(raw.slice(5)); } catch (x) { continue; }
              handle(ev);
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        var msg = String(err.message) === "not_configured"
          ? "The live demo isn't switched on yet. Email info@aify.solutions and we'll show you on a call."
          : String(err.message) === "rate_limited" ? "You've reached today's demo limit. Book a call and we'll walk you through it live."
          : "Sorry, the line dropped for a moment. Please try that again.";
        if (thinking.parentNode) thinking.remove();
        line("agent", msg); speak(msg, true);
      })
      .then(function () {
        if (thinking.parentNode) thinking.remove();
        flushSpeech(true);
        if (said.trim()) call.messages.push({ role: "assistant", content: said.trim() });
        else call.messages.pop(); // nothing came back: let them try again
        call.busy = false;
        if (call.ended) return;
        setStatus("Connected", "#1F5BFF");
        if (call.wantsEnd) { afterSpeech(function () { endCall(""); }); return; }
        afterSpeech(function () { if (SR && !call.ended) listen(); });
      });

    function handle(ev) {
      if (ev.type === "text") {
        if (!agentLine && !ev.delta.trim()) { said += ev.delta; return; }
        if (thinking.parentNode) thinking.remove();
        if (!agentLine) { agentLine = line("agent", ""); agentLine.startAt = said.length; }
        said += ev.delta;
        agentLine.querySelector("span").textContent = said.slice(agentLine.startAt).trim();
        scrollLog();
        flushSpeech(false);
      } else if (ev.type === "tool") {
        setStatus(TOOL_STATUS[ev.name] || "Working…", "#1F5BFF");
        if (agentLine) { flushSpeech(true); agentLine = null; said += " "; }
        markActive(ev.name);
      } else if (ev.type === "step") {
        onStep(ev);
      } else if (ev.type === "error") {
        if (thinking.parentNode) thinking.remove();
        line("agent", ev.message);
      }
    }
    function flushSpeech(all) {
      var pending = said.slice(spokenUpTo);
      var m = all ? pending : (pending.match(/^[\s\S]*[.!?](?=\s)/) || [""])[0];
      if (m && m.trim()) { spokenUpTo += m.length; speak(m.trim()); }
    }
  }

  var TOOL_STATUS = { check_schedule: "Checking the schedule…", book_appointment: "Booking…", send_confirmation_text: "Texting the customer…", notify_advisor: "Briefing the advisor…", lookup_service_info: "Looking it up…", check_recalls: "Checking recalls…", repair_status: "Checking the repair order…", transfer_to_person: "Transferring…", end_call: "Wrapping up…" };
  var TOOL_STEP = { check_schedule: "schedule", book_appointment: "booked", send_confirmation_text: "text", notify_advisor: "advisor", end_call: "summary" };
  function markActive(tool) { var s = TOOL_STEP[tool]; if (s) step(s, "active"); }

  // ---------- behind the scenes ----------
  function resetViews() {
    ui.log.innerHTML = "";
    $$("[data-demo-example]").forEach(function (n) { n.remove(); });
    ui.feed.innerHTML = "";
    ui.timer.textContent = "00:00";
    $$(".dm-step", ui.steps).forEach(function (li) {
      li.classList.remove("is-done", "is-active", "is-skipped");
      li.querySelector("[data-detail]").textContent = li.getAttribute("data-default") || li.querySelector("[data-detail]").textContent;
    });
  }
  $$(".dm-step", ui.steps).forEach(function (li) { li.setAttribute("data-default", li.querySelector("[data-detail]").textContent); });

  function step(key, state, detail) {
    var li = $('.dm-step[data-step="' + key + '"]', ui.steps); if (!li) return;
    if (li.classList.contains("is-done") && state === "active") return;
    li.classList.remove("is-active", "is-skipped");
    li.classList.add(state === "done" ? "is-done" : "is-active");
    if (detail) li.querySelector("[data-detail]").textContent = detail;
  }
  function understood(label) { var li = $('.dm-step[data-step="understood"]', ui.steps); if (li && li.classList.contains("is-done")) return; step("understood", "done", label); }

  function onStep(s) {
    var c;
    if (s.step === "schedule") {
      understood("Wants to book service");
      step("schedule", "done", s.day + ": " + s.slots.filter(function (x) { return x.status === "offered"; }).length + " openings offered");
      c = card("Service schedule", s.day);
      var row = el("div", "dm-slots");
      s.slots.forEach(function (x) { var p = el("span", "dm-slot" + (x.status === "booked" ? " is-booked" : x.status === "offered" ? " is-offered" : "")); p.textContent = x.time; p.setAttribute("data-time", x.time); row.appendChild(p); });
      c.appendChild(row); addCard(c); lastSlots = row;
    } else if (s.step === "booked") {
      var b = s.booking || {};
      understood("Wants to book service");
      step("booked", "done", (b.slot || "") + " · " + (b.service || ""));
      if (lastSlots) $$(".dm-slot", lastSlots).forEach(function (p) { if (b.slot && b.slot.indexOf(p.getAttribute("data-time")) >= 0) { p.className = "dm-slot is-picked"; } });
      c = card("Appointment booked", "Confirmation " + (b.confirmation || ""), true);
      c.appendChild(rows([["Customer", b.customer_name], ["Vehicle", b.vehicle], ["Service", b.service], ["When", b.slot], ["Transport", b.transport || "waiting"], ["Advisor", b.advisor && (b.advisor + " · " + (b.bay || ""))]]));
      addCard(c); call && call.bookings.push(b);
    } else if (s.step === "text") {
      step("text", "done", "To " + s.to + (s.real ? "" : " (simulated in this demo)"));
      c = card("Text message", "To " + s.to);
      var sms = el("div", "dm-sms"); sms.textContent = s.body; c.appendChild(sms); addCard(c);
    } else if (s.step === "advisor") {
      var n = s.note || {};
      step("advisor", "done", n.summary ? n.summary.slice(0, 90) : "Note added");
      c = card("Advisor queue", n.priority === "high" ? "High priority" : "New note");
      var p = el("p"); p.textContent = n.summary || ""; c.appendChild(p); addCard(c);
    } else if (s.step === "kb") {
      understood("Question: " + (s.topic || "store info"));
      c = card("Answered a question", "Knowledge base");
      var q = el("p"); q.innerHTML = "<b style='color:#0A0A0A;font-weight:600'></b>"; q.firstChild.textContent = cap(s.topic || ""); c.appendChild(q);
      var a = el("p"); a.textContent = s.answer || ""; c.appendChild(a); addCard(c);
    } else if (s.step === "recall") {
      understood("Recall check");
      c = card(s.title, s.vehicle || "Recall lookup", (s.recalls || []).length === 0);
      var rp = el("p"); rp.textContent = (s.recalls || []).length ? s.recalls.map(function (r) { return r.campaign + " · " + r.remedy + " · parts " + r.parts.toLowerCase(); }).join("; ") : "Checked against the manufacturer recall list."; c.appendChild(rp); addCard(c);
    } else if (s.step === "status") {
      understood("Checking on a repair");
      c = card(s.title, s.who || "Repair order", s.status === "Ready for pickup");
      c.appendChild(rows([["Status", s.status], ["Work", s.work_done || s.work], ["Total", s.total], [s.pickup_until ? "Pickup until" : "Ready by", s.pickup_until || s.estimated_ready]]));
      addCard(c);
    } else if (s.step === "transfer") {
      understood("Needs a person");
      c = card("Handed to an advisor", "Warm transfer");
      var tp = el("p"); tp.textContent = (s.reason || "") + ". In a real store, the call would ring through to an advisor with this note."; c.appendChild(tp); addCard(c);
    } else if (s.step === "summary") {
      step("summary", "done", "Outcome: " + (s.outcome || "logged"));
      if (call) { call.summary = s; call.wantsEnd = true; }
      c = el("div", "dm-card is-dark");
      var h = el("div", "dm-card-h"); h.innerHTML = "<span style='color:#9E9EA3'>Call log</span>"; var tag = el("span", "dm-tag is-blue"); tag.textContent = cap(s.outcome || "logged"); h.appendChild(tag); c.appendChild(h);
      var h4 = el("h3"); h4.textContent = "Call summary"; c.appendChild(h4);
      var sp = el("p"); sp.textContent = s.summary || ""; c.appendChild(sp);
      if (s.follow_up) { var fp = el("p"); fp.textContent = "Follow-up: " + s.follow_up; c.appendChild(fp); }
      addCard(c);
      var f = ui.form && ui.form.querySelector("[name=notes]");
      if (f && !f.value) f.placeholder = "Anything we should know?";
    }
  }
  var lastSlots = null;
  function card(title, meta, check) {
    var c = el("div", "dm-card");
    var h = el("div", "dm-card-h"); var m = el("span"); m.textContent = meta || ""; h.appendChild(m);
    var t = el("span", "dm-tag"); t.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); h.appendChild(t);
    c.appendChild(h);
    var h4 = el("h3");
    if (check) h4.innerHTML = '<span style="width:20px;height:20px;border-radius:99px;background:#1F5BFF;display:inline-flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>';
    h4.appendChild(document.createTextNode(title)); c.appendChild(h4);
    return c;
  }
  function rows(pairs) {
    var dl = el("dl", "dm-rows"); dl.style.margin = "0";
    pairs.forEach(function (p) { if (!p[1]) return; var dt = el("dt"); dt.textContent = p[0]; var dd = el("dd"); dd.textContent = p[1]; dl.appendChild(dt); dl.appendChild(dd); });
    return dl;
  }
  function addCard(c) { ui.feed.appendChild(c); ui.feed.scrollTop = ui.feed.scrollHeight; }

  // ---------- transcript ----------
  function line(who, text) {
    if (ui.intro && ui.intro.parentNode) ui.intro.remove();
    var d = el("div", "dm-line " + (who === "agent" ? "dm-agent" : "dm-caller"));
    var s = el("small"); s.textContent = who === "agent" ? "AI service desk" : "You (customer)";
    var t = el("span"); t.textContent = text;
    d.appendChild(s); d.appendChild(t); ui.log.appendChild(d); scrollLog();
    return d;
  }
  function note(text) { var d = el("div", "dm-line dm-interim"); var t = el("span"); t.textContent = text; d.appendChild(t); ui.log.appendChild(d); scrollLog(); }
  function scrollLog() { ui.scroll.scrollTop = ui.scroll.scrollHeight; }

  // ---------- voice out ----------
  var speakQueue = 0, speechWaiters = [], speechDeadline = 0, deadlineTimer = null;
  function pickVoice() {
    if (!synth) return null;
    var vs = synth.getVoices().filter(function (v) { return /^en(-|_)/i.test(v.lang); });
    var pref = ["Google US English", "Samantha", "Microsoft Aria Online", "Microsoft Jenny Online", "Microsoft Aria", "Ava", "Allison", "Karen", "Google UK English Female"];
    for (var i = 0; i < pref.length; i++) for (var j = 0; j < vs.length; j++) if (vs[j].name.indexOf(pref[i]) >= 0) return vs[j];
    return vs[0] || null;
  }
  function unlockSpeech() { if (synth) { try { synth.cancel(); var u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); } catch (e) {} } }
  function speak(text, isWhole) {
    if (!synth || !text) { return; }
    var u = new SpeechSynthesisUtterance(text.replace(/\bHL-(\d)/g, "H L $1"));
    var v = pickVoice(); if (v) u.voice = v; u.rate = 1.04; u.pitch = 1;
    speakQueue++; callEl.classList.remove("dm-listening");
    // Some browsers never fire onend; never let the call stall waiting for it.
    speechDeadline = Math.max(speechDeadline, Date.now()) + 900 + text.length * 80;
    u.onend = u.onerror = function () { speakQueue = Math.max(0, speakQueue - 1); if (!speakQueue) drain(); };
    synth.speak(u);
  }
  function stopSpeaking() { if (synth) { try { synth.cancel(); } catch (e) {} } speakQueue = 0; drain(); }
  function afterSpeech(fn) {
    if (!synth || (!speakQueue && !synth.speaking && !synth.pending)) { setTimeout(fn, 250); return; }
    speechWaiters.push(fn);
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(function () { if (speechWaiters.length) { speakQueue = 0; drain(); } }, Math.max(0, speechDeadline - Date.now()) + 300);
  }
  function drain() { clearTimeout(deadlineTimer); speechDeadline = 0; var w = speechWaiters; speechWaiters = []; w.forEach(function (f) { setTimeout(f, 200); }); }

  // ---------- voice in ----------
  var rec = null, listening = false, micDenied = false;
  function listen() {
    if (!SR || micDenied || !call || call.ended || call.busy || listening) return;
    rec = new SR(); rec.lang = "en-CA"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    var interim = null, finalText = "";
    rec.onresult = function (e) {
      var t = "", f = "";
      for (var i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) f += e.results[i][0].transcript; else t += e.results[i][0].transcript; }
      finalText = f;
      var show = (f + " " + t).trim();
      if (!interim) { interim = line("caller", show); interim.classList.add("dm-interim"); } else interim.querySelector("span").textContent = show;
      scrollLog();
    };
    rec.onerror = function (e) {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") { micDenied = true; note(e.error === "audio-capture" ? "No microphone found. Type below instead; replies are still spoken." : "Microphone blocked. Allow it in your browser settings, or type below."); ui.talk.hidden = true; }
    };
    rec.onend = function () {
      listening = false; callEl.classList.remove("dm-listening"); ui.talkLabel.textContent = "Tap to talk";
      if (interim) interim.remove();
      var v = finalText.trim();
      if (v && call && !call.ended) userSays(v);
      else if (call && !call.ended && !call.busy) setStatus("Connected · tap to talk", "#1F5BFF");
    };
    try { rec.start(); listening = true; callEl.classList.add("dm-listening"); ui.talkLabel.textContent = "Listening… tap to stop"; setStatus("Listening…", "#FFFFFF"); } catch (e) { listening = false; }
  }
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch (e) {} } }

  // ---------- ring tone ----------
  function ring(times) {
    return new Promise(function (resolve) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { setTimeout(resolve, 900); return; }
      try {
        var ac = new AC(), t = ac.currentTime, g = ac.createGain(); g.gain.value = 0.0001; g.connect(ac.destination);
        [440, 480].forEach(function (f) { var o = ac.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + times * 1.4); });
        for (var i = 0; i < times; i++) { var s = t + i * 1.4; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.05, s + 0.05); g.gain.setValueAtTime(0.05, s + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.85); }
        setTimeout(function () { try { ac.close(); } catch (e) {} resolve(); }, times * 1400 - 400);
      } catch (e) { setTimeout(resolve, 900); }
    });
  }

  // ---------- lead form ----------
  if (ui.form) ui.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(ui.form), data = {};
    fd.forEach(function (v, k) { data[k] = v; });
    data.source = "Live demo page"; data.page = "demo";
    if (call && call.summary) data.demo_summary = (call.summary.summary || "") + (call.bookings.length ? " | Booked: " + call.bookings.map(function (b) { return b.service + " " + b.slot; }).join(", ") : "");
    var btn = ui.form.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
    fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j && x.j.error || "error");
        ui.form.innerHTML = '<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:12px;padding:12px 0"><span style="width:44px;height:44px;border-radius:99px;background:#1F5BFF;display:inline-flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span><h3 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em">Thanks, we\'ll be in touch.</h3><p style="margin:0;font-size:16px;line-height:1.55;color:#5C5C5C">We reply within one business day to set up your 15-minute call.</p></div>';
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = "Book my call"; ui.formMsg.textContent = String(err.message) === "error" ? "Couldn't send just now. Please email info@aify.solutions." : err.message; ui.formMsg.style.color = "#0A0A0A"; });
  });

  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = function () {};
})();
