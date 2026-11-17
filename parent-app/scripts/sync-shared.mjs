// SPDX-License-Identifier: Apache-2.0
//
// The parent app shares its copy, formatting and change descriptions with the PWA.
// These files are platform-free TypeScript, so they are copied verbatim from web/src
// into src/shared. Run `pnpm sync:shared` after changing them in web/. CI warns when the
// committed copies have drifted, then tests the app with the PWA's current files.

import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..", "..", "web", "src");
const shared = join(here, "..", "src", "shared");

export const FILES = ["i18n/en.ts", "i18n/da.ts", "i18n/translate.ts", "lib/format.ts", "lib/failedPolicies.ts", "lib/ops.ts", "lib/settings.ts"];

const check = process.argv.includes("--check");
let drift = 0;
for (const f of FILES) {
  const from = join(webSrc, f);
  const to = join(shared, f);
  if (check) {
    if (!existsSync(to) || readFileSync(from, "utf8") !== readFileSync(to, "utf8")) {
      console.error(`out of date: src/shared/${f} (run pnpm sync:shared)`);
      drift++;
    }
  } else {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`copied web/src/${f}`);
  }
}
if (drift) process.exit(1);
