/* AIfy website agent widget. Include with:
   <link rel="stylesheet" href="/agent/agent.css"><script src="/agent/agent.js" defer data-endpoint="/api/agent"></script>
   Open from any element: <button data-aify-agent data-aify-prompt="I'd like to try the dealership demo">…</button>
   Or from JS: window.AIfyAgent.open({ prompt: "…" }) */
(function () {
  "use strict";
  if (window.AIfyAgent) return;
  var script = document.currentScript;
  var ENDPOINT = (script && script.getAttribute("data-endpoint")) || "/api/agent";
  var KEY = "aify-agent-v1";
  var DEMO_URL = "/demo";
  var GREETING = "Hi, I'm AIfy Agent. Ask me anything about what we build and how it would work for your business, or I can set up a call with the team.";
  var CHIPS = [
    { label: "Try the live demo", href: DEMO_URL, primary: true },
    { label: "What does AIfy build?", prompt: "What does AIfy build?" },
    { label: "How does pricing work?", prompt: "How does pricing work?" },
    { label: "Book a call", prompt: "I'd like to book a call with the team." }
  ];
  var CURSOR = '<svg class="aia-cursor" viewBox="1440 -1560 420 1710" aria-hidden="true"><rect x="1580" y="-1504" width="140" height="1598" fill="#1F5BFF"/><rect x="1440" y="-1560" width="420" height="112" rx="40" fill="#1F5BFF"/><rect x="1440" y="38" width="420" height="112" rx="40" fill="#1F5BFF"/></svg>';
  var ICON = {
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    speaker: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    reset: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>',
    mic: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/></svg>',
    send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
  };
  var TOOL_LABEL = { capture_lead: "Sending your details to the team" };

  // ---- state (kept for the browser tab so it survives page changes) ----
  var state = load() || { open: false, voice: false, items: [] }; // items: {t:'user'|'bot'|'card'|'err', text?, card?}
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // ---- DOM ----
  var root = el("div", "aia");
  root.innerHTML =
    '<button type="button" class="aia-launch" aria-label="Ask AIfy Agent" aria-haspopup="dialog" aria-expanded="false"><span class="aia-avatar">' + CURSOR + '</span><span>Ask AIfy</span><span class="aia-live" aria-hidden="true"></span></button>' +
    '<section class="aia-panel" role="dialog" aria-modal="false" aria-label="Chat with AIfy Agent" hidden>' +
      '<header class="aia-head"><span class="aia-avatar">' + CURSOR + '</span><span class="aia-title"><b>AIfy Agent</b><span><i aria-hidden="true"></i>AI assistant · replies instantly</span></span>' +
        '<button type="button" class="aia-icon aia-voice" aria-pressed="false" title="Read replies aloud" aria-label="Read replies aloud">' + ICON.speaker + '</button>' +
        '<button type="button" class="aia-icon aia-reset" title="Start over" aria-label="Start a new conversation">' + ICON.reset + '</button>' +
        '<button type="button" class="aia-icon aia-close" title="Close" aria-label="Close chat">' + ICON.close + '</button></header>' +
      '<div class="aia-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<form class="aia-foot"><div class="aia-compose"><label class="aia-sr" for="aia-input">Message AIfy</label>' +
        '<textarea id="aia-input" rows="1" maxlength="1200" placeholder="Ask about AIfy…" autocomplete="off"></textarea>' +
        '<button type="button" class="aia-icon aia-mic" title="Speak" aria-label="Speak your message" hidden>' + ICON.mic + '</button>' +
        '<button type="submit" class="aia-send" aria-label="Send" disabled>' + ICON.send + '</button></div>' +
        '<p class="aia-note">AIfy Agent is an AI assistant. Please don\'t share sensitive information.</p></form>' +
    '</section>';
  var $ = function (s) { return root.querySelector(s); };
  var launch = $(".aia-launch"), panel = $(".aia-panel"), log = $(".aia-log"), form = $(".aia-foot"), input = $("textarea"), sendBtn = $(".aia-send"), micBtn = $(".aia-mic"), voiceBtn = $(".aia-voice");

  // An element with [data-aify-embed] (the Home page's "Talk to our agent" section) hosts the chat inline.
  var embed = null, dockWrap = null, placeholder = null, docked = false;
  function mount() {
    if (document.body.hasAttribute("data-agent-compact")) root.classList.add("aia-compact");
    document.body.appendChild(root); render(); wireTriggers(document);
    embed = document.querySelector("[data-aify-embed]");
    if (embed) {
      embed.innerHTML = "";
      dockWrap = el("div", "aia aia-dock"); embed.appendChild(dockWrap);
      placeholder = el("div", "aia-placeholder");
      placeholder.innerHTML = "<span>The chat is open in the corner.</span>";
      var back = el("button", "aia-chip"); back.type = "button"; back.textContent = "Bring it back here";
      back.addEventListener("click", function () { dock(true); });
      placeholder.appendChild(back);
    }
    if (state.open) show(false); else if (embed) dock(false);
  }
  function dock(focusIt) {
    if (!embed) return;
    docked = true; state.open = false; save();
    panel.classList.add("aia-docked"); dockWrap.appendChild(panel);
    if (placeholder.parentNode) placeholder.remove();
    panel.hidden = false; launch.hidden = false; launch.setAttribute("aria-expanded", "false");
    scroll();
    if (focusIt) {
      embed.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      if (!matchMedia("(max-width:520px)").matches) setTimeout(function () { input.focus({ preventScroll: true }); }, 350);
    }
  }
  function embedInView() {
    if (!embed) return false;
    var r = embed.getBoundingClientRect();
    return r.bottom > 80 && r.top < innerHeight - 80;
  }

  // ---- rendering ----
  function render() {
    log.innerHTML = "";
    log.appendChild(bubble("bot", GREETING));
    if (!state.items.length) log.appendChild(chips());
    state.items.forEach(function (it) { log.appendChild(node(it)); });
    voiceBtn.setAttribute("aria-pressed", state.voice ? "true" : "false");
    scroll();
  }
  function node(it) { return it.t === "card" ? card(it.card) : it.t === "err" ? bubble("err", it.text) : bubble(it.t, it.text); }
  function bubble(kind, text) {
    var d = el("div", "aia-msg " + (kind === "user" ? "aia-user" : kind === "err" ? "aia-bot aia-err" : "aia-bot"));
    if (kind === "bot") d.innerHTML = md(text); else d.textContent = text;
    return d;
  }
  function card(c) {
    var d = el("div", "aia-card");
    var b = el("b"); b.innerHTML = '<span>' + ICON.check + '</span>'; b.appendChild(document.createTextNode(c.title || "Done"));
    d.appendChild(b);
    (c.lines || []).forEach(function (l) { var x = el("div"); x.textContent = l; d.appendChild(x); });
    if (c.foot) { var f = el("small"); f.textContent = c.foot; d.appendChild(f); }
    return d;
  }
  function chips() {
    var w = el("div", "aia-chips");
    CHIPS.forEach(function (c) {
      var b = el("button", "aia-chip" + (c.primary ? " aia-primary" : "")); b.type = "button"; b.textContent = c.label;
      b.addEventListener("click", function () { if (c.href) { state.open = false; save(); location.href = c.href; return; } ask(c.prompt); });
      w.appendChild(b);
    });
    return w;
  }
  function scroll() { requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; }); }

  // tiny, safe markdown: escape first, then **bold**, [text](url), bare urls, lists, paragraphs
  function md(s) {
    var h = String(s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/(?!\/)[^\s)]*)\)/g, function (_, t, u) { return '<a href="' + u + '"' + (/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : "") + ">" + t + "</a>"; });
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    h = h.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.]+[\w])/g, '$1<a href="mailto:$2">$2</a>');
    var out = [], list = null;
    h.split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) { list = []; } list.push("<li>" + m[1] + "</li>"); return; }
      if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
      if (line.trim()) out.push("<p>" + line + "</p>");
    });
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("");
  }

  // ---- open / close ----
  function show(focus) {
    if (docked) { docked = false; panel.classList.remove("aia-docked"); root.appendChild(panel); dockWrap.appendChild(placeholder); }
    state.open = true; save();
    panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true");
    scroll();
    if (focus !== false && !matchMedia("(max-width:520px)").matches) input.focus();
  }
  function hide() {
    state.open = false; save(); stopSpeaking(); stopListening();
    panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); launch.focus();
    if (embed) dock(false);
  }
  launch.addEventListener("click", function () { if (embed && embedInView()) dock(true); else show(); });
  $(".aia-close").addEventListener("click", hide);
  $(".aia-reset").addEventListener("click", function () { if (busy) return; state.items = []; save(); stopSpeaking(); render(); input.focus(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden && !docked && state.open) hide(); });

  function wireTriggers(scope) {
    scope.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-aify-agent]");
      if (!t) return;
      e.preventDefault();
      var p = t.getAttribute("data-aify-prompt");
      if (embed) dock(true); else show();
      if (p) ask(p);
    });
  }

  // ---- composer ----
  function fit() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; sendBtn.disabled = busy || !input.value.trim(); }
  input.addEventListener("input", fit);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); } });
  form.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value.trim(); if (!v || busy) return; input.value = ""; fit(); ask(v); });

  // ---- talking to the server ----
  var busy = false;
  function history() {
    return state.items.filter(function (i) { return i.t === "user" || i.t === "bot"; })
      .map(function (i) { return { role: i.t === "user" ? "user" : "assistant", content: i.text }; });
  }
  function ask(text) {
    if (busy) return;
    stopSpeaking();
    var chipRow = log.querySelector(".aia-chips"); if (chipRow) chipRow.remove();
    push({ t: "user", text: text });
    busy = true; fit();
    var typing = el("div", "aia-typing"); typing.innerHTML = "<i></i><i></i><i></i>"; typing.setAttribute("aria-label", "AIfy is typing");
    log.appendChild(typing); scroll();
    var status = null, botItem = null, botNode = null;
    function ensureBot() {
      if (botItem) return;
      if (typing.parentNode) typing.remove();
      botItem = { t: "bot", text: "" }; state.items.push(botItem);
      botNode = bubble("bot", ""); log.appendChild(botNode);
    }
    function endBot() { botItem = null; botNode = null; }

    fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history(), page: pageName() }) })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error(res.status === 503 ? "not_configured" : res.status === 429 ? "rate_limited" : "http_" + res.status);
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              var line = buf.slice(0, i); buf = buf.slice(i + 2);
              if (line.indexOf("data:") !== 0) continue;
              var ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
              if (ev.type === "text") {
                if (status) { status.remove(); status = null; }
                if (!botItem && !ev.delta.trim()) continue;
                ensureBot(); botItem.text += ev.delta; botNode.innerHTML = md(botItem.text); scroll();
              } else if (ev.type === "tool") {
                if (botItem && botItem.text) speak(botItem.text);
                endBot(); if (typing.parentNode) typing.remove();
                if (status) status.remove();
                status = el("div", "aia-status"); status.innerHTML = '<span class="aia-typing" style="padding:6px 8px"><i></i><i></i><i></i></span>';
                status.appendChild(document.createTextNode(TOOL_LABEL[ev.name] || "Working on it"));
                log.appendChild(status); scroll();
              } else if (ev.type === "card") {
                if (status) { status.remove(); status = null; }
                push({ t: "card", card: ev.card });
              } else if (ev.type === "error") {
                endBot(); push({ t: "err", text: ev.message });
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        endBot();
        push({ t: "err", text: String(err.message) === "not_configured"
          ? "The live agent isn't switched on yet. You can reach the team at info@aify.solutions."
          : String(err.message) === "rate_limited" ? "We've hit today's chat limit for your connection. Please email info@aify.solutions and a person will reply."
          : "I couldn't connect just now. Please try again, or email info@aify.solutions." });
      })
      .then(function () {
        if (typing.parentNode) typing.remove();
        if (status) status.remove();
        if (botItem && botItem.text) speak(botItem.text);
        state.items = state.items.filter(function (i) { return !(i.t === "bot" && !i.text); });
        if (state.items.length > 60) state.items = state.items.slice(-60);
        save(); busy = false; fit();
      });
  }
  function push(it) { state.items.push(it); save(); log.appendChild(node(it)); scroll(); }
  function pageName() { var p = location.pathname.replace(/\/+$/, "").split("/").pop() || "home"; return p.replace(/\.html$/, "").replace(/^index$/, "home"); }

  // ---- voice: read aloud (speechSynthesis) and dictation (SpeechRecognition) ----
  var synth = window.speechSynthesis;
  if (!synth) voiceBtn.hidden = true;
  voiceBtn.addEventListener("click", function () { state.voice = !state.voice; save(); voiceBtn.setAttribute("aria-pressed", state.voice ? "true" : "false"); if (!state.voice) stopSpeaking(); });
  function pickVoice() {
    var vs = synth.getVoices().filter(function (v) { return /^en(-|_)/i.test(v.lang); });
    var pref = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Karen", "Daniel", "Google UK English Female"];
    for (var i = 0; i < pref.length; i++) { for (var j = 0; j < vs.length; j++) if (vs[j].name.indexOf(pref[i]) >= 0) return vs[j]; }
    return vs[0] || null;
  }
  function speak(text) {
    if (!state.voice || !synth) return;
    var plain = String(text).replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "the link").replace(/^\s*[-*•]\s+/gm, "");
    var u = new SpeechSynthesisUtterance(plain); var v = pickVoice(); if (v) u.voice = v; u.rate = 1.03;
    synth.speak(u);
  }
  function stopSpeaking() { try { synth && synth.cancel(); } catch (e) {} }

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, listening = false;
  if (SR) {
    micBtn.hidden = false;
    micBtn.addEventListener("click", function () { listening ? stopListening() : startListening(); });
  }
  function startListening() {
    if (busy) return;
    stopSpeaking();
    rec = new SR(); rec.lang = "en-CA"; rec.interimResults = true; rec.continuous = false;
    var finalText = "";
    rec.onresult = function (e) {
      var interim = ""; finalText = "";
      for (var i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript; }
      input.value = (finalText + interim).trim(); fit();
    };
    rec.onend = function () {
      listening = false; micBtn.classList.remove("aia-on"); micBtn.setAttribute("aria-label", "Speak your message");
      var v = input.value.trim();
      if (finalText && v) { if (!state.voice) { state.voice = true; save(); voiceBtn.setAttribute("aria-pressed", "true"); } input.value = ""; fit(); ask(v); }
    };
    rec.onerror = function () { listening = false; micBtn.classList.remove("aia-on"); };
    try { rec.start(); listening = true; micBtn.classList.add("aia-on"); micBtn.setAttribute("aria-label", "Stop listening"); } catch (e) {}
  }
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch (e) {} } }

  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  window.AIfyAgent = {
    open: function (o) { if (embed) dock(true); else show(); if (o && o.prompt) ask(o.prompt); },
    close: hide,
    demo: function () { location.href = DEMO_URL; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
