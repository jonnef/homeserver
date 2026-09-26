#!/usr/bin/env bash
# Installiert bzw. aktualisiert Startseite, Anmeldedienst und Caddy-Konfiguration auf dem Pi:
#
#   sudo ./install.sh
#
# - Anmeldedienst (auth/server.py) als Dienst homeserver-auth auf 127.0.0.1:8002
#   Zugangsdaten: /etc/homeserver/users – beim ersten Mal aus dem bisherigen
#   basicauth-Block der Caddyfile übernommen (dasselbe Passwort gilt weiter)
# - Startseite nach /opt/homeserver/start
# - /etc/caddy/Caddyfile aus Caddyfile.template: prüfen, sichern, neu laden und
#   bei einem Fehler automatisch die alte Konfiguration wiederherstellen
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
CADDYFILE=/etc/caddy/Caddyfile
TARGET=/opt/homeserver
CONF=/etc/homeserver
USERS="$CONF/users"
SECRET="$CONF/secret"
SERVICE_USER=homeserver

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen: sudo ./install.sh"
command -v caddy >/dev/null || die "Caddy ist nicht installiert."
command -v python3 >/dev/null || die "python3 fehlt."

# ---------- Neue Caddyfile prüfen (bevor irgendetwas geändert wird) ----------
say "Prüfe neue Caddy-Konfiguration …"
caddy validate --adapter caddyfile --config "$REPO/Caddyfile.template" >/dev/null 2>&1 \
  || { caddy validate --adapter caddyfile --config "$REPO/Caddyfile.template" || true; die "Konfiguration ungültig – nichts geändert."; }

# ---------- Zugangsdaten und Schlüssel ----------
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -m 750 -o root -g "$SERVICE_USER" "$CONF"

if [[ ! -s "$USERS" ]]; then
  AUTH=""
  if [[ -f "$CADDYFILE" ]]; then
    # Zeilen im ersten basicauth-/basic_auth-Block, z. B. "jonnef $2a$14$…"
    AUTH="$(awk '
      !inblock && /(basicauth|basic_auth)[^{]*\{/ { inblock = 1; next }
      inblock && /^[[:space:]]*\}/ { exit }
      inblock && NF { $1 = $1; print }
    ' "$CADDYFILE")"
  fi
  if [[ -n "$AUTH" ]]; then
    say "Übernehme Zugangsdaten aus der bisherigen Caddyfile (Passwort bleibt gleich)."
  else
    say "Keine Zugangsdaten gefunden – neue anlegen:"
    read -r -p "Benutzername: " USERNAME
    [[ "$USERNAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "Ungültiger Benutzername."
    AUTH="$USERNAME $(caddy hash-password)"
  fi
  printf '# <Benutzer> <bcrypt-Hash> – ändern mit: sudo ./passwort.sh <Benutzer>\n%s\n' "$AUTH" > "$USERS"
fi
chown root:"$SERVICE_USER" "$USERS" && chmod 640 "$USERS"

if [[ ! -s "$SECRET" ]]; then
  python3 -c 'import secrets; print(secrets.token_hex(32))' > "$SECRET"
fi
chown root:"$SERVICE_USER" "$SECRET" && chmod 640 "$SECRET"

# ---------- Anmeldedienst ----------
say "Richte Anmeldedienst ein …"
mkdir -p "$TARGET/auth"
if ! python3 -c "import venv, ensurepip" 2>/dev/null; then
  apt-get update -qq && apt-get install -y -qq python3-venv
fi
[[ -x "$TARGET/venv/bin/python" ]] || python3 -m venv "$TARGET/venv"
"$TARGET/venv/bin/pip" install -q --upgrade pip
"$TARGET/venv/bin/pip" install -q "bcrypt>=4"
install -m 644 "$REPO/auth/server.py" "$TARGET/auth/server.py"

cat > /etc/systemd/system/homeserver-auth.service <<EOF
[Unit]
Description=Homeserver Anmeldedienst (Caddy forward_auth)
After=network.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
Environment=HOMESERVER_USERS=$USERS
Environment=HOMESERVER_SECRET=$SECRET
Environment=HOMESERVER_PORT=8002
ExecStart=$TARGET/venv/bin/python $TARGET/auth/server.py
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet homeserver-auth
systemctl restart homeserver-auth
for _ in $(seq 1 20); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8002/auth/me || true)" == "200" ]] && break
  sleep 0.5
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8002/auth/me || true)" == "200" ]] \
  || die "Anmeldedienst startet nicht – Caddy bleibt unverändert. Log: journalctl -u homeserver-auth -n 30"

# ---------- Startseite ----------
say "Kopiere Startseite nach $TARGET/start …"
rm -rf "$TARGET/start.new"
cp -r "$REPO/start" "$TARGET/start.new"
rm -rf "$TARGET/start"
mv "$TARGET/start.new" "$TARGET/start"
chmod -R a+rX "$TARGET/start" "$TARGET/auth"

# ---------- Caddy umstellen ----------
BACKUP=""
if [[ -f "$CADDYFILE" ]] && ! cmp -s "$CADDYFILE" "$REPO/Caddyfile.template"; then
  BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$CADDYFILE" "$BACKUP"
  say "Backup der bisherigen Konfiguration: $BACKUP"
fi
install -m 644 "$REPO/Caddyfile.template" "$CADDYFILE"
systemctl reload caddy

# ---------- Kontrolle ----------
code() { curl -s -o /dev/null -w '%{http_code}' -H "Accept: ${2:-text/html}" "http://127.0.0.1$1" || true; }
sleep 1
START="$(code /)"
printf '  %-24s %s\n' \
  "/" "$START (erwartet 200)" \
  "/budget/" "$(code /budget/) (erwartet 302 = weiter zur Anmeldung)" \
  "/vorlesungen/" "$(code /vorlesungen/) (erwartet 302)" \
  "/api/v1/accounts" "$(code /api/v1/accounts application/json) (erwartet 401)" \
  "/vorschau/budget/" "$(code /vorschau/budget/) (erwartet 200)" \
  "/vorschau/vorlesungen/" "$(code /vorschau/vorlesungen/) (erwartet 200)"

if [[ "$(code /vorschau/vorlesungen/)" == "502" ]]; then
  say "Hinweis: Die Vorlesungs-Vorschau läuft noch nicht. Auf dem Mac ausführen:"
  echo "  cd ~/vorlesungs-nacharbeitung && git pull && ./install.sh"
fi
if [[ "$(code /vorschau/budget/)" == "404" ]]; then
  say "Hinweis: Die Budgetbuch-Vorschau ist noch nicht gebaut – sie entsteht beim nächsten Frontend-Deploy."
fi

if [[ "$START" != "200" ]]; then
  if [[ -n "$BACKUP" ]]; then
    cp -p "$BACKUP" "$CADDYFILE"
    systemctl reload caddy
    die "Startseite antwortet nicht – alte Konfiguration wiederhergestellt."
  fi
  die "Startseite antwortet nicht (HTTP $START)."
fi

say "Fertig. Startseite: http://$(hostname -I | awk '{print $1}')/ – anmelden über das Konto-Symbol oben rechts."
