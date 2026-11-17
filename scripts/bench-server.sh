#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
set -eu
cd "$(dirname "$0")/../server"
exec pnpm exec tsx test/bench-rules.ts "$@"
