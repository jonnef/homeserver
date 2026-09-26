// Aufräum-Worker unter /sw.js.
//
// Das Budgetbuch hat früher einen Service Worker mit Scope "/" registriert, der
// damit auch die Startseite und andere Apps abfangen würde. Seit dem Umzug nach
// /budget/ liefert Caddy unter /sw.js diese Datei aus: Browser mit dem alten
// Worker holen sie beim nächsten Besuch als Update, sie löscht den alten Cache
// und meldet sich selbst ab. Der neue Worker des Budgetbuchs (/budget/sw.js)
// bleibt unberührt.
self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.delete("budget-book-v1").then(function () { return self.registration.unregister(); })
  );
});
