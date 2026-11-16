# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Settings from the environment, and the first-boot AdGuardHome.yaml.

The YAML is only written when no config exists yet. After that AdGuard Home
owns the file (it rewrites it on every change), and ppdns changes it through
the REST API. The privacy settings below are documented in docs/privacy.md.
"""

from __future__ import annotations

import dataclasses
import json
import os

from . import lists


@dataclasses.dataclass(frozen=True)
class Settings:
    domain: str  # e.g. dns.plainphone.org
    adguard_url: str
    adguard_user: str
    adguard_password: str
    adguard_password_hash: str  # bcrypt, only used to write the first config
    api_token: str
    conf_dir: str
    lists_dir: str
    data_dir: str
    cert_file: str
    key_file: str
    dot_host: str  # where the self-test connects (the adguard container)
    kuma_push_url: str
    lists_refresh_hours: float
    selftest_minutes: float
    listen: str
    backup_keep: int

    @classmethod
    def from_env(cls, env=os.environ) -> "Settings":
        def need(key: str) -> str:
            value = env.get(key, "")
            if not value:
                raise SystemExit(f"ppdns: environment variable {key} is required")
            return value

        domain = need("PPDNS_DOMAIN").lower().rstrip(".")
        return cls(
            domain=domain,
            adguard_url=env.get("PPDNS_ADGUARD_URL", "http://adguard:3000"),
            adguard_user=env.get("PPDNS_ADGUARD_USER", "admin"),
            adguard_password=need("PPDNS_ADGUARD_PASSWORD"),
            adguard_password_hash=env.get("PPDNS_ADGUARD_PASSWORD_HASH", ""),
            api_token=need("PPDNS_API_TOKEN"),
            conf_dir=env.get("PPDNS_CONF_DIR", "/opt/adguardhome/conf"),
            lists_dir=env.get("PPDNS_LISTS_DIR", "/opt/adguardhome/work/userfilters"),
            data_dir=env.get("PPDNS_DATA_DIR", "/data"),
            cert_file=env.get("PPDNS_CERT_FILE", f"/certs/certificates/{domain}.crt"),
            key_file=env.get("PPDNS_KEY_FILE", f"/certs/certificates/{domain}.key"),
            dot_host=env.get("PPDNS_DOT_HOST", "adguard"),
            kuma_push_url=env.get("PPDNS_KUMA_PUSH_URL", ""),
            lists_refresh_hours=float(env.get("PPDNS_LISTS_REFRESH_HOURS", "12")),
            selftest_minutes=float(env.get("PPDNS_SELFTEST_MINUTES", "5")),
            listen=env.get("PPDNS_LISTEN", "0.0.0.0:8053"),
            backup_keep=int(env.get("PPDNS_BACKUP_KEEP", "14")),
        )

    @property
    def config_path(self) -> str:
        return os.path.join(self.conf_dir, "AdGuardHome.yaml")


def _q(value: str) -> str:
    """YAML double-quoted scalar (JSON strings are valid YAML)."""
    return json.dumps(value)


def render_adguard_yaml(s: Settings) -> str:
    if not s.adguard_password_hash.startswith("$2"):
        raise SystemExit("ppdns: PPDNS_ADGUARD_PASSWORD_HASH must be a bcrypt hash ($2a$/$2b$/$2y$)")
    filters = []
    for name, url, filter_id in lists.wanted_filters(s.lists_dir):
        filters.append(f"  - enabled: true\n    url: {_q(url)}\n    name: {_q(name)}\n    id: {filter_id}\n")
    return f"""\
# Written once by ppdns on first boot. AdGuard Home owns this file afterwards.
http:
  pprof:
    port: 6060
    enabled: false
  doh:
    routes: []
    insecure_enabled: false
  address: 0.0.0.0:3000
  session_ttl: 12h
users:
  - name: {_q(s.adguard_user)}
    password: {_q(s.adguard_password_hash)}
