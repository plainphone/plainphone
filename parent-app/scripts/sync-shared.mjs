// SPDX-License-Identifier: Apache-2.0
//
// The parent app shares its copy, formatting and change descriptions with the PWA.
// These files are platform-free TypeScript, so they are copied from web/src
// into src/shared. Run `pnpm sync:shared` after changing them in web/. CI warns when the
// committed copies have drifted, then tests the app with the PWA's current files.

import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..", "..", "web", "src");
const shared = join(here, "..", "src", "shared");

export const FILES = ["i18n/en.ts", "i18n/da.ts", "i18n/sv.ts", "i18n/nb.ts", "i18n/de.ts", "lib/phone-language.ts", "i18n/translate.ts", "lib/format.ts", "lib/failedPolicies.ts", "lib/filter-status.ts", "lib/lock-steps.ts", "lib/ops.ts", "lib/phoneUpdate.ts", "lib/phoneSupport.ts", "lib/settings.ts", "lib/phone-state.ts", "lib/approval-state.ts", "lib/more-time.ts", "lib/status-fixtures.ts", "i18n/status.ts", "lib/phone-health.ts", "lib/weekly-summary.ts", "lib/sos-options.ts", "i18n/app-updates.ts", "lib/app-updates.ts", "i18n/platform.ts", "lib/platform.ts", "i18n/modes.ts", "lib/liftedPolicies.ts"];

const check = process.argv.includes("--check");
let drift = 0;
for (const f of FILES) {
  const from = join(webSrc, f);
  const to = join(shared, f);
  const source = readFileSync(from, "utf8");
  const content = source;
  if (check) {
    if (!existsSync(to) || content !== readFileSync(to, "utf8")) {
      console.error(`out of date: src/shared/${f} (run pnpm sync:shared)`);
      drift++;
    }
  } else {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, content);
    console.log(`copied web/src/${f}`);
  }
}
if (drift) process.exit(1);
