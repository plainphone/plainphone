// Run one cross-runtime step in the wasm32 build of the OpenMLS harness.
// Usage: node run-wasm-step.mjs <wasm-bindgen nodejs glue.js> <dir> <step> <id> [peer]
// Mirrors `mls-harness cross <dir> ...`: reads every file in <dir>, passes
// them to the wasm export, writes back what it returns and deletes the rest.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [glue, dir, ...args] = process.argv.slice(2);
const { cross_step } = createRequire(import.meta.url)(path.resolve(glue));

function encode(files) {
  const parts = [];
  for (const [name, data] of files) {
    const n = Buffer.from(name, "utf8");
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(n.length);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    parts.push(hdr, n, len, data);
  }
  return Buffer.concat(parts);
}

function decode(buf) {
  const files = new Map();
  let i = 0;
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const name = buf.subarray(i + 4, i + 4 + n).toString("utf8");
    i += 4 + n;
    const m = buf.readUInt32BE(i);
    files.set(name, buf.subarray(i + 4, i + 4 + m));
    i += 4 + m;
  }
  return files;
}

const before = new Map(
  fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f))]),
);
const out = Buffer.from(cross_step(args, encode(before)));
const logLen = out.readUInt32BE(0);
console.log(out.subarray(4, 4 + logLen).toString("utf8"));
const after = decode(out.subarray(4 + logLen));
for (const name of before.keys()) {
  if (!after.has(name)) fs.rmSync(path.join(dir, name));
}
for (const [name, data] of after) fs.writeFileSync(path.join(dir, name), data);
