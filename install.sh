#!/usr/bin/env bash
# Installiert bzw. aktualisiert Startseite und Caddy-Konfiguration auf dem Pi:
#
#   sudo ./install.sh
#
# - kopiert die Startseite nach /opt/homeserver/start
# - erzeugt /etc/caddy/Caddyfile aus Caddyfile.template; die Login-Daten
#   (basicauth) werden aus der bisherigen Caddyfile übernommen
# - prüft die neue Konfiguration, legt ein Backup an, lädt Caddy neu und
#   stellt bei einem Fehler automatisch die alte Konfiguration wieder her
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
CADDYFILE=/etc/caddy/Caddyfile
TARGET=/opt/homeserver

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen: sudo ./install.sh"
command -v caddy >/dev/null || die "Caddy ist nicht installiert."

# ---------- Login-Daten übernehmen ----------
AUTH=""
if [[ -f "$CADDYFILE" ]]; then
  # Zeilen im ersten basicauth-/basic_auth-Block, z. B. "jonnef $2a$14$…"
  AUTH="$(awk '
    !inblock && /(basicauth|basic_auth)[^{]*\{/ { inblock = 1; next }
    inblock && /^[[:space:]]*\}/ { exit }
    inblock && NF { $1 = $1; print }
  ' "$CADDYFILE")"
fi
if [[ -z "$AUTH" ]]; then
  say "Keine Login-Daten in $CADDYFILE gefunden – neue anlegen:"
  read -r -p "Benutzername: " USERNAME
  [[ "$USERNAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "Ungültiger Benutzername."
  HASH="$(caddy hash-password)"
  AUTH="$USERNAME $HASH"
fi

# ---------- Neue Caddyfile erzeugen und prüfen ----------
NEW="$(mktemp)"
trap 'rm -f "$NEW"' EXIT
while IFS= read -r line; do
  if [[ "$line" == *"{{BASIC_AUTH}}"* ]]; then
    while IFS= read -r entry; do
      [[ -n "$entry" ]] && printf '\t\t%s\n' "$entry"
    done <<< "$AUTH"
  else
    printf '%s\n' "$line"
  fi
done < "$REPO/Caddyfile.template" > "$NEW"

say "Prüfe neue Caddy-Konfiguration …"
caddy validate --adapter caddyfile --config "$NEW" >/dev/null 2>&1 \
  || { caddy validate --adapter caddyfile --config "$NEW" || true; die "Konfiguration ungültig – nichts geändert."; }

# ---------- Startseite ----------
say "Kopiere Startseite nach $TARGET/start …"
mkdir -p "$TARGET"
rm -rf "$TARGET/start.new"
cp -r "$REPO/start" "$TARGET/start.new"
rm -rf "$TARGET/start"
mv "$TARGET/start.new" "$TARGET/start"
chmod -R a+rX "$TARGET"

# ---------- Caddy umstellen ----------
BACKUP=""
if [[ -f "$CADDYFILE" ]] && ! cmp -s "$CADDYFILE" "$NEW"; then
  BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$CADDYFILE" "$BACKUP"
  say "Backup der bisherigen Konfiguration: $BACKUP"
fi
install -m 644 "$NEW" "$CADDYFILE"
systemctl reload caddy

# ---------- Kontrolle ----------
code() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1$1" || true; }
sleep 1
START="$(code /)"; BUDGET="$(code /budget/)"; LECTURES="$(code /vorlesungen/)"
printf '  %-16s %s\n' "/" "$START (erwartet 200)" "/budget/" "$BUDGET (erwartet 401 = Login)" "/vorlesungen/" "$LECTURES (erwartet 401 = Login)"

if [[ "$START" != "200" ]]; then
  if [[ -n "$BACKUP" ]]; then
    cp -p "$BACKUP" "$CADDYFILE"
    systemctl reload caddy
    die "Startseite antwortet nicht – alte Konfiguration wiederhergestellt."
  fi
  die "Startseite antwortet nicht (HTTP $START)."
fi

say "Fertig. Startseite: http://$(hostname -I | awk '{print $1}')/"
