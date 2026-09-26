#!/usr/bin/env bash
# Passwort setzen bzw. Benutzer anlegen:   sudo ./passwort.sh <benutzer>
# Alle Sitzungen beenden (überall abmelden): sudo ./passwort.sh --alle-abmelden
set -euo pipefail

USERS=/etc/homeserver/users
SECRET=/etc/homeserver/secret
PY=/opt/homeserver/venv/bin/python

die() { printf '\033[31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen."
[[ -x "$PY" ]] || die "Erst sudo ./install.sh ausführen."

if [[ "${1:-}" == "--alle-abmelden" ]]; then
  python3 -c 'import secrets; print(secrets.token_hex(32))' > "$SECRET"
  systemctl restart homeserver-auth
  echo "Alle Sitzungen beendet – jedes Gerät muss sich neu anmelden."
  exit 0
fi

NAME="${1:-}"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "Aufruf: sudo ./passwort.sh <benutzer>"
read -r -s -p "Neues Passwort für $NAME: " PW1; echo
read -r -s -p "Wiederholen: " PW2; echo
[[ "$PW1" == "$PW2" ]] || die "Die Passwörter stimmen nicht überein."
[[ ${#PW1} -ge 10 ]] || die "Bitte mindestens 10 Zeichen."

HASH="$(PW="$PW1" "$PY" -c 'import os, bcrypt; print(bcrypt.hashpw(os.environ["PW"].encode(), bcrypt.gensalt(12)).decode())')"
TMP="$(mktemp)"
{ grep -v "^$NAME " "$USERS" 2>/dev/null || true; echo "$NAME $HASH"; } > "$TMP"
install -m 640 -o root -g homeserver "$TMP" "$USERS"
rm -f "$TMP"
echo "Passwort für $NAME gespeichert. Gilt ab der nächsten Anmeldung."
