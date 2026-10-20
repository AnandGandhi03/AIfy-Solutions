/* "Have our AI call you": shows the form only when outbound calling is switched on, then posts to /api/callme. */
(function () {
  var forms = document.querySelectorAll("form[data-callme]");
  if (!forms.length) return;
  fetch("/api/callme").then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    if (!c || !c.enabled) return;
    document.querySelectorAll("[data-callme-wrap]").forEach(function (w) { w.hidden = false; });
  }).catch(function () {});
  forms.forEach(function (f) {
    var status = f.querySelector("[data-callme-status]"), btn = f.querySelector("button[type=submit]");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = new FormData(f);
      if (!d.get("consent")) { status.textContent = "Please tick the box to agree to the call."; return; }
      btn.disabled = true; status.textContent = "Starting the call…";
      fetch("/api/callme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        name: d.get("name"), business: d.get("business"), phone: d.get("phone"), consent: !!d.get("consent"), website: d.get("website"), page: location.pathname,
      }) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          status.textContent = res.j.message || res.j.error || (res.ok ? "Done." : "Something went wrong. Please book a time on the contact page.");
          if (res.ok && res.j.calling) { f.querySelectorAll("input").forEach(function (i) { if (i.type !== "checkbox") i.readOnly = true; }); }
          else btn.disabled = false;
        })
        .catch(function () { status.textContent = "We couldn't reach the server. Please try again, or book a time on the contact page."; btn.disabled = false; });
    });
  });
})();
