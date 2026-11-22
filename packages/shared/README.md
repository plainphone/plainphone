# @plainphone/shared

Platform-free logic that the web dashboard and the parent app show the same way: formatting
(`format.ts`), phone state and health, approvals, more time, how a change reads (`ops.ts`),
settings, billing, live-update parsing and the rest. Nothing here touches the DOM or React
Native; timers and `fetch` are the only globals used.

`models.ts` holds the domain types these files work with (`Op` and the types it is built
from). `web/src/lib/api.ts` and `parent-app/src/api/models.ts` re-export them.

Import a file by name: `import { formatDateTime } from "@plainphone/shared/format"`. The tests
for these files run with the web app (`web/src/lib/*.test.ts`) and the parent app
(`parent-app/__tests__`).
