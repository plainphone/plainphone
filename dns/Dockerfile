# SPDX-License-Identifier: Apache-2.0
# ppdns: the management API next to AdGuard Home. Standard library only.
FROM python:3.15-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY ppdns /app/ppdns
ENTRYPOINT ["python", "-m", "ppdns"]
CMD ["serve"]
