# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""HTTP API for the Plainphone server, plus the background jobs.

The API is private: it listens on the compose network (and, if you publish it,
on a private interface such as Tailscale) and every /v1 call needs
`Authorization: Bearer $PPDNS_API_TOKEN`. The interface is documented in
dns/README.md.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import backup, dot, lists
from .adguard import AdGuard, AdGuardError
from .config import Settings
from .service import Conflict, NotFound, Service

log = logging.getLogger("ppdns.server")
MAX_BODY = 64 * 1024

# Used by the self-test. Blocked by every profile (HaGeZi Pro + OISD), and the
# allowed one must resolve.
SELFTEST_ALLOWED = "example.com"
SELFTEST_BLOCKED = "googlesyndication.com"


class Api(BaseHTTPRequestHandler):
    service: Service
    token: str
    server_version = "ppdns"
    sys_version = ""

    # plumbing -------------------------------------------------------------
    def log_message(self, fmt, *args):  # no client IPs in the logs (docs/privacy.md)
        log.info("%s %s -> %s", self.command, self.path.split("?")[0].rsplit("/", 1)[0], args[1] if len(args) > 1 else "")

    def _send(self, status: int, body=None) -> None:
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        if body is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, message: str) -> None:
        self._send(status, {"error": message})

    def _authorised(self) -> bool:
        header = self.headers.get("Authorization", "")
        given = header[7:] if header.startswith("Bearer ") else ""
        return hmac.compare_digest(given.encode(), self.token.encode())

    def _json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return body

    def _route(self, method: str) -> None:
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        if method == "GET" and path == "/healthz":
            return self._health()
        if not path.startswith("/v1/"):
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        if not self._authorised():
            return self._error(HTTPStatus.UNAUTHORIZED, "missing or wrong bearer token")
        parts = path.split("/")[2:]
        try:
            if parts == ["profiles"] and method == "GET":
                return self._send(HTTPStatus.OK, {"profiles": ["child", "self"]})
            if parts == ["clients"] and method == "GET":
                return self._send(HTTPStatus.OK, {"clients": self.service.list()})
            if parts == ["clients"] and method == "POST":
                body = self._json()
                client_id = body.get("client_id")
                if client_id is not None and not isinstance(client_id, str):
                    raise ValueError("client_id must be a string")
                created = self.service.create(
                    body.get("profile", ""),
                    _bool(body, "block_adult"),
                    client_id,
                    allow_domains=_list(body, "allow_domains"),
                    block_domains=_list(body, "block_domains"),
                )
                return self._send(HTTPStatus.CREATED, created)
            if len(parts) == 2 and parts[0] == "clients":
                client_id = parts[1]
                if method == "GET":
                    return self._send(HTTPStatus.OK, self.service.get(client_id))
                if method == "PATCH":
                    body = self._json()
                    return self._send(
                        HTTPStatus.OK,
                        self.service.update(
                            client_id,
                            profile=body.get("profile"),
                            block_adult=_bool(body, "block_adult"),
                            allow_domains=_list(body, "allow_domains"),
                            block_domains=_list(body, "block_domains"),
                        ),
                    )
                if method == "DELETE":
                    self.service.delete(client_id)
                    return self._send(HTTPStatus.NO_CONTENT)
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        except NotFound:
            return self._error(HTTPStatus.NOT_FOUND, "no such client")
        except Conflict:
            return self._error(HTTPStatus.CONFLICT, "client_id already exists")
        except (ValueError, TypeError) as exc:
            return self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except AdGuardError as exc:
            log.error("adguard: %s", exc)
            return self._error(HTTPStatus.BAD_GATEWAY, "AdGuard Home rejected the change")

    def _health(self) -> None:
        try:
            running = bool(self.service.adguard.status().get("running"))
        except Exception:  # noqa: BLE001
            running = False
        self._send(HTTPStatus.OK if running else HTTPStatus.SERVICE_UNAVAILABLE, {"adguard": running})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")


def _bool(body: dict, key: str):
    value = body.get(key)
    if value is not None and not isinstance(value, bool):
        raise ValueError(f"{key} must be true or false")
    return value


def _list(body: dict, key: str):
    value = body.get(key)
    if value is not None and not (isinstance(value, list) and all(isinstance(v, str) for v in value)):
        raise ValueError(f"{key} must be a list of domain names")
    if value is not None and len(value) > 1000:
        raise ValueError(f"{key} has more than 1000 entries")
    return value


# background jobs ----------------------------------------------------------


def _every(seconds: float, job, name: str) -> None:
    def loop():
        while True:
            time.sleep(seconds)
            try:
                job()
            except Exception:  # noqa: BLE001
                log.exception("%s failed", name)

    threading.Thread(target=loop, name=name, daemon=True).start()


