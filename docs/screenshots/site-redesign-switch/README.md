# Site redesign in direction C, "Switch"

Full-page screenshots of the English (`/`) and Danish (`/da/`) front pages before and
after the redesign, at 390 and 1280 CSS px, light and dark. Taken with
`site/tools/screenshots.mjs` on 19 November 2026 and reduced to 256-colour PNGs.

| | Before | After |
| --- | --- | --- |
| English, 390 px, light | [before-en-390-light](before-en-390-light.png) | [after-en-390-light](after-en-390-light.png) |
| English, 390 px, dark | [before-en-390-dark](before-en-390-dark.png) | [after-en-390-dark](after-en-390-dark.png) |
| English, 1280 px, light | [before-en-1280-light](before-en-1280-light.png) | [after-en-1280-light](after-en-1280-light.png) |
| English, 1280 px, dark | [before-en-1280-dark](before-en-1280-dark.png) | [after-en-1280-dark](after-en-1280-dark.png) |
| Danish, 390 px, light | [before-da-390-light](before-da-390-light.png) | [after-da-390-light](after-da-390-light.png) |
| Danish, 390 px, dark | [before-da-390-dark](before-da-390-dark.png) | [after-da-390-dark](after-da-390-dark.png) |
| Danish, 1280 px, light | [before-da-1280-light](before-da-1280-light.png) | [after-da-1280-light](after-da-1280-light.png) |
| Danish, 1280 px, dark | [before-da-1280-dark](before-da-1280-dark.png) | [after-da-1280-dark](after-da-1280-dark.png) |

Lighthouse 13.5, mobile, against a local build (no Cloudflare headers), after:

| Page | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| `/` | 100 | 100 | 100 | 100 |
| `/da/` | 100 | 100 | 100 | 100 |
| `/setup/`, `/da/setup/`, `/apps/`, `/da/privacy/` | 100 | 100 | 100 | 100 |
