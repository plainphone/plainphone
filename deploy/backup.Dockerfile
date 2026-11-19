# SPDX-License-Identifier: Apache-2.0
FROM postgres:18

RUN apt-get update \
    && apt-get install -y --no-install-recommends age awscli ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/backup.sh scripts/restore-backup.sh scripts/backup-common.sh scripts/restore-service.py /usr/local/bin/
ENTRYPOINT ["backup.sh"]
