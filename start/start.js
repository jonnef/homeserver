// Startseite: Uhr, App-Liste aus apps.json, Suche und Tastenkürzel 1–9.
(function () {
  "use strict";

  var ICONS = {
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M7 6V4h10v2"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
    app: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  };

  var list = document.getElementById("apps");
  var search = document.getElementById("q");
  var empty = document.getElementById("empty");
  var apps = [];

  // ---------- Uhr ----------
  var timeEl = document.getElementById("time");
  var dateEl = document.getElementById("date");
  var timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  var dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  function tick() {
    var now = new Date();
    timeEl.textContent = timeFmt.format(now);
    dateEl.textContent = dateFmt.format(now);
  }
  tick();
  setInterval(tick, 10000);

  document.getElementById("host").textContent = location.host;

  // ---------- Apps ----------
  function textColor(hex) {
    // Dunkle Symbolfarbe auf hellen Kacheln, helle auf dunklen – immer gut lesbar.
    var n = parseInt(hex.replace("#", ""), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#14161b" : "#ffffff";
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function render(filter) {
    var q = (filter || "").trim().toLowerCase();
    list.textContent = "";
    var shown = 0;
    apps.forEach(function (app, i) {
      var hay = (app.name + " " + (app.description || "")).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      shown++;
      var li = el("li");
      var a = el("a", "app");
      a.href = app.path;
      if (app.description) a.title = app.description;
      var tile = el("span", "tile");
      tile.style.background = app.color || "#8fb3ff";
      tile.style.color = textColor(app.color || "#8fb3ff");
      tile.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (ICONS[app.icon] || ICONS.app) + "</svg>";
      a.appendChild(tile);
      a.appendChild(el("span", "label", app.name));
      if (i < 9) a.appendChild(el("span", "key", "Taste " + (i + 1)));
      li.appendChild(a);
      list.appendChild(li);
    });
    empty.hidden = shown > 0 || !apps.length;
  }

  fetch("/start/apps.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (data) { apps = Array.isArray(data) ? data : []; render(search.value); })
    .catch(function () { empty.hidden = false; empty.textContent = "App-Liste konnte nicht geladen werden."; });

  // ---------- Suche & Tastatur ----------
  search.addEventListener("input", function () { render(search.value); });
  search.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var first = list.querySelector("a.app");
      if (first) location.href = first.getAttribute("href");
    } else if (e.key === "Escape") {
      search.value = "";
      render("");
      search.blur();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var typing = document.activeElement === search && search.value !== "";
    if (!typing && /^[1-9]$/.test(e.key)) {
      var app = apps[Number(e.key) - 1];
      if (app) { e.preventDefault(); location.href = app.path; }
    } else if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    }
  });
})();
