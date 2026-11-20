#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Builds forged-leaf.pem: a self-made chain (leaf first) where the attested key's certificate
# carries a record for the challenge "genuine", and a further certificate signed by that key
# carries a second record for the challenge "forged". It stands for someone who controls an
# attested key and appends a certificate with a record of their own. Not a Google root, so it
# can never verify; the test only checks which record the server reads.
set -euo pipefail
out="$(cd "$(dirname "$0")" && pwd)/forged-leaf.pem"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

# KeyDescription: version 3, TEE, keymaster 4, TEE, challenge, empty uniqueId and lists.
record() {
  local hex len
  hex="$(printf '%s' "$1" | od -An -tx1 | tr -d ' \n')"
  len=$(( ${#hex} / 2 ))
  local body="020103""0a0101""020104""0a0101""04$(printf '%02x' "$len")$hex""0400""3000""3000"
  printf '30%02x%s' $(( ${#body} / 2 )) "$body" | sed 's/../&:/g; s/:$//'
}

key() { openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1" 2>/dev/null; }
key root.key
key attested.key
key forged.key

openssl req -x509 -new -key root.key -subj "/CN=Test root" -days 3650 -out root.pem
printf '[ext]\n1.3.6.1.4.1.11129.2.1.17=DER:%s\n' "$(record genuine)" > attested.cnf
printf '[ext]\n1.3.6.1.4.1.11129.2.1.17=DER:%s\n' "$(record forged)" > forged.cnf

openssl req -new -key attested.key -subj "/CN=Android Keystore Key" -out attested.csr
openssl x509 -req -in attested.csr -CA root.pem -CAkey root.key -days 3650 \
  -extfile attested.cnf -extensions ext -out attested.pem 2>/dev/null
openssl req -new -key forged.key -subj "/CN=Appended" -out forged.csr
openssl x509 -req -in forged.csr -CA attested.pem -CAkey attested.key -days 3650 \
  -extfile forged.cnf -extensions ext -out forged.pem 2>/dev/null

cat forged.pem attested.pem root.pem > "$out"
