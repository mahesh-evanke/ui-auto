# UI Auto – Setup & Configuration Guide

After installing the ui-auto SDK, use this guide to configure and run tests.

---

## 1. First Steps

1. **Open your app in a browser** (e.g. http://localhost:4200)
2. **Run the element recorder:**
   ```bash
   npx webio
   ```
   This opens the WebIO panel to capture elements, generate locators, and create feature files.

3. **Read the step definitions:** See `e2e/GHERKIN_STEP_DEFINITIONS.md` for all available Gherkin steps.

---

## 2. CLI Commands

| Command | Purpose |
|---------|---------|
| `npx ui-auto init` | Interactive setup – select Web, API, Web+API, Database, Mobile |
| `npx ui-auto init --web --api` | Scaffold specific test types (flags: `--web`, `--api`, `--webui-api`, `--db`, `--mobile`) |
| `npx ui-auto run` | Run E2E tests (uses `e2e/config/wdio.conf.ts`) |
| `npx ui-auto run --tags "@smoke"` | Run tests with tag filter |
| `npx webio` | Element recorder – capture locators and generate features |
| `npm run wdio` | Same as `npx ui-auto run` (if script is added to package.json) |

---

## 3. Config File: `e2e/config/config.yaml`

Edit `e2e/config/config.yaml` to customize:

### 3.1 Viewport & Browser
```yaml
viewportDevice: ""   # e.g. "iPhone 12 Pro", "Pixel 7" for mobile viewport
browserName: chrome  # chrome, brave, firefox, edge, safari
# braveBrowserPath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
# edgeBrowserPath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
```

### 3.2 URLs
```yaml
valUrl: http://localhost:4200/
devUrl: http://localhost:4200/
standaloneUrl: http://localhost:4200/
```

### 3.3 Database (for `@database` features)
```yaml
db:
  type: pgsql
  host: localhost
  port: 5432
  user: postgres
  password: ""
  database: your_database
```

- **PostgreSQL:** Requires `npm install pg`
- **SQLite:** Use `type: sqlite` and `path: /path/to/db.sqlite`; requires `npm install sql.js`

### 3.4 Mobile (Appium)
```yaml
mobile:
  platformName: Android
  browserName: Chrome
  automationName: UiAutomator2
  deviceName: Android Emulator
  # androidSdkRoot: "C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk"
  appiumHost: 127.0.0.1
  appiumPort: 4723
```

---

## 4. Running Tests

```bash
npx ui-auto run
npx ui-auto run --tags "@smoke"
npx ui-auto run --env val --headless
```

---

## 5. Documentation

- **GHERKIN_STEP_DEFINITIONS.md** – All available Gherkin steps (Web, API, Database)
- **SETUP_GUIDE.md** – This file (config & CLI)
