/* AIfy free AI visibility check (GEO / AEO). Talks to /api/visibility. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var form = $("[data-vis-form]"); if (!form) return;
  var API = "/api/visibility";
  var ui = {
    msg: $("[data-vis-msg]"), label: $("[data-vis-submit-label]"), submit: form.querySelector("[type=submit]"),
    example: $("[data-vis-example]"), results: $("[data-vis-results]"), title: $("[data-vis-title]"), meta: $("[data-vis-meta]"),
    big: $("[data-vis-big]"), summary: $("[data-vis-summary]"), list: $("[data-vis-list]"),
    comp: $("[data-vis-comp]"), compList: $("[data-vis-comp-list]"), src: $("[data-vis-src]"), srcList: $("[data-vis-src-list]"),
    recs: $("[data-vis-recs]"), recList: $("[data-vis-rec-list]"), copy: $("[data-vis-copy]"), book: $("[data-vis-book]")
  };
  var CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  var reportId = null;

  // Shared link: /ai-visibility?id=...
  var shared = new URLSearchParams(location.search).get("id");
  if (shared && /^[a-z0-9]{10,40}$/.test(shared)) {
    fetch(API + "?id=" + encodeURIComponent(shared)).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c) return;
      reportId = c.id; showResults(c.business, c.city, c.engine, c.questions);
      (c.results || []).forEach(function (r, i) { fillRow(i, r); });
      if (c.status === "done") finishView(c);
      document.getElementById("report").scrollIntoView();
    }).catch(function () {});
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(form), data = { action: "start" };
    fd.forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
    data.consent = !!form.querySelector("[name=consent]").checked;
    busy(true, "Writing questions…");
    post({ action: "start", business: data.business, category: data.category, city: data.city, website: data.website, name: data.name, email: data.email, consent: data.consent, website_url_confirm: data.website_url_confirm })
      .then(function (s) {
        reportId = s.id;
        showResults(data.business, data.city, s.engine, s.questions);
        document.getElementById("report").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        busy(true, "Asking the AI…");
        var done = 0;
        return Promise.all(s.questions.map(function (q, i) {
          return post({ action: "ask", id: s.id, index: i }).catch(function () { return { question: q, error: true }; })
            .then(function (r) { fillRow(i, r); done++; ui.summary.textContent = "Asked " + done + " of " + s.questions.length + " questions…"; });
        })).then(function () { busy(true, "Writing your fixes…"); ui.summary.textContent = "Working out what to fix first…"; return post({ action: "finish", id: s.id }); });
      })
      .then(function (c) { if (c) finishView(c); busy(false); ui.label.textContent = "Run another check"; })
      .catch(function (err) { busy(false); ui.msg.textContent = err.message || "Something went wrong. Please try again."; ui.msg.style.color = "#0A0A0A"; });
  });

  function post(body) {
    return fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error === "not_configured" ? "The checker isn't switched on yet. Email info@aify.solutions and we'll run one for you." : (j.error || "Something went wrong. Please try again."));
        return j;
      }); });
  }
  function busy(on, text) { ui.submit.disabled = on; if (text) ui.label.textContent = text; if (!on) ui.label.textContent = "Run my free check"; }

  function showResults(business, city, engine, questions) {
    ui.example.hidden = true; ui.results.hidden = false; ui.recs.hidden = true; ui.comp.hidden = true; ui.src.hidden = true;
    ui.title.textContent = "How AI answers customers in " + city;
    ui.meta.textContent = business + " · tested with " + (engine || "an AI assistant with web search") + " · " + new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    ui.big.textContent = "…"; ui.summary.textContent = "Asking " + questions.length + " questions…";
    ui.list.innerHTML = "";
    questions.forEach(function (q, i) {
      var row = el("div", "vs-q"); row.setAttribute("data-row", i);
      var h = el("div", "vs-q-h"); var t = el("span", "vs-q-t"); t.textContent = q; h.appendChild(t);
      var b = el("span", "vs-badge is-wait"); b.innerHTML = '<span class="aify-dot"></span><span class="aify-dot" style="animation-delay:.15s"></span><span class="aify-dot" style="animation-delay:.3s"></span>'; h.appendChild(b);
      row.appendChild(h); ui.list.appendChild(row);
    });
  }
  function fillRow(i, r) {
    var row = ui.list.querySelector('[data-row="' + i + '"]'); if (!row || !r || r.pending) return;
    var badge = row.querySelector(".vs-badge");
    if (r.error) { badge.className = "vs-badge"; badge.textContent = "Couldn't check"; return; }
    badge.className = "vs-badge" + (r.mentioned ? " is-yes" : "");
    badge.innerHTML = r.mentioned ? CHECK + "Named" : "Not named";
    var m = el("div", "vs-q-m");
    if (r.competitors && r.competitors.length) m.appendChild(txt("span", (r.mentioned ? "Also named: " : "Named instead: ") + r.competitors.join(", ")));
    if (r.sources && r.sources.length) m.appendChild(txt("span", "Sources: " + r.sources.slice(0, 4).map(function (s) { return s.host; }).join(", ") + (r.cited ? " (your site was cited)" : "")));
    if (m.childNodes.length) row.appendChild(m);
    if (r.answer) { var d = el("details"); var s = el("summary"); s.textContent = "Read the AI's answer"; d.appendChild(s); var p = el("p"); p.style.cssText = "margin:8px 0 0;white-space:pre-wrap"; p.textContent = r.answer.replace(/\*\*/g, ""); d.appendChild(p); row.appendChild(d); }
  }
  function finishView(c) {
    var sc = c.score || { mentioned: 0, checked: 0 };
    ui.big.innerHTML = sc.mentioned + '<span style="color:#9E9EA3">/' + sc.checked + "</span>";
    var lead = sc.mentioned === 0 ? "AI assistants didn't name " + c.business + " in any of " + sc.checked + " answers."
      : sc.mentioned === sc.checked ? "Named in every answer. Now the work is keeping it that way and making sure the details are right."
      : "Named in " + sc.mentioned + " of " + sc.checked + " answers.";
    var top = (sc.topCompetitors || [])[0];
    ui.summary.textContent = lead + (top && sc.mentioned < sc.checked ? " " + top.name + " was recommended most often." : "");
    if (sc.topCompetitors && sc.topCompetitors.length) { ui.compList.innerHTML = ""; sc.topCompetitors.forEach(function (x) { ui.compList.appendChild(chip(x.name + (x.n > 1 ? " ×" + x.n : ""))); }); ui.comp.hidden = false; }
    if (sc.topSources && sc.topSources.length) { ui.srcList.innerHTML = ""; sc.topSources.forEach(function (x) { ui.srcList.appendChild(chip(x.host)); }); ui.src.hidden = false; }
    ui.recList.innerHTML = "";
    (c.recommendations || []).forEach(function (r, i) {
      var d = el("div", "vs-rec"); var n = el("span", "vs-num"); n.textContent = i + 1; d.appendChild(n);
      var w = el("div"); w.appendChild(txt("b", r.title)); w.appendChild(txt("p", r.detail)); d.appendChild(w); ui.recList.appendChild(d);
    });
    ui.recs.hidden = !(c.recommendations && c.recommendations.length);
    if (ui.recs.hidden) { ui.recs.hidden = false; ui.recList.appendChild(txt("p", "Book a call and we'll walk you through what to fix first.")); }
    ui.title.textContent = "Your AI visibility report";
    if (reportId && history.replaceState) history.replaceState(null, "", location.pathname + "?id=" + reportId);
  }
  if (ui.copy) ui.copy.addEventListener("click", function () {
    var link = location.origin + location.pathname + (reportId ? "?id=" + reportId : "");
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { ui.copy.textContent = "Link copied"; }, function () { window.prompt("Copy this link", link); });
  });
  function chip(t) { var s = el("span", "vs-chip"); s.style.cssText = "background:#141416;border-color:#2E2E32;color:#FFFFFF"; s.textContent = t; return s; }
  function txt(tag, t) { var n = el(tag); n.textContent = t; return n; }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
})();
