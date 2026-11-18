#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Start the whole DNS stack with a self-signed certificate, run the end-to-end
# tests over DNS-over-TLS against it, and tear it down again.
# Needs: docker compose, openssl, python3, internet access (blocklists, upstream DNS).
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN=dns.test
PROJECT=ppdns-test-$(openssl rand -hex 6)
export COMPOSE_PROJECT_NAME=$PROJECT
compose() { docker compose -f compose.yaml -f compose.test.yaml "$@"; }

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then compose logs --no-color --tail 80 || true; fi
  if [ "${KEEP:-0}" = 1 ]; then echo "KEEP=1: stack left running (project $PROJECT)"; exit $status; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf tests/.certs .env
  exit $status
}
if [ -e .env ] || [ -e tests/.certs ]; then echo "Test config already exists" >&2; exit 2; fi
trap cleanup EXIT

mkdir -p tests/.certs/certificates
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN" \
  -keyout "tests/.certs/certificates/$DOMAIN.key" -out "tests/.certs/certificates/$DOMAIN.crt" 2>/dev/null
chmod 644 tests/.certs/certificates/*

PASSWORD=$(openssl rand -hex 16)
TOKEN=$(openssl rand -hex 32)
HASH=$(python3 - "$PASSWORD" <<'PY'
import sys, subprocess
# bcrypt via the htpasswd-compatible openssl-free route: use docker's httpd image only if needed
try:
    import bcrypt  # type: ignore
    print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(10)).decode())
except ImportError:
    out = subprocess.run(["docker", "run", "--rm", "httpd:2.4-alpine", "htpasswd", "-nbBC", "10", "", sys.argv[1]],
                         check=True, capture_output=True, text=True).stdout
    print(out.strip().split(":", 1)[1])
PY
)
umask 077
cat > .env <<ENV
PPDNS_DOMAIN=$DOMAIN
CLOUDFLARE_DNS_API_TOKEN=unused
PPDNS_ADGUARD_USER=admin
PPDNS_ADGUARD_PASSWORD=$PASSWORD
PPDNS_ADGUARD_PASSWORD_HASH='$HASH'
PPDNS_API_TOKEN=$TOKEN
PPDNS_ADMIN_BIND=127.0.0.1
PPDNS_API_BIND=127.0.0.1
# Keep background probes out of the stats assertions. Run a self-test explicitly below.
PPDNS_SELFTEST_MINUTES=0
ENV

compose up -d --build --wait --wait-timeout 600

export PPDNS_TEST_SERVER=127.0.0.1 PPDNS_TEST_DOMAIN=$DOMAIN PPDNS_API_TOKEN=$TOKEN
PPDNS_TEST_API=http://$(compose port api 8053)
PPDNS_TEST_ADGUARD=http://$(compose port adguard 3000)
export PPDNS_TEST_API PPDNS_TEST_ADGUARD
export PPDNS_ADGUARD_PASSWORD=$PASSWORD
DOT_BIND=$(compose port adguard 853)
export PPDNS_TEST_PORT=${DOT_BIND##*:}
# AdGuard loads the big lists in the background after start; wait until ads are blocked.
python3 - <<'PY'
import sys, time
sys.path.insert(0, ".")
from tests.test_e2e import api, ask
_, out = api("POST", "/v1/clients", {"profile": "child"})
cid = out["client_id"]
deadline = time.time() + 300
while time.time() < deadline:
    try:
        if ask(cid, "pornhub.com").blocked:
            break
    except OSError:
        pass
    time.sleep(3)
else:
    sys.exit("filters never became active")
api("DELETE", f"/v1/clients/{cid}")
PY

python3 -m unittest discover -s tests -p 'test_*.py' -v
compose exec -T api python -m ppdns selftest

echo "== backup and restore (docs/self-hosting-dns.md, step 7)"
CID=$(python3 -c 'import sys; sys.path.insert(0, "."); from tests.test_e2e import api; print(api("POST", "/v1/clients", {"profile": "child"})[1]["client_id"])')
BACKUP=$(compose exec -T api python -m ppdns backup | tail -1)
python3 -c "import sys; sys.path.insert(0, '.'); from tests.test_e2e import api; api('DELETE', '/v1/clients/$CID')"
compose stop adguard
docker run --rm -v "${PROJECT}_data":/data -v "${PROJECT}_conf":/conf alpine:3.24 \
  tar xzf "/data/backups/$BACKUP" -C /conf
compose start adguard
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$PPDNS_TEST_API/v1/clients/$CID" || true)
  [ "$code" = 200 ] && break
  sleep 2
done
[ "$code" = 200 ] || { echo "restored client not found ($code)"; exit 1; }
echo "restore OK: the deleted phone is back after restoring $BACKUP"
