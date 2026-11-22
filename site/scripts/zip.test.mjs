// SPDX-License-Identifier: Apache-2.0
// The press kit zip: readable entries, correct checksums, the same bytes on every build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";
import { zip } from "../zip.mjs";

const entries = [
  { name: "logo/plainphone-logo.svg", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'.repeat(20)) },
  { name: "screenshots/da/home-light.webp", data: Buffer.from([1, 2, 3, 4, 5, 250, 251, 252]) },
  { name: "fonts/OFL.txt", data: Buffer.from("æøå äöüß\n") },
];

function read(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, name);
    out.push({ name, method, data });
    at += 46 + nameLength;
  }
  return out;
}

test("every entry reads back with its name, bytes and checksum", () => {
  const files = read(zip(entries));
  assert.deepEqual(files.map((f) => f.name), entries.map((e) => e.name));
  files.forEach((f, i) => assert.deepEqual(f.data, entries[i].data));
});

test("text is deflated and images are stored", () => {
  const [svg, webp, txt] = read(zip(entries));
  assert.equal(svg.method, 8);
  assert.equal(webp.method, 0);
  assert.equal(txt.method, 8);
});

test("the same input gives the same bytes", () => {
  assert.deepEqual(zip(entries), zip(entries));
});
