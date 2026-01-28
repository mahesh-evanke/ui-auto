# Gherkin Step Definitions Reference (SDK)

Reference for the **core** Gherkin steps provided by the UI-Auto SDK. Use these in your `.feature` files. Define locators in `e2e/locators/` (see CONSUMER_CONTRACT in the SDK docs).

**Total step definitions:** 5  
- **Given:** 3  
- **When:** 1  
- **Then:** 1  

---

## GIVEN

### 1. `Given User navigates to {string} URL`

Opens the given URL in the browser.

**Parameters:**
- `{string}` – Full URL (e.g. `https://example.com/` or `http://localhost:4200/`)

**Example:**
```gherkin
Given User navigates to "http://localhost:4200/" URL
```

---

### 2. `Given User is on {string} screen`

Sets the current page context and waits for the page to load (using `title` / `label` from `e2e/locators/pages.json`). Use after navigation so later steps can resolve elements from the correct page.

**Parameters:**
- `{string}` – Screen name (must match a key in `pages.json`)

**Example:**
```gherkin
And User is on "Login Page" screen
```

---

### 3. `Given enters {string} text in {string} textbox`

Types text into a textbox. Uses the current page’s locators (`e2e/locators/pages/<Page>.json` or `common.json`).

**Parameters:**
- `{string}` – Text to enter. Use `<blank>` to clear the field.
- `{string}` – Element name (e.g. `Username`, `Password`)

**Example:**
```gherkin
And enters "user@example.com" text in "Username" textbox
And enters "<blank>" text in "Username" textbox
```

---

## WHEN

### 4. `When User clicks on {string} button`

Clicks a button. Uses the current page’s locators.

**Parameters:**
- `{string}` – Button element name (e.g. `Login`, `Submit`)

**Example:**
```gherkin
When User clicks on "Login" button
```

---

## THEN

### 5. `Then User is on {string} screen`

Asserts that the user is on the given screen. Sets the current page and waits for the page (title/label from `pages.json`).

**Parameters:**
- `{string}` – Screen name (must match a key in `pages.json`)

**Example:**
```gherkin
Then User is on "Home" screen
```

---

## How to run

From your **project root**:

```bash
npx ui-auto run
```

With tags (e.g. only `@smoke`):

```bash
npx ui-auto run --tags @smoke
```

Optional npm scripts in `package.json`:

```json
"scripts": {
  "e2e": "npx ui-auto run",
  "e2e:smoke": "npx ui-auto run --tags @smoke"
}
```

Then: `npm run e2e` or `npm run e2e:smoke`.

Ensure your app is running (e.g. `ng serve`) when testing against `localhost`.
