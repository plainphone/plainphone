# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Minimal client for the AdGuard Home REST API (/control/...)."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request


class AdGuardError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"AdGuard API {status}: {message}")
        self.status = status


class AdGuard:
    def __init__(self, base_url: str, username: str, password: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth = f"Basic {token}"
        self.timeout = timeout

    def _call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base_url + path, data=data, method=method)
        request.add_header("Authorization", self._auth)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raise AdGuardError(exc.code, exc.read().decode("utf-8", "replace").strip()) from None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return raw.decode("utf-8", "replace")

    # status ---------------------------------------------------------------
    def status(self) -> dict:
        return self._call("GET", "/control/status")

    # clients --------------------------------------------------------------
    def clients(self) -> list[dict]:
        return self._call("GET", "/control/clients").get("clients") or []

    def add_client(self, client: dict) -> None:
        self._call("POST", "/control/clients/add", client)

    def update_client(self, name: str, client: dict) -> None:
        self._call("POST", "/control/clients/update", {"name": name, "data": client})

    def delete_client(self, name: str) -> None:
        self._call("POST", "/control/clients/delete", {"name": name})

    def blocked_services_catalogue(self) -> list[dict]:
        return self._call("GET", "/control/blocked_services/all").get("blocked_services") or []

    # access list ----------------------------------------------------------
    def access(self) -> dict:
        return self._call("GET", "/control/access/list")

    def set_access(self, access: dict) -> None:
        self._call("POST", "/control/access/set", access)

    # user rules -----------------------------------------------------------
    def user_rules(self) -> list[str]:
        return self._call("GET", "/control/filtering/status").get("user_rules") or []

    def set_user_rules(self, rules: list[str]) -> None:
        self._call("POST", "/control/filtering/set_rules", {"rules": rules})

    def filters(self) -> list[dict]:
        return self._call("GET", "/control/filtering/status").get("filters") or []

    def add_filter(self, name: str, url: str) -> None:
        self._call("POST", "/control/filtering/add_url", {"name": name, "url": url, "whitelist": False})

    def refresh_filters(self) -> None:
        self._call("POST", "/control/filtering/refresh", {"whitelist": False})

    # TLS ------------------------------------------------------------------
    def tls_status(self) -> dict:
        return self._call("GET", "/control/tls/status")

    def tls_configure(self, config: dict) -> dict:
        return self._call("POST", "/control/tls/configure", config)
