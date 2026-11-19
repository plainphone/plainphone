#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")/.."
project="plainphone-backup-test-$$-$RANDOM"
cleanup() {
    docker rm -fv "$project-db" "$project-storage" >/dev/null 2>&1 || true
    docker network rm "$project" >/dev/null 2>&1 || true
    docker image rm "$project" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -f deploy/backup.Dockerfile -t "$project" .
docker network create "$project" >/dev/null
docker run -d --network "$project" --network-alias db --name "$project-db" \
    -e POSTGRES_PASSWORD=test-password postgres:18 >/dev/null
docker run -d --network "$project" --network-alias storage --name "$project-storage" \
    --mount "type=bind,src=$PWD/scripts/backup-test/storage.py,dst=/storage.py,readonly" \
    --entrypoint python3 "$project" /storage.py >/dev/null

docker run --rm -i --network "$project" --entrypoint bash "$project" -eu -o pipefail <<'TEST'
export PGHOST=db PGUSER=postgres PGPASSWORD=test-password
export BACKUP_S3_ENDPOINT=http://storage:8080 BACKUP_S3_BUCKET=tests BACKUP_S3_PREFIX=roundtrip
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test-secret
export BACKUP_HEARTBEAT_URL=http://storage:8080/heartbeat?token=test-token
export BACKUP_STATUS_FILE=/tmp/last-success
for attempt in {1..30}; do
    if psql -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1 &&
        curl -fsS http://storage:8080/health >/dev/null; then
        break
    fi
    sleep 1
done
createdb source
createdb scratch
psql -d source -v ON_ERROR_STOP=1 -qc "CREATE TABLE fixture (value text NOT NULL); INSERT INTO fixture VALUES ('restored row');"
age-keygen -o /tmp/identity
export BACKUP_AGE_RECIPIENT
BACKUP_AGE_RECIPIENT=$(age-keygen -y /tmp/identity)
export BACKUP_MODE=postgres PGDATABASE=source
# Simulate a Monday catch-up after a missed Sunday run.
mkdir /tmp/test-bin
cat > /tmp/test-bin/date <<'DATE'
#!/bin/sh
printf '20260105T030000Z 2026-W02\n'
DATE
chmod +x /tmp/test-bin/date
for executable in curl psql pg_restore; do
    {
        printf '#!/bin/bash\n'
        cat <<'CHECK'
for arg; do
    case "$arg" in
        *test-token*|*test-password*) echo 'Secret passed via process arguments' >&2; exit 1 ;;
    esac
done
CHECK
        printf 'exec %s "$@"\n' "$(command -v "$executable")"
    } > "/tmp/test-bin/$executable"
    chmod +x "/tmp/test-bin/$executable"
done
export PATH="/tmp/test-bin:$PATH"
backup.sh
object=$(cat "$BACKUP_STATUS_FILE")
[[ "$object" == postgres/daily/*.dump.age ]]
PGPASSWORD=wrong RESTORE_DATABASE_URL=postgresql://postgres:test-password@db/scratch restore-backup.sh "$object" /tmp/identity
[[ $(psql -d scratch -Atqc 'SELECT value FROM fixture') == 'restored row' ]]
[[ $(curl -fsSI http://storage:8080/tests/roundtrip/"${object/daily/weekly}" | head -n 1) == *'200 OK'* ]]
if PGPASSWORD=wrong RESTORE_DATABASE_URL=postgresql://postgres:test-password@db/scratch restore-backup.sh "$object" /tmp/identity; then
    echo 'Restore accepted a nonempty target' >&2
    exit 1
fi

sed -i 's/20260105/20260106/' /tmp/test-bin/date
backup.sh
second_object=$(cat "$BACKUP_STATUS_FILE")
[[ "$object" != "$second_object" ]]
[[ $(curl -s -o /dev/null -w '%{http_code}' -I http://storage:8080/tests/roundtrip/"${second_object/daily/weekly}") == 404 ]]

export BACKUP_MODE=dns BACKUP_DNS_CONFIG=/tmp/AdGuardHome.yaml
printf 'clients: []\n' > "$BACKUP_DNS_CONFIG"
backup.sh
dns_object=$(cat "$BACKUP_STATUS_FILE")
[[ "$dns_object" == dns/daily/*.yaml.age ]]
restore-backup.sh "$dns_object" /tmp/identity /tmp/recovered.yaml
cmp "$BACKUP_DNS_CONFIG" /tmp/recovered.yaml

export BACKUP_MODE=postgres BACKUP_MIN_DUMP_BYTES=1000000
if backup.sh; then
    echo 'Undersized dump unexpectedly succeeded' >&2
    exit 1
fi
if PGDATABASE=missing backup.sh; then
    echo 'Missing dump unexpectedly succeeded' >&2
    exit 1
fi
if BACKUP_MODE=dns BACKUP_DNS_CONFIG=/tmp/absent backup.sh; then
    echo 'Missing DNS configuration unexpectedly succeeded' >&2
    exit 1
fi
if BACKUP_S3_BUCKET=reject BACKUP_MIN_DUMP_BYTES=1 backup.sh; then
    echo 'Rejected upload unexpectedly succeeded' >&2
    exit 1
fi
[[ $(cat "$BACKUP_STATUS_FILE") == "$dns_object" ]]
[[ $(curl -fsS http://storage:8080/heartbeat-count) == 3 ]]
env -u BACKUP_MODE backup.sh
echo 'Backup and restore drill passed'
TEST
