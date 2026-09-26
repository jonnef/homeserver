# Heimserver

Startseite und gemeinsamer Einstieg für alle Apps auf dem Raspberry Pi. Caddy
lauscht auf Port 80 und verteilt nach Pfad – keine Ports mehr in der Adresse:

| Adresse | Inhalt | Anmeldung |
|---|---|---|
| `/` | Startseite (Launcher) | keiner |
| `/budget/` | Budget Book (Frontend aus `/opt/budget-book/frontend`) | ja |
| `/api/…` | Budget Book API (Spring Boot, `127.0.0.1:8080`) | ja |
| `/vorlesungen/` | Vorlesungs-Nacharbeitung (`127.0.0.1:8000`) | ja |
| `/vorschau/budget/` | Budget Book mit Beispieldaten (`/opt/budget-book/frontend-demo`) | keiner |
| `/vorschau/vorlesungen/` | Vorlesungen mit Beispieldaten (`127.0.0.1:8001`, schreibgeschützt) | keiner |

Angemeldet wird man **einmal auf der Startseite** über das Konto-Symbol oben
rechts. Ein Cookie hält die Sitzung 30 Tage, danach öffnen sich alle Apps ohne
weitere Abfrage. Dahinter steckt ein kleiner Anmeldedienst (`auth/server.py`,
Dienst `homeserver-auth` auf `127.0.0.1:8002`), den Caddy per `forward_auth`
vor jeder App-Anfrage fragt:

- nicht angemeldet + Seitenaufruf → Startseite mit Anmeldefenster, danach zurück zur App
- nicht angemeldet + API-Aufruf → `401`
- nicht angemeldet + Klick auf eine App der Startseite → deren Vorschau mit Beispieldaten

Im Tailnet funktioniert alles genauso über `tailscale serve`, das an Port 80 weiterleitet.

### Zugangsdaten

Stehen in `/etc/homeserver/users` (Name + bcrypt-Hash). Beim ersten
`install.sh` werden sie aus dem früheren `basicauth`-Block der Caddyfile
übernommen – das bisherige Passwort gilt weiter.

```bash
sudo ./passwort.sh jonnef           # Passwort ändern oder weitere Person anlegen
sudo ./passwort.sh --alle-abmelden  # alle Sitzungen auf allen Geräten beenden
```

Nach fünf falschen Passwörtern innerhalb von 15 Minuten wird die Anmeldung von
dieser Adresse für 15 Minuten gesperrt.

## Installieren / aktualisieren

Auf dem Pi:

```bash
git clone https://github.com/jonnef/homeserver.git ~/homeserver   # beim ersten Mal
cd ~/homeserver && git pull && sudo ./install.sh
```

`install.sh`

- richtet den Anmeldedienst ein (eigener Systembenutzer `homeserver`, Python-venv
  unter `/opt/homeserver/venv`, Zugangsdaten und Signaturschlüssel in `/etc/homeserver`),
- kopiert die Startseite nach `/opt/homeserver/start`,
- installiert `Caddyfile.template` als `/etc/caddy/Caddyfile` (im Repo steht kein Passwort-Hash),
- prüft die neue Konfiguration, sichert die alte als
  `/etc/caddy/Caddyfile.bak-<Datum>`, lädt Caddy neu und stellt bei einem
  Fehler automatisch die alte Konfiguration wieder her.

Zurück zum alten Stand: `sudo cp /etc/caddy/Caddyfile.bak-<Datum> /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Eine App hinzufügen

1. In `start/apps.json` einen Eintrag ergänzen (`name`, `path`, `icon`
   `wallet`/`cap`/`app`, `color`, `description`). Die Reihenfolge bestimmt die
   Tastenkürzel 1–9.
2. In `Caddyfile.template` einen Block nach dem Muster von `/vorlesungen/`
   anlegen und den Pfad in `@apps` aufnehmen, damit er nur mit Anmeldung erreichbar ist.
   Apps hinter einem Unterpfad müssen damit umgehen können – z. B. über den
   Header `X-Forwarded-Prefix`, wie die Vorlesungs-App.
3. `sudo ./install.sh`

## Budget Book: Umzug nach `/budget/`

Das Frontend wird ab dem Branch `claude/basis-pfad-budget` mit dem Basispfad
`/budget/` gebaut, und sein Service Worker gilt nur noch dort. Reihenfolge:

1. Diese Konfiguration installieren (`sudo ./install.sh`). Der bisherige
   Frontend-Build funktioniert sofort unter `/budget/`, weil die alten Pfade
   (`/assets/…`, Icons, Manifest) für den Übergang weiter ausgeliefert werden.
2. Den Frontend-Branch nach `main` mergen – der Runner auf dem Pi baut und
   veröffentlicht ihn automatisch.

Unter `/sw.js` liefert Caddy einen Aufräum-Worker aus: Browser, die noch den
alten Service Worker des Budget Books (Scope `/`) haben, ersetzen ihn damit
beim nächsten Besuch und melden ihn ab.

## Vorschau ohne Login

Jede App kann eine öffentliche Vorschau mit Beispieldaten haben (`preview` in
`start/apps.json`). Nicht angemeldet führt ein Klick auf die App dorthin, und das
Anmeldefenster bietet sie als Alternative an. Die Vorschauen sehen nie echte Daten:

- **Budget Book:** eigener Build (`npm run build:demo`), der alle API-Aufrufe im
  Browser aus Beispieldaten beantwortet. `deploy/update.sh` im Service-Repo baut
  ihn nach `/opt/budget-book/frontend-demo`.
- **Vorlesungen:** zweite Instanz mit `DEMO_MODE=1` und eigener Datenbank,
  schreibgeschützt, ohne API und ohne Claude (Dienst `vorlesung-vorschau`).

## Später

- Konten innerhalb der Apps (z. B. getrennte Budgetbücher pro Person)
