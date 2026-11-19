#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
umask 077
source "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

[[ $# -ge 2 && $# -le 3 ]] ||
    fail 'Usage: restore-backup.sh OBJECT AGE_IDENTITY [DNS_OUTPUT_FILE]'
object=$1
identity=$2
[[ $object =~ ^(postgres|dns)/(daily|weekly)/[0-9]{8}T[0-9]{6}Z\.(dump|yaml)\.age$ ]] ||
    fail 'Expected an object path relative to BACKUP_S3_PREFIX'
configure_storage
storage=$(storage_uri)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

case "$object" in
    postgres/*.dump.age)
        [[ $# == 2 ]] || fail 'PostgreSQL restore takes no output file'
        : "${RESTORE_DATABASE_URL:?Set the scratch PostgreSQL URL}"
        populated=$(psql -X --no-password --dbname="$RESTORE_DATABASE_URL" -Atqc "
            SELECT EXISTS (
                SELECT FROM pg_namespace
                WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_'
                UNION ALL
                SELECT FROM pg_depend WHERE refobjid = 'public'::regnamespace
                    AND refclassid = 'pg_namespace'::regclass
            )")
        [[ $populated == f ]] || fail 'Use a fresh scratch database'
        transfer "$storage/$object" "$work/encrypted.age"
        age -d -i "$identity" -o "$work/plainphone.dump" "$work/encrypted.age"
        pg_restore --no-password --dbname="$RESTORE_DATABASE_URL" --single-transaction \
            --exit-on-error --no-owner --no-privileges "$work/plainphone.dump"
        ;;
    dns/*.yaml.age)
        [[ $# == 3 && ! -e $3 && ! -L $3 ]] || fail 'Supply a new DNS output file'
        transfer "$storage/$object" "$work/encrypted.age"
        age -d -i "$identity" -o "$work/AdGuardHome.yaml" "$work/encrypted.age"
        (set -o noclobber; cat "$work/AdGuardHome.yaml" > "$3")
        ;;
    *)
        fail 'Object type does not match the backup source'
        ;;
esac
printf 'Restored %s\n' "$object"
