// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const assets = process.argv[2];
for (const name of await readdir(assets)) {
  if (!/\.(css|js)$/.test(name)) continue;
  const path = join(assets, name);
  const body = await readFile(path);
  for (const [suffix, compress] of [[".br", brotliCompressSync], [".gz", gzipSync]]) {
    const output = compress(body);
    if (output.length < body.length) await writeFile(path + suffix, output);
  }
}
