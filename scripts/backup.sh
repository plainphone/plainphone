#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
umask 077
source "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

if [[ -z ${BACKUP_MODE:-} ]]; then
    echo 'Off-site backup is not configured (BACKUP_MODE is unset)'
    exit 0
fi
configure_storage
storage=$(storage_uri)
: "${BACKUP_AGE_RECIPIENT:?Set the public age recipient}"
: "${BACKUP_STATUS_FILE:?Set the path to the last-success status file}"

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
case "$BACKUP_MODE" in
    postgres)
        : "${PGHOST:?Set the PostgreSQL host}"
        : "${PGUSER:?Set the PostgreSQL user}"
        : "${PGDATABASE:?Set the PostgreSQL database}"
        min_bytes=${BACKUP_MIN_DUMP_BYTES:-1024}
        [[ $min_bytes =~ ^[1-9][0-9]{0,14}$ ]] || fail 'Invalid BACKUP_MIN_DUMP_BYTES'
        input="$work/plainphone.dump"
        pg_dump --no-password -Fc --file="$input"
        [[ -s $input && $(wc -c < "$input") -ge $min_bytes ]] ||
            fail "PostgreSQL dump is missing or smaller than $min_bytes bytes"
        pg_restore --list "$input" >/dev/null
        extension=dump
        ;;
    dns)
        input=${BACKUP_DNS_CONFIG:-/dns/AdGuardHome.yaml}
        [[ -f $input && -s $input ]] || fail 'AdGuard Home configuration is missing or empty'
        extension=yaml
        ;;
    *)
        fail 'BACKUP_MODE must be postgres or dns'
        ;;
esac

timestamp=$(date -u '+%Y%m%dT%H%M%SZ %u')
read -r stamp weekday <<< "$timestamp"
daily="$BACKUP_MODE/daily/$stamp.$extension.age"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/encrypted.age" "$input"
transfer "$work/encrypted.age" "$storage/$daily"
if [[ $weekday == 7 ]]; then
    transfer "$work/encrypted.age" "$storage/$BACKUP_MODE/weekly/$stamp.$extension.age"
fi

status_tmp=$(mktemp -- "${BACKUP_STATUS_FILE}.XXXXXX")
trap 'rm -rf -- "$work"; rm -f -- "$status_tmp"' EXIT
printf '%s\n' "$daily" > "$status_tmp"
mv -fT -- "$status_tmp" "$BACKUP_STATUS_FILE"
if [[ -n ${BACKUP_HEARTBEAT_URL:-} ]]; then
    # Suppress curl diagnostics because the URL can contain a secret token.
    if ! code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 30 \
        -- "$BACKUP_HEARTBEAT_URL") || [[ $code != 2[0-9][0-9] ]]; then
        fail 'Upload succeeded but heartbeat delivery failed'
    fi
fi
printf 'Off-site backup uploaded: %s\n' "$daily"
