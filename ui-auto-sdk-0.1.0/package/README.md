# UI-Auto E2E Framework SDK

A reusable, distributable E2E automation framework SDK. Application teams consume it as an NPM dependency and maintain only **feature files**, **locators**, and **configuration**. All step definitions, browser lifecycle, reporting, and the automation overlay live in this SDK.

## Prerequisites

- Node.js 18+
- Chrome or Edge (and ChromeDriver/EdgeDriver if not using default paths)

## Framework repo (this repo)

1. **Install**: `npm install`
2. **Build**: `npm run build`
3. **Pack for distribution**: `npm run pack:sdk` → produces `ui-auto-sdk-0.1.0.tgz`
4. **Run E2E (dogfooding)**: `npx ui-auto run --tags @saucedemo`  
   Uses `e2e/` as the example consumer (features, locators, config).

Legacy WebdriverIO run (pre-SDK): `npm run wdio` (uses `e2e/config/wdio.conf.ts`).

## Consumer projects

1. Add the SDK as a dev dependency (local `.tgz` or published package). **Install automatically creates** `e2e/` structure, config, locators, and a basic feature.
2. Edit `e2e/config/config.yaml` and locators as needed, then run `npx ui-auto run [--tags ...] [--env ...]`.

See [CONSUMER_QUICKSTART.md](CONSUMER_QUICKSTART.md) for a minimal setup.

## Documentation

| Doc | Purpose |
|-----|---------|
| [CONSUMER_CONTRACT.md](CONSUMER_CONTRACT.md) | Folder structure, config schema, locator format, CLI options. |
| [CONSUMER_QUICKSTART.md](CONSUMER_QUICKSTART.md) | Short guide to add the SDK to a new app. |
| [GHERKIN_STEP_DEFINITIONS.md](GHERKIN_STEP_DEFINITIONS.md) | SDK step reference and run commands (consumers; also in `e2e/` after install). |
| [LEGACY_GHERKIN_STEP_DEFINITIONS.md](LEGACY_GHERKIN_STEP_DEFINITIONS.md) | Legacy step def reference (framework repo `npm run wdio` flow). |

## Browser overlay

The SDK injects a small overlay in the browser during runs (scenario name, status). It appears on scenario start and on navigation. No consumer configuration is required.

## Reports

- **HTML**: `e2e/reportHtml/<timestamp>/index.html`
- **Cucumber JSON**: `{reportFolder}/json/`
- **Failure screenshots**: `{reportFolder}/screenshot/`

`reportFolder` is set in `e2e/config/config.yaml` (default `./reports/integrationTests`).

## Versioning

Semantic versioning. Consumer projects lock to a specific SDK version (e.g. `ui-auto-sdk@0.1.0`).
