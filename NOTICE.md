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
- License: MIT
- Bundled material: `src/suno-production/knowledge/` knowledge files,
  `master_reference.md`, and the `mygpts/lyrics-writer` and
  `mygpts/style-analyzer` prompt instructions embedded in prompt modules.
- Attribution locations: copied source files retain HTML source comments, and
  prompt modules retain attribution constants alongside embedded instructions.

The bundled `sunomanual` material (including the embedded lyrics/style prompt
instructions) is relicensed by its copyright holder under MIT for this package.
Keep the `usedhonda` copyright attribution when redistributing the copied
knowledge files or embedded prompt instructions.

## Vendored suno-cli

This package vendors a built copy of the `suno-cli` tool from the `suno-kit`
project by usedhonda under `vendor/suno-cli/`. It is the Suno create/download CLI
the runtime shells out to; bundling it removes the need for an operator to install
and absolute-path a separate checkout.

- Copyright: Copyright (c) 2026 usedhonda
- License: MIT
- Source: https://github.com/usedhonda/suno-kit (directory: `suno-cli`)
- Bundled material: compiled `dist/src/**` plus `package.json`, `LICENSE`, and
  `README.md`. The vendored source commit is recorded in
  `vendor/suno-cli/VENDOR_COMMIT`.
- Re-sync: run `scripts/sync-suno-cli-vendor.sh` against a local suno-kit checkout
  (see `PUBLISHING.md`). Keep the `usedhonda` copyright and the bundled `LICENSE`
  when redistributing.

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
