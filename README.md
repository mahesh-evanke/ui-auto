# wdio-playwright-consumer

Feature files + config only. All step definitions and the test execution engine
come from the `wdio-playwright-library` dependency — this repo has no
step-def/support code of its own.

## Setup

1. On the `wdio-playwright-library` branch, build the tarball:
   ```
   npm pack
   ```
2. Copy the resulting `wdio-playwright-library-1.0.0.tgz` into this repo's
   root (same location referenced by the `file:` dependency in
   `package.json`).
3. Install:
   ```
   npm install
   ```

## Running tests

```
npm test
```

Runs every `.feature` file under `e2e/features/` using the step definitions
shipped in `node_modules/wdio-playwright-library/e2e/stepdefinitions/`.

## Layout

- `e2e/features/` — your Gherkin feature files
- `e2e/config/config.yaml` — browser/run configuration (loaded by the library)
- `e2e/locators/` — page locators referenced by your features
- `cucumber.js` — points `require` at the installed library's step defs
- `tsconfig.json` — has a `ts-node.ignore` override so ts-node will transpile
  the library's `.ts` files even though they live under `node_modules`
