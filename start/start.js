// Startseite: Uhr, App-Liste aus apps.json, Suche, Tastenkürzel 1–9 und Anmeldung.
//
// Angemeldet öffnet ein Klick die App. Nicht angemeldet führt er zur Vorschau mit
// Beispieldaten (falls die App eine hat), sonst zur Anmeldung. Wer eine App direkt
// aufruft, wird von Caddy mit ?login=1&next=/pfad hierher geschickt.
(function () {
  "use strict";

  var ICONS = {
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M7 6V4h10v2"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
    app: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
  };

  var $ = function (id) { return document.getElementById(id); };
  var list = $("apps"), search = $("q"), empty = $("empty");
  var apps = [];
  var user = null;       // angemeldeter Benutzer oder null
  var authKnown = false; // erst nach /auth/me wissen wir, wohin die Kacheln führen

  // ---------- Uhr ----------
  var timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  var dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  function tick() {
    var now = new Date();
    $("time").textContent = timeFmt.format(now);
    $("date").textContent = dateFmt.format(now);
  }
  tick();
  setInterval(tick, 10000);
  $("host").textContent = location.host;

  // ---------- Hilfen ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function textColor(hex) {
    var n = parseInt(hex.replace("#", ""), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#14161b" : "#ffffff";
  }

  function safeNext(value) {
    return value && value.charAt(0) === "/" && value.charAt(1) !== "/" && value.indexOf("\\") === -1 ? value : null;
  }

  function appFor(path) {
    for (var i = 0; i < apps.length; i++) {
      var p = apps[i].path.replace(/\/$/, "");
      if (path === p || path.indexOf(p + "/") === 0) return apps[i];
    }
    return null;
  }

  // Wohin ein Klick auf die App führt – abhängig von der Anmeldung.
  function target(app) {
    if (user) return app.path;
    return app.preview || null;
  }

  function open(app) {
    var href = target(app);
    if (href) location.href = href;
    else showLogin(app.path);
  }

  // ---------- Apps ----------
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
      a.href = target(app) || app.path;
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // neuer Tab: normaler Link
        e.preventDefault();
        open(app);
      });
      if (app.description) a.title = app.description;
      var tile = el("span", "tile");
      tile.style.background = app.color || "#8fb3ff";
      tile.style.color = textColor(app.color || "#8fb3ff");
      tile.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (ICONS[app.icon] || ICONS.app) + "</svg>";
      a.appendChild(tile);
      a.appendChild(el("span", "label", app.name));
      var hint = [];
      if (authKnown && !user && app.preview) hint.push("Vorschau");
      if (i < 9) hint.push("Taste " + (i + 1));
      if (hint.length) a.appendChild(el("span", "key", hint.join(" · ")));
      li.appendChild(a);
      list.appendChild(li);
    });
    empty.hidden = shown > 0 || !apps.length;
  }

  // ---------- Anmeldung ----------
  var dialog = $("login"), form = $("login-form"), errorEl = $("login-error");
  var nextPath = null;

  function setUser(name) {
    user = name;
    authKnown = true;
    var btn = $("account");
    btn.setAttribute("aria-label", name ? "Konto: " + name : "Anmelden");
    $("account-icon").hidden = !!name;
    $("account-initial").hidden = !name;
    $("account-initial").textContent = name ? name.charAt(0).toUpperCase() : "";
    btn.classList.toggle("signed-in", !!name);
    $("menu-user").textContent = name ? "Angemeldet als " + name : "";
    render(search.value);
  }

  function showLogin(next) {
    nextPath = safeNext(next);
    var app = nextPath && appFor(nextPath);
    $("login-hint").hidden = !app;
    $("login-hint").textContent = app ? "Melde dich an, um " + app.name + " zu öffnen." : "";
    $("login-preview").hidden = !(app && app.preview);
    if (app && app.preview) $("login-preview").href = app.preview;
    errorEl.hidden = true;
    $("login-password").value = "";
    if (!dialog.open) dialog.showModal();
    $("login-user").focus();
  }

  function closeMenu() {
    $("menu").hidden = true;
    $("account").setAttribute("aria-expanded", "false");
  }

  $("account").addEventListener("click", function () {
    if (!user) return showLogin(null);
    var menu = $("menu");
    menu.hidden = !menu.hidden;
    $("account").setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) $("logout").focus();
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".account-wrap")) closeMenu();
  });

  $("logout").addEventListener("click", function () {
    fetch("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .finally(function () { closeMenu(); setUser(null); });
  });

  $("login-cancel").addEventListener("click", function () { dialog.close(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var submit = $("login-submit");
    submit.disabled = true;
    submit.textContent = "Prüfe …";
    errorEl.hidden = true;
    fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: $("login-user").value.trim(), password: $("login-password").value })
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.error || "Anmeldung fehlgeschlagen.");
        dialog.close();
        setUser(res.data.user);
        if (nextPath) location.href = nextPath;
      })
      .catch(function (err) {
        errorEl.textContent = err.message === "Failed to fetch" ? "Server nicht erreichbar." : err.message;
        errorEl.hidden = false;
        $("login-password").select();
      })
      .finally(function () {
        submit.disabled = false;
        submit.textContent = "Anmelden";
      });
  });

  // ---------- Start ----------
  var params = new URLSearchParams(location.search);
  if (params.has("login")) history.replaceState(null, "", "/"); // Adresse aufräumen

  Promise.all([
    fetch("/start/apps.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    fetch("/auth/me", { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return { user: null }; })
  ])
    .then(function (res) {
      apps = Array.isArray(res[0]) ? res[0] : [];
      setUser(res[1].user || null);
      if (params.has("login") && !user) showLogin(params.get("next"));
      else if (params.has("login") && user && safeNext(params.get("next"))) location.href = safeNext(params.get("next"));
    })
    .catch(function () {
      empty.hidden = false;
      empty.textContent = "App-Liste konnte nicht geladen werden.";
    });

  // ---------- Suche & Tastatur ----------
  search.addEventListener("input", function () { render(search.value); });
  search.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var q = search.value.trim().toLowerCase();
      var first = apps.filter(function (a) { return (a.name + " " + (a.description || "")).toLowerCase().indexOf(q) !== -1; })[0];
      if (first) open(first);
    } else if (e.key === "Escape") {
      search.value = "";
      render("");
      search.blur();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || dialog.open) return;
    if (e.key === "Escape") return closeMenu();
    var typing = document.activeElement === search && search.value !== "";
    if (!typing && /^[1-9]$/.test(e.key)) {
      var app = apps[Number(e.key) - 1];
      if (app) { e.preventDefault(); open(app); }
    } else if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    }
  });
})();
