# Notices

This package is designed for distribution as an OpenClaw native plugin.

It may interact with third-party services selected and connected by the operator:
Suno, X/Twitter through Bird, Instagram, and TikTok. Those services are not bundled
with this package and are governed by their own terms, rate limits, account rules,
and developer policies.

## Sunomanual Knowledge Bundle

This package includes a `sunomanual` knowledge bundle from the `sunomanual`
project by usedhonda.

- Copyright: Copyright (c) 2025-2026 usedhonda
- License: Creative Commons Attribution-NonCommercial 4.0 International
  (CC BY-NC 4.0)
- Legal code: https://creativecommons.org/licenses/by-nc/4.0/legalcode
- Bundled material: `src/suno-production/knowledge/` knowledge files,
  `master_reference.md`, and the `mygpts/lyrics-writer` and
  `mygpts/style-analyzer` prompt instructions embedded in prompt modules.
- Attribution locations: copied source files retain HTML source comments, and
  prompt modules retain attribution constants alongside embedded instructions.

NonCommercial term: the bundled `sunomanual` material (including the embedded
lyrics/style prompt instructions) is licensed for non-commercial use only.
Operators must not use or redistribute it for commercial purposes without
separate permission from the copyright holder (usedhonda). The Artist Runtime
code itself is under its own repository license (see LICENSE).

## Third-Party Notices

The runtime dependencies below are used by this package when installed by an
operator. Development-only dependencies are intentionally not listed here.

### Playwright

- Package: `playwright`
- License: Apache-2.0
- Copyright: Copyright (c) Microsoft Corporation
- Project URL: https://playwright.dev
- Source: https://github.com/microsoft/playwright
- Notice: Playwright includes code derived from the Puppeteer project
  (https://github.com/puppeteer/puppeteer), available under the Apache-2.0
  license.

### playwright-extra

- Package: `playwright-extra`
- License: MIT
- Copyright: Copyright (c) 2019 berstend <github@berstend.com>
- Project URL: https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra
- Source: https://github.com/berstend/puppeteer-extra

### puppeteer-extra-plugin-stealth

- Package: `puppeteer-extra-plugin-stealth`
- License: MIT
- Copyright: Copyright (c) 2019 berstend <github@berstend.com>
- Project URL: https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth
- Source: https://github.com/berstend/puppeteer-extra

### Zod

- Package: `zod`
- License: MIT
- Copyright: Copyright (c) 2025 Colin McDonnell
- Project URL: https://zod.dev
- Source: https://github.com/colinhacks/zod
