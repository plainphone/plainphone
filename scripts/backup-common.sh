#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

fail() {
    printf 'Backup error: %s\n' "$*" >&2
    exit 1
}

configure_storage() {
    : "${BACKUP_S3_ENDPOINT:?Set the S3 endpoint URL}"
    : "${BACKUP_S3_BUCKET:?Set the S3 bucket}"
    : "${BACKUP_S3_PREFIX:?Set a dedicated S3 prefix}"
    : "${AWS_ACCESS_KEY_ID:?Set the S3 access key ID}"
    : "${AWS_SECRET_ACCESS_KEY:?Set the S3 secret access key}"
    [[ $BACKUP_S3_PREFIX =~ ^[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$ ]] ||
        fail 'Use a slash-delimited S3 prefix without leading or trailing slashes'
    export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}
    export AWS_EC2_METADATA_DISABLED=true
    # Some S3-compatible providers only implement the required checksums.
    export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
    export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
}

storage_uri() {
    printf 's3://%s/%s' "$BACKUP_S3_BUCKET" "$BACKUP_S3_PREFIX"
}

transfer() {
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp --only-show-errors "$@"
}