class Jobs:
    def __init__(self, settings: Settings, service: Service):
        self.s = settings
        self.service = service
        self._cert_mtime = _mtime(settings.cert_file)
        self.monitor_id = ""

    def ensure_filters(self) -> list[str]:
        """Add lists that a newer ppdns knows but this install's config does not (upgrades)."""
        lists.write_static(self.s.lists_dir)
        have = {f.get("url") for f in self.service.adguard.filters()}
        added = []
        for name, url, _ in lists.wanted_filters(self.s.lists_dir):
            if url not in have:
                self.service.adguard.add_filter(name, url)
                added.append(name)
        if added:
            log.info("added filter lists: %s", ", ".join(added))
        return added

    def backup(self) -> None:
        backup.run(self.s.conf_dir, self.s.data_dir, self.s.backup_keep)

    def backup_age_hours(self):
        folder = os.path.join(self.s.data_dir, "backups")
        try:
            newest = max(
                os.stat(os.path.join(folder, f)).st_mtime for f in os.listdir(folder) if f.startswith("adguard-conf-")
            )
        except (OSError, ValueError):
            return None
        return (time.time() - newest) / 3600

    def refresh_lists(self) -> None:
        lists.build(self.s.lists_dir)
        self.service.adguard.refresh_filters()

    def reload_cert(self, force: bool = False) -> None:
        """Make AdGuard re-read the certificate after lego renewed it."""
        mtime = _mtime(self.s.cert_file)
        if mtime is None or (mtime == self._cert_mtime and not force):
            return
        current = self.service.adguard.tls_status()
        config = {k: current[k] for k in (
            "enabled", "server_name", "force_https", "port_https", "port_dns_over_tls",
            "port_dns_over_quic", "port_dnscrypt", "dnscrypt_config_file",
            "certificate_path", "private_key_path", "serve_plain_dns",
        ) if k in current}
        config.update(certificate_chain="", private_key="", private_key_saved=False)
        self.service.adguard.tls_configure(config)
        self._cert_mtime = mtime
        log.info("TLS certificate reloaded")

    def selftest(self) -> tuple[bool, str]:
        tls_name = f"{self.monitor_id}.{self.s.domain}"
        try:
            allowed = dot.query(SELFTEST_ALLOWED, server=self.s.dot_host, tls_name=tls_name, verify=False)
            blocked = dot.query(SELFTEST_BLOCKED, server=self.s.dot_host, tls_name=tls_name, verify=False)
        except Exception as exc:  # noqa: BLE001
            return False, f"DoT query failed: {exc.__class__.__name__}"
        if allowed.rcode != "NOERROR" or not (allowed.a or allowed.aaaa) or allowed.blocked:
            return False, f"{SELFTEST_ALLOWED} did not resolve ({allowed.rcode})"
        if not blocked.blocked:
            return False, f"{SELFTEST_BLOCKED} was not blocked"
        age = self.backup_age_hours()
        if age is None or age > 36:
            return False, "no configuration backup in the last 36 hours"
        if backup.s3_from_env() is not None:
            uploaded = self.upload_age_hours()
            if uploaded is None or uploaded > 36:
                return False, "no off-site backup upload in the last 36 hours"
        # The certificate AdGuard actually serves, not the file: a missed reload shows up here.
        try:
            served = dot.served_cert_days(self.s.dot_host, tls_name)
        except Exception as exc:  # noqa: BLE001
            return False, f"could not read the served certificate: {exc.__class__.__name__}"
        on_disk = _cert_days(self.s.cert_file)
        if on_disk is not None and on_disk - served > 1:
            log.warning("AdGuard serves an older certificate than lego wrote; reloading")
            self.reload_cert(force=True)
        if served < 10:
            return False, f"certificate expires in {served:.0f} days"
        return True, f"OK, certificate {served:.0f} days"

    def upload_age_hours(self):
        try:
            return (time.time() - os.stat(os.path.join(self.s.data_dir, "backups", ".last-upload")).st_mtime) / 3600
        except OSError:
            return None

    def push(self) -> None:
        ok, message = self.selftest()
        if not ok:
            log.warning("self-test: %s", message)
        if not self.s.kuma_push_url:
            return
        query = urllib.parse.urlencode({"status": "up" if ok else "down", "msg": message, "ping": ""})
        url = self.s.kuma_push_url.split("?")[0] + "?" + query
        with urllib.request.urlopen(url, timeout=15) as response:
            response.read()

    def start(self) -> None:
        _every(self.s.lists_refresh_hours * 3600, self.refresh_lists, "lists")
        _every(300, self.reload_cert, "cert")
        _every(self.s.selftest_minutes * 60, self.push, "selftest")
        _every(24 * 3600, self.backup, "backup")


def _mtime(path: str):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return None


def _cert_days(path: str):
    """Days left on a PEM certificate file, without third-party libraries."""
    import ssl

    try:
        info = ssl._ssl._test_decode_cert(path)  # noqa: SLF001 - stdlib, stable since 3.x
    except Exception:  # noqa: BLE001
        return None
    return (ssl.cert_time_to_seconds(info["notAfter"]) - time.time()) / 86400


def wait_for_adguard(adguard: AdGuard, timeout: float = 300) -> None:
    deadline = time.time() + timeout
    while True:
        try:
            adguard.status()
            return
        except Exception:  # noqa: BLE001
            if time.time() > deadline:
                raise
            time.sleep(2)


def serve(settings: Settings) -> None:
    adguard = AdGuard(settings.adguard_url, settings.adguard_user, settings.adguard_password)
    service = Service(adguard, settings.domain, settings.data_dir)
    host, _, port = settings.listen.rpartition(":")
    Api.service = service
    Api.token = settings.api_token
    httpd = ThreadingHTTPServer((host or "0.0.0.0", int(port)), Api)
    threading.Thread(target=httpd.serve_forever, name="http", daemon=True).start()
    log.info("API listening on %s", settings.listen)

    wait_for_adguard(adguard)
    jobs = Jobs(settings, service)
    jobs.ensure_filters()
    jobs.monitor_id = service.ensure_monitor_client()
    log.info("registered ClientIDs: %d", service.sync_access())
    try:
        jobs.backup()  # one at every start, then daily
    except Exception:  # noqa: BLE001
        log.exception("backup failed")
    jobs.start()
    threading.Event().wait()
