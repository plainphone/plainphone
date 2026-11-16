# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Daily backup of the AdGuard Home configuration.

AdGuardHome.yaml holds everything that matters: every phone's ClientID and
profile, the per-phone domain rules and the access list. Blocklists and the
certificate are re-created automatically, so they are not backed up.

Each backup is a .tar.gz kept in the data volume (last PPDNS_BACKUP_KEEP), and
optionally uploaded to S3-compatible storage (AWS Signature V4, standard
library only) when PPDNS_BACKUP_S3_* is set.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import io
import logging
import os
import tarfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

log = logging.getLogger("ppdns.backup")


def make_archive(conf_dir: str) -> tuple[str, bytes]:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(os.path.join(conf_dir, "AdGuardHome.yaml"), arcname="AdGuardHome.yaml")
    return f"adguard-conf-{stamp}.tar.gz", buf.getvalue()


def keep_local(backup_dir: str, name: str, data: bytes, keep: int) -> None:
    os.makedirs(backup_dir, mode=0o700, exist_ok=True)
    path = os.path.join(backup_dir, name)
    with open(path, "wb") as out:
        out.write(data)
    os.chmod(path, 0o600)
    old = sorted(f for f in os.listdir(backup_dir) if f.startswith("adguard-conf-"))
    for stale in old[:-keep] if keep > 0 else []:
        os.unlink(os.path.join(backup_dir, stale))


class S3:
    """Just enough S3 for PUT, LIST and DELETE with path-style URLs."""

    def __init__(self, endpoint: str, region: str, bucket: str, access_key: str, secret_key: str):
        self.endpoint = endpoint.rstrip("/")
        self.host = urllib.parse.urlparse(self.endpoint).netloc
        self.region, self.bucket = region, bucket
        self.access_key, self.secret_key = access_key, secret_key

    def _request(self, method: str, key: str = "", query: dict | None = None, body: bytes = b""):
        now = dt.datetime.now(dt.timezone.utc)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        path = "/" + self.bucket + ("/" + urllib.parse.quote(key, safe="/~") if key else "")
        canonical_query = "&".join(
            f"{urllib.parse.quote(k, safe='~')}={urllib.parse.quote(str(v), safe='~')}"
            for k, v in sorted((query or {}).items())
        )
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = {"host": self.host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
        signed = ";".join(sorted(headers))
        canonical = "\n".join([
            method, path, canonical_query,
            "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)), signed, payload_hash,
        ])
        scope = f"{day}/{self.region}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        key_bytes = ("AWS4" + self.secret_key).encode()
        for part in (day, self.region, "s3", "aws4_request"):
            key_bytes = hmac.new(key_bytes, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key_bytes, to_sign.encode(), hashlib.sha256).hexdigest()
        request = urllib.request.Request(
            self.endpoint + path + ("?" + canonical_query if canonical_query else ""),
            data=body if method == "PUT" else None,
            method=method,
        )
        for name, value in headers.items():
            if name != "host":
                request.add_header(name, value)
        request.add_header(
            "Authorization",
            f"AWS4-HMAC-SHA256 Credential={self.access_key}/{scope}, SignedHeaders={signed}, Signature={signature}",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()

    def put(self, key: str, data: bytes) -> None:
        self._request("PUT", key, body=data)

    def list(self, prefix: str) -> list[str]:
        raw = self._request("GET", query={"list-type": "2", "prefix": prefix})
        root = ET.fromstring(raw)
        ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
        return sorted(el.text for el in root.iter(f"{ns}Key") if el.text)

    def delete(self, key: str) -> None:
        self._request("DELETE", key)


def s3_from_env(env=os.environ) -> tuple[S3, str] | None:
    bucket = env.get("PPDNS_BACKUP_S3_BUCKET", "")
    if not bucket:
        return None
    s3 = S3(
        env["PPDNS_BACKUP_S3_ENDPOINT"],
        env.get("PPDNS_BACKUP_S3_REGION", "us-east-1"),
        bucket,
        env["PPDNS_BACKUP_S3_ACCESS_KEY"],
        env["PPDNS_BACKUP_S3_SECRET_KEY"],
    )
    prefix = env.get("PPDNS_BACKUP_S3_PREFIX", "plainphone-dns/").strip("/") + "/"
    return s3, prefix


def run(conf_dir: str, data_dir: str, keep: int = 14, env=os.environ) -> str:
    name, data = make_archive(conf_dir)
    keep_local(os.path.join(data_dir, "backups"), name, data, keep)
    remote = s3_from_env(env)
    if remote:
        s3, prefix = remote
        s3.put(prefix + name, data)
        stored = [k for k in s3.list(prefix) if k.rsplit("/", 1)[-1].startswith("adguard-conf-")]
        for stale in stored[:-keep] if keep > 0 else []:
            s3.delete(stale)
        log.info("backup %s uploaded (%d kept remotely)", name, min(len(stored), keep))
    else:
        log.info("backup %s kept locally only", name)
    return name
