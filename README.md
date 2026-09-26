# Heimserver

Startseite und gemeinsamer Einstieg für alle Apps auf dem Raspberry Pi. Caddy
lauscht auf Port 80 und verteilt nach Pfad – keine Ports mehr in der Adresse:

| Adresse | Inhalt | Login |
|---|---|---|
| `/` | Startseite (Launcher) | keiner |
| `/budget/` | Budget Book (Frontend aus `/opt/budget-book/frontend`) | ja |
| `/api/…` | Budget Book API (Spring Boot, `127.0.0.1:8080`) | ja |
| `/vorlesungen/` | Vorlesungs-Nacharbeitung (`127.0.0.1:8000`) | ja |
| `/vorschau/budget/` | Budget Book mit Beispieldaten (`/opt/budget-book/frontend-demo`) | keiner |
| `/vorschau/vorlesungen/` | Vorlesungen mit Beispieldaten (`127.0.0.1:8001`, schreibgeschützt) | keiner |

Alle Apps teilen sich einen Login (Caddy `basicauth`). Der Browser merkt ihn
sich für die ganze Adresse – einmal anmelden reicht. Im Tailnet funktioniert
alles genauso über `tailscale serve`, das an Port 80 weiterleitet.

## Installieren / aktualisieren

Auf dem Pi:

```bash
git clone https://github.com/jonnef/homeserver.git ~/homeserver   # beim ersten Mal
cd ~/homeserver && git pull && sudo ./install.sh
```

`install.sh`

- kopiert die Startseite nach `/opt/homeserver/start`,
- erzeugt `/etc/caddy/Caddyfile` aus `Caddyfile.template` und übernimmt dabei
  die Login-Daten aus der bisherigen Datei (im Repo steht kein Passwort-Hash),
- prüft die neue Konfiguration, sichert die alte als
  `/etc/caddy/Caddyfile.bak-<Datum>`, lädt Caddy neu und stellt bei einem
  Fehler automatisch die alte Konfiguration wieder her.

Zurück zum alten Stand: `sudo cp /etc/caddy/Caddyfile.bak-<Datum> /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Eine App hinzufügen

1. In `start/apps.json` einen Eintrag ergänzen (`name`, `path`, `icon`
   `wallet`/`cap`/`app`, `color`, `description`). Die Reihenfolge bestimmt die
   Tastenkürzel 1–9.
2. In `Caddyfile.template` einen Block nach dem Muster von `/vorlesungen/`
   anlegen und den Pfad in `@apps` aufnehmen, damit er hinter dem Login liegt.
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
`start/apps.json`). Die Startseite zeigt darunter einen Link „Vorschau“, und wer
bei einer App den Login abbricht, landet auf `start/401.html` mit einem Link
dorthin. Die Vorschauen sehen nie echte Daten:

- **Budget Book:** eigener Build (`npm run build:demo`), der alle API-Aufrufe im
  Browser aus Beispieldaten beantwortet. `deploy/update.sh` im Service-Repo baut
  ihn nach `/opt/budget-book/frontend-demo`.
- **Vorlesungen:** zweite Instanz mit `DEMO_MODE=1` und eigener Datenbank,
  schreibgeschützt, ohne API und ohne Claude (Dienst `vorlesung-vorschau`).

## Später

- Richtige Konten statt eines gemeinsamen Basic-Auth-Logins
