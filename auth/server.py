#!/usr/bin/env python3
"""Anmeldedienst für den Homeserver (Caddy forward_auth).

Ersetzt das Basic-Auth-Fenster des Browsers: Man meldet sich einmal auf der
Startseite an, ein signiertes Cookie hält die Sitzung, und Caddy fragt vor jeder
App-Anfrage hier nach (/auth/check). Nur Standardbibliothek plus bcrypt.

Endpunkte (Caddy leitet /auth/* hierher):
  GET  /auth/me      {"user": "<name>"} oder {"user": null}
  POST /auth/login   JSON {"user", "password"} → setzt das Sitzungs-Cookie
  POST /auth/logout  löscht das Cookie
  GET  /auth/check   für forward_auth: 204 wenn angemeldet, sonst Weiterleitung
                     zur Anmeldung (Seitenaufrufe) bzw. 401 (API-Aufrufe)

Konfiguration über Umgebungsvariablen (setzt install.sh im systemd-Dienst):
  HOMESERVER_USERS    Datei mit Zeilen "<name> <bcrypt-hash>"  (/etc/homeserver/users)
  HOMESERVER_SECRET   Datei mit dem Signaturschlüssel          (/etc/homeserver/secret)
  HOMESERVER_PORT     Port auf 127.0.0.1                        (8002)
"""

import base64
import hashlib
import hmac
import json
import os
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

import bcrypt

USERS_FILE = os.environ.get("HOMESERVER_USERS", "/etc/homeserver/users")
SECRET_FILE = os.environ.get("HOMESERVER_SECRET", "/etc/homeserver/secret")
PORT = int(os.environ.get("HOMESERVER_PORT", "8002"))

COOKIE = "hs_session"
SESSION_DAYS = 30
MAX_FAILURES = 5          # Fehlversuche pro IP …
FAILURE_WINDOW = 15 * 60  # … innerhalb von 15 Minuten, danach Sperre bis zum Ablauf


def load_users() -> dict[str, bytes]:
    users = {}
    with open(USERS_FILE, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2 and not line.startswith("#"):
                users[parts[0]] = parts[1].encode()
    return users


def load_secret() -> bytes:
    with open(SECRET_FILE, "rb") as f:
        secret = f.read().strip()
    if len(secret) < 32:
        raise SystemExit(f"Signaturschlüssel in {SECRET_FILE} ist zu kurz.")
    return secret


SECRET = load_secret()
# Gegen Timing-Unterschiede bei unbekannten Namen: immer gegen einen Hash prüfen.
DUMMY_HASH = bcrypt.hashpw(b"x", bcrypt.gensalt(rounds=12))

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


# ---------- Sitzungs-Token: base64(json).hmac ----------

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(user: str) -> str:
    payload = _b64(json.dumps({"u": user, "exp": int(time.time()) + SESSION_DAYS * 86400}).encode())
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def read_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except ValueError:
        return None
    if data.get("exp", 0) < time.time():
        return None
    # Wer aus der Benutzerdatei entfernt wurde, verliert seine Sitzung sofort.
    return data.get("u") if data.get("u") in load_users() else None


def safe_next(value: str | None) -> str:
    """Nur Pfade auf diesem Server (kein //host, kein Schema) als Ziel nach der Anmeldung."""
    if value and value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value
    return "/"


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "homeserver-auth"

    def log_message(self, fmt, *args):  # nur Fehlversuche/Starts ins Journal
        pass

    # Hilfen
    def client_ip(self) -> str:
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def current_user(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return read_token(cookie[COOKIE].value if COOKIE in cookie else None)

    def send_json(self, status: int, data: dict, cookie: str | None = None) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def cookie_header(self, value: str, max_age: int) -> str:
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return f"{COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"

    # Routen
    def do_GET(self):
        if self.path.startswith("/auth/me"):
            return self.send_json(200, {"user": self.current_user()})
        if self.path.startswith("/auth/check"):
            return self.check()
        self.send_json(404, {"error": "Nicht gefunden"})

    def do_POST(self):
        # Nur JSON: normale HTML-Formulare fremder Seiten können das nicht senden (CSRF-Schutz).
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.send_json(415, {"error": "JSON erwartet"})
        if self.path == "/auth/login":
            return self.login()
        if self.path == "/auth/logout":
            return self.send_json(200, {"user": None}, cookie=self.cookie_header("", 0))
        self.send_json(404, {"error": "Nicht gefunden"})

    def check(self):
        if self.current_user():
            self.send_response(204)
            self.end_headers()
            return
        original = self.headers.get("X-Forwarded-Uri", "/")
        is_page = self.headers.get("X-Forwarded-Method", "GET") == "GET" and "text/html" in self.headers.get("Accept", "")
        if is_page:
            self.send_response(302)
            self.send_header("Location", "/?login=1&next=" + quote(safe_next(original), safe="/"))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
        else:
            self.send_json(401, {"status": 401, "message": "Nicht angemeldet – bitte auf der Startseite anmelden."})

    def login(self):
        ip = self.client_ip()
        now = time.time()
        with _lock:
            recent = [t for t in _failures.get(ip, []) if now - t < FAILURE_WINDOW]
            _failures[ip] = recent
            if len(recent) >= MAX_FAILURES:
                return self.send_json(429, {"error": "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen."})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 10_000)
            data = json.loads(self.rfile.read(length) or b"{}")
            user, password = str(data.get("user", "")), str(data.get("password", ""))
        except (ValueError, TypeError):
            return self.send_json(400, {"error": "Ungültige Anfrage"})

        stored = load_users().get(user)
        ok = bcrypt.checkpw(password.encode(), stored or DUMMY_HASH) and stored is not None
        if not ok:
            with _lock:
                _failures.setdefault(ip, []).append(now)
            print(f"Fehlgeschlagene Anmeldung für {user!r} von {ip}", flush=True)
            return self.send_json(401, {"error": "Benutzername oder Passwort falsch."})
        with _lock:
            _failures.pop(ip, None)
        print(f"Angemeldet: {user} von {ip}", flush=True)
        self.send_json(200, {"user": user}, cookie=self.cookie_header(make_token(user), SESSION_DAYS * 86400))


if __name__ == "__main__":
    load_users()  # früh scheitern, falls die Datei fehlt
    print(f"homeserver-auth lauscht auf 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