auth_attempts: 5
block_auth_min: 15
http_proxy: ""
language: en
theme: auto
dns:
  bind_hosts:
    - 0.0.0.0
  port: 53
  anonymize_client_ip: true
  ratelimit: 0
  ratelimit_subnet_len_ipv4: 24
  ratelimit_subnet_len_ipv6: 56
  ratelimit_whitelist: []
  refuse_any: true
  upstream_dns:
    - https://dns10.quad9.net/dns-query
    - https://dns.mullvad.net/dns-query
  upstream_dns_file: ""
  bootstrap_dns:
    - 9.9.9.10
    - 149.112.112.10
    - 2620:fe::10
    - 2620:fe::fe:10
  fallback_dns:
    - https://cloudflare-dns.com/dns-query
  upstream_mode: load_balance
  fastest_timeout: 1s
  allowed_clients:
    - plainphone-no-such-client
  disallowed_clients: []
  blocked_hosts:
    - version.bind
    - id.server
    - hostname.bind
  trusted_proxies:
    - 127.0.0.0/8
    - ::1/128
  cache_enabled: true
  cache_size: 33554432
  cache_ttl_min: 0
  cache_ttl_max: 0
  cache_optimistic: true
  cache_optimistic_answer_ttl: 30s
  cache_optimistic_max_age: 12h
  bogus_nxdomain: []
  aaaa_disabled: false
  enable_dnssec: true
  edns_client_subnet:
    custom_ip: ""
    enabled: false
    use_custom: false
  max_goroutines: 1000
  handle_ddr: false
  ipset: []
  ipset_file: ""
  bootstrap_prefer_ipv6: false
  upstream_timeout: 10s
  private_networks: []
  use_private_ptr_resolvers: false
  local_ptr_upstreams: []
  use_dns64: false
  dns64_prefixes: []
  serve_http3: false
  use_http3_upstreams: false
  serve_plain_dns: true
  hostsfile_enabled: false
  pending_requests:
    enabled: true
tls:
  enabled: true
  server_name: {_q(s.domain)}
  force_https: false
  port_https: 0
  port_dns_over_tls: 853
  port_dns_over_quic: 0
  port_dnscrypt: 0
  dnscrypt_config_file: ""
  certificate_chain: ""
  private_key: ""
  certificate_path: {_q(s.cert_file)}
  private_key_path: {_q(s.key_file)}
  strict_sni_check: false
querylog:
  dir_path: ""
  ignored: []
  interval: 24h
  size_memory: 0
  enabled: false
  ignored_enabled: false
  file_enabled: false
statistics:
  dir_path: ""
  ignored: []
  interval: 24h
  enabled: true
  ignored_enabled: false
filters:
{"".join(filters)}whitelist_filters: []
user_rules: []
dhcp:
  enabled: false
  interface_name: ""
  local_domain_name: lan
  dhcpv4:
    gateway_ip: ""
    subnet_mask: ""
    range_start: ""
    range_end: ""
    lease_duration: 86400
    icmp_timeout_msec: 1000
    options: []
  dhcpv6:
    range_start: ""
    lease_duration: 86400
    ra_slaac_only: false
    ra_allow_slaac: false
filtering:
  blocking_ipv4: ""
  blocking_ipv6: ""
  blocked_services:
    schedule:
      time_zone: UTC
    ids: []
  protection_disabled_until: null
  safe_search:
    enabled: false
    bing: true
    duckduckgo: true
    ecosia: true
    google: true
    pixabay: true
    yandex: true
    youtube: true
  blocking_mode: default
  parental_block_host: family-block.dns.adguard.com
  safebrowsing_block_host: standard-block.dns.adguard.com
  rewrites: []
  safe_fs_patterns:
    - {s.lists_dir.rstrip("/")}/*
  max_http_size: 256MB
  safebrowsing_cache_size: 1048576
  safesearch_cache_size: 1048576
  parental_cache_size: 1048576
  cache_time: 30
  filters_update_interval: 12
  blocked_response_ttl: 10
  filtering_enabled: true
  rewrites_enabled: true
  parental_enabled: false
  safebrowsing_enabled: false
  protection_enabled: true
clients:
  runtime_sources:
    whois: false
    arp: false
    rdns: false
    dhcp: false
    hosts: false
  persistent: []
log:
  enabled: true
  file: ""
  max_backups: 0
  max_size: 100
  max_age: 3
  compress: false
  local_time: false
  verbose: false
os:
  group: ""
  user: ""
  rlimit_nofile: 0
schema_version: 34
"""


def write_first_config(s: Settings) -> bool:
    """Write AdGuardHome.yaml if it does not exist. Returns True if written."""
    if os.path.exists(s.config_path):
        return False
    os.makedirs(s.conf_dir, exist_ok=True)
    tmp = s.config_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as out:
        out.write(render_adguard_yaml(s))
    os.chmod(tmp, 0o600)
    os.replace(tmp, s.config_path)
    return True
