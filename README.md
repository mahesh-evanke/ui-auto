# playwright-without-bdd-library

A Playwright test automation library with **no BDD/Gherkin layer**. Tests are plain TypeScript files calling reusable helper classes directly — no `.feature` files, no step-definition matching, no Cucumber. Built on [Playwright Test](https://playwright.dev/docs/test-intro)'s own runner.

This repository ships **only the library** — reusable `WebActions`/`ApiActions` classes, locator resolution, and API capture/replay. It contains no test cases of its own (the few files under `tests/` are examples/smoke tests for this repo, not part of the published package). Your project's `*.spec.ts` files live in your own **consumer** project, which imports this package.

---



## Table of Contents

1. [Why no BDD](#why-no-bdd)
2. [Installation](#installation)
3. [Folder Structure](#folder-structure)
4. [Writing Tests](#writing-tests)
5. [Locators](#locators)
6. [WebActions Reference](#webactions-reference)
7. [ApiActions Reference](#apiactions-reference)
8. [CombinedActions Reference](#combinedactions-reference)
9. [DbActions Reference](#database-verification-dbactions)
10. [Validators & Comparison Reports](#validators--comparison-reports)
11. [Function Reference (every function, by file)](#function-reference-every-function-by-file)
12. [Configuration](#configuration)
13. [Running Tests](#running-tests)
14. [Reports](#reports)

---



## Why no BDD

The BDD branches of this toolkit (`wdio-playwright-library` and friends) read `.feature` files, match each Gherkin line against a registered step definition, and run the matching function. This library removes that layer entirely:


|                             | BDD version                                 | This library                               |
| --------------------------- | ------------------------------------------- | ------------------------------------------ |
| Test file                   | `.feature` (Gherkin)                        | `.spec.ts` (TypeScript)                    |
| Runner                      | Cucumber.js                                 | Playwright Test                            |
| Finding the code for a line | Regex/string match against step definitions | Direct function call                       |
| Adding a new action         | Sometimes needs a new step definition       | Call an existing helper method, or add one |


The underlying engine — locator resolution, robust click/fill, API capture/replay — is the same code, just called directly instead of through Gherkin matching.

> Migrating from the WebDriverIO branch (`dependencies`)? See [WDIO_TO_PLAYWRIGHT.md](WDIO_TO_PLAYWRIGHT.md) for a function-by-function mapping (`setValue` → `fill`, `waitUntil(EC.*)` → auto-waiting, etc.) and the differences between the two engines.

---



## Installation

Install into your own project (this is not meant to be cloned and run standalone):

```bash
npm install playwright-without-bdd-library
```

`postinstall` scaffolds your project — it never overwrites a file that already exists:

- `playwright.config.ts` — Playwright Test's own config
- `tsconfig.json`
- `e2e/config/config.yaml` — browser/run settings
- `e2e/locators/common.yaml` — empty starter shared-locator file
- `tests/example.spec.ts` — a starter smoke test
- npm scripts merged into your `package.json` (`test`, `test:headed`, `test:ui`, `report`)

If your package manager skips lifecycle scripts (pnpm's default, `npm install --ignore-scripts`), or you deleted a generated file and want it back, run the same scaffold manually:

```bash
npx playwright-without-bdd-init
```

Install Playwright's browser binaries:

```bash
npx playwright install
```

---



## Folder Structure

**This library's own structure** (what ships — see `package.json`'s `files` field):

```
playwright-without-bdd-library/
│
├── src/
│   ├── core/
│   │   ├── config.ts             # Loads e2e/config/config.yaml → process.env
│   │   └── contextOptions.ts     # Browser/context launch option builders
│   │
│   ├── locators/
│   │   ├── locatorResolver.ts    # [kind, value, xpathFallback] → real Playwright locator
│   │   ├── locatorPaths.ts       # Finds locator YAML files in your project
│   │   └── LocatorStore.ts       # Loads + looks up locator tuples per test
│   │
│   ├── web/
│   │   ├── WebActions.ts         # click/fill/check/selectDropdown/verify*, etc.
│   │   ├── tableHelper.ts        # Web table verification
│   │   └── textHelper.ts         # Screen text verification + <CURRENT_DATE> tokens
│   │
│   ├── api/
│   │   ├── ApiActions.ts         # sendRequest/expectStatus/validateResponseFields
│   │   ├── capture.ts            # Network capture for API replay
│   │   ├── matcher.ts            # Captured-API matching
│   │   ├── token.ts              # Auth token extraction
│   │   └── api-config.ts         # ${alias} URL resolution from locator YAML
│   │
│   ├── fixtures.ts                # Playwright Test fixtures: webActions, apiActions
│   └── index.ts                   # Public exports
│
├── e2e/
│   ├── config/config.yaml         # Template config
│   └── locators/common.yaml       # Empty starter shared-locator file
│
├── scripts/postinstall.js         # Scaffolds your project on npm install
├── playwright.config.ts           # This repo's own dev/example config
├── package.json
└── tsconfig.json
```

**Your consumer project** holds the actual tests:

```
your-project/
├── e2e/
│   ├── config/config.yaml
│   └── locators/
│       ├── common.yaml
│       └── generated/
│           └── web/
│               └── LoginPage.yaml
├── tests/
│   ├── login.spec.ts
│   └── api/orders.spec.ts
├── playwright.config.ts
└── package.json
```

---



## Writing Tests

Import `test`/`expect` from the package instead of `@playwright/test` directly — that's what wires up `webActions`/`apiActions`:

```ts
import { test, expect } from 'playwright-without-bdd-library';

test('login', async ({ webActions }) => {
  await webActions.navigate('https://example.com/login');
  webActions.usePage('LoginPage'); // loads e2e/locators/generated/web/LoginPage.yaml

  await webActions.fill('Username Field', 'tomsmith');
  await webActions.fill('Password Field', 'SuperSecretPassword!');
  await webActions.click('Login Button');

  await webActions.verifyTextPresent('You logged into a secure area');
});
```



### Fluent chaining (fewer lines)

`WebActions` and `ApiActions` are chainable — inspired by [playwright-fluent](https://github.com/hdorgeval/playwright-fluent) (see [PLAYWRIGHT_FLUENT_COMPARISON.md](PLAYWRIGHT_FLUENT_COMPARISON.md) for a full function-by-function comparison of what playwright-fluent offers vs. what this library has). Every action queues and returns `this`, so one `await` at the end runs the whole sequence instead of one `await` per line:

```ts
test('login', async ({ webActions }) => {
  await webActions
    .navigate('https://example.com/login')
    .usePage('LoginPage')
    .fill('Username Field', 'tomsmith')
    .fill('Password Field', 'SuperSecretPassword!')
    .click('Login Button')
    .verifyTextPresent('You logged into a secure area');
});
```

Same idea for `ApiActions`:

```ts
await apiActions
  .sendRequest('POST', url, { title: 'foo' })
  .expectStatus(201)
  .validateResponseFields({ title: 'foo' });
```

Both styles work and can be mixed freely — `await`ing after every single call still runs immediately, exactly as before; chaining several calls under one `await` just batches them. Pick whichever reads better for a given test.

`test.describe`/`test()` group scenarios the same way `Feature:`/`Scenario:` did — just as code instead of Gherkin.

### Soft assertions (`softly()`)

Call `.softly()` mid-chain to switch every action queued *after* it into soft-assert mode: a failure is collected instead of stopping the chain, so the rest of the checks still run. The final `await` still throws — summarizing every collected failure — so the test still fails overall:

```ts
await webActions
  .softly()
  .verifyFieldText('First Name', 'Jane')
  .verifyFieldText('Last Name', 'Doe')
  .verifyFieldText('Email', 'jane@example.com');
// all three run even if the first one fails; the await throws with all failures listed
```

Inspect individual failures (e.g. in a `catch` block) via `webActions.getSoftFailures()`. Actions queued *before* `.softly()` are unaffected — they still fail the chain immediately, as usual.

### Combined web + API chain (`actions` fixture)

For tests that interleave UI steps and direct API calls, the `actions` fixture chains both `WebActions` and `ApiActions` into one statement instead of two separate chains:

```ts
test('checkout page reflects the API total', async ({ actions }) => {
  await actions
    .navigate('https://example.com/cart')
    .verifyTextPresent('Your Cart')
    .sendRequest('GET', '/api/cart/total')
    .expectStatus(200)
    .validateResponseFields({ total: 42 });
});
```

`actions.web` and `actions.api` are the underlying `WebActions`/`ApiActions` instances, for anything not covered by `CombinedActions`' own methods.

### Reusing responses between steps

A plain argument like `fill(name, text)` or `sendRequest(method, url, body)` is evaluated *immediately* when you call it — but a prior step's response only exists once that step has actually run, which hasn't happened yet while you're still building the chain. So a value from one step can't be a plain argument to a later step in the *same* chain.

The fix: `fill()` and `sendRequest()` accept a **zero-arg function** instead of a plain value. The function is only called when that queued step actually executes — by which point every earlier step has already completed — so it can safely read a value saved earlier in the chain.

Save a value with `saveResponseField(path, key)` / `saveResponseBody(key)` (on `apiActions`/`actions`) or `extractText(name, key)` (on `webActions`/`actions`), then read it back via `.context.get(key)`:

```ts
// API response -> input to the next API call, in one chain
await apiActions
  .sendRequest('POST', loginUrl, credentials)
  .expectStatus(200)
  .saveResponseField('token', 'authToken') // dot-path into the response body
  .sendRequest('GET', () => `/profile?token=${apiActions.context.get('authToken')}`)
  .expectStatus(200);

// Text read from the page -> input to an API call, in one chain
await actions
  .navigate('https://example.com/account')
  .extractText('Account Id', 'accountId')
  .sendRequest('GET', () => `/api/accounts/${actions.context.get('accountId')}/orders`)
  .expectStatus(200);
```

`context` is a small shared per-test key/value store (`ScenarioCache`) — the same instance backs `webActions.context`, `apiActions.context`, and `actions.context`, so a value saved on one side is visible on the other. `context.get(key)` throws a clear error if nothing was saved under that key yet, rather than silently returning `undefined`.

#### `get()` has three forms

`get()` auto-detects what you want from its arguments — whole object, one field, or several fields:

```ts
context.set('CUSTOMER', {
  id: 100, name: 'John', phone: '9876543210', gst: '29ABCDE1234F1Z5',
  address: { city: 'Hyderabad', state: 'Telangana' },
});

// 1. whole object (a bare cache key)
context.get('CUSTOMER');                    // -> { id: 100, name: 'John', ... }

// 2. one field via dot / bracket path — any depth, array indexes too
context.get('CUSTOMER.name');               // -> 'John'
context.get('CUSTOMER.address.city');       // -> 'Hyderabad'
context.get('ORDER.items[0].price');        // -> 250

// 3. several paths -> one object, keyed by each path's LAST segment
context.get('CUSTOMER.name', 'CUSTOMER.phone', 'CUSTOMER.gst');
// -> { name: 'John', phone: '9876543210', gst: '29ABCDE1234F1Z5' }

context.get('CUSTOMER.name', 'CUSTOMER.address.city');
// -> { name: 'John', city: 'Hyderabad' }   // nested path keyed by its leaf, 'city'
```

So for a login form you can pass the captured object straight through (`() => context.get('LOGIN_FORM')`, since it's already `{ email, password }`), or pick exactly the fields you want (`() => context.get('LOGIN_FORM.email', 'LOGIN_FORM.password')`) — both produce an object with `email`/`password` keys.

Notes:
- **Exact key always wins** — if you saved something under a key that itself contains a dot (e.g. an auto-cached `"POST /some.path"` key), `get()` finds that literal key before parsing it as a path.
- `has()` follows the same rules (`has('CUSTOMER.address.city')` → `true`, `has('CUSTOMER.nope')` → `false`).
- A missing key/path throws a clear error rather than silently returning `undefined`.
- Two multi-paths that share a last segment (`'A.name'`, `'B.name'`) collide on key `name` — the later one wins; rename or split the call if that matters.

#### Every API response is cached automatically, too

You don't have to remember to call `saveResponseBody()` for a response you *might* need later — every response is cached automatically as it's received, keyed by method + URL. Read any earlier response back with `getCachedResponse(method, url)`:

```ts
await apiActions.sendRequest('GET', '/posts/1').expectStatus(200);
await apiActions.sendRequest('GET', '/posts/2').expectStatus(200);

// Neither call above saved anything explicitly - both responses are still there:
const post1 = apiActions.getCachedResponse<{ id: number }>('GET', '/posts/1');
const post2 = apiActions.getCachedResponse<{ id: number }>('GET', '/posts/2');
```

`getCachedResponse()` is immediate (not queued) — call it after `await`ing the request that produced the response you want. `saveResponseField()`/`saveResponseBody()` are still useful when you want a short, memorable alias (`'authToken'`) instead of remembering the exact method+URL.

---

### Large request/response bodies (`loadJsonFixture`)

A request body that's dozens of fields long is unreadable inline in a spec file. Move it to a JSON file under `e2e/data/` and load it instead:

```json
// e2e/data/create-post-payload.json
{ "title": "foo", "body": "bar", "userId": 1 }
```

```ts
import { test, expect, loadJsonFixture } from 'playwright-without-bdd-library';

test('create a post', async ({ apiActions }) => {
  const body = loadJsonFixture('create-post-payload');
  await apiActions.sendRequest('POST', url, body).expectStatus(201).validateResponseFields(body);
});
```

Pass a second argument to override just the field(s) that need to vary per run, without duplicating the whole fixture file:

```ts
const body = loadJsonFixture('create-post-payload', { title: `foo-${Date.now()}` });
```

`<CURRENT_DATE>`/`<CURRENT_DATE+N>` tokens (see [Configuration](#configuration)) are resolved in every string value of the loaded JSON, same as in `fill()`. A name containing `/` is resolved relative to the project root instead of `e2e/data/`, if the fixture lives elsewhere.

#### Large *hierarchical* payloads: `{{cache.path}}` tokens (`context.loadJson`)

When the payload is big **and** some of its values come from earlier steps, you shouldn't have to rebuild the hierarchy in TypeScript just to inject two dynamic fields. Write the whole shape once in a JSON file and mark the dynamic spots with `{{cache.path}}` — `context.loadJson()` fills them in from the ScenarioCache at load time:

```json
// e2e/data/create-order.json
{
  "orderRef": "ORD-{{userId}}",
  "customer": {
    "id": "{{userId}}",
    "email": "{{LOGIN_FORM.email}}",
    "contact": { "phone": "9876543210" }
  },
  "items": [
    { "sku": "SKU-001", "qty": 2, "unitPrice": 250 },
    { "sku": "SKU-002", "qty": 1, "unitPrice": 999 }
  ],
  "meta": { "createdOn": "<CURRENT_DATE>", "notes": "Order for {{LOGIN_FORM.email}}" }
}
```

```ts
// the spec never retypes the hierarchy - and never has to remember it
await apiActions
  .sendRequest('POST', ordersUrl, () => apiActions.context.loadJson('create-order'))
  .expectStatus(201);
```

Token rules:
- A token that is the **whole** string keeps the cached value's **type** — `"id": "{{userId}}"` becomes `id: 8` (a number), not `"8"`.
- An **embedded** token interpolates into the surrounding string — `"ORD-{{userId}}"` → `"ORD-8"`.
- Any path form `get()` accepts works here too, including nesting and array indexes (`{{LOGIN_RESPONSE.user.email}}`, `{{ORDER.items[0].price}}`).
- `<CURRENT_DATE>` tokens still resolve, and `overrides` still shallow-merges on top: `context.loadJson('create-order', { orderRef: 'ORD-X' })`.

#### Discovering what's in the cache (`paths()`, `keys()`, `dump()`)

Rather than opening API docs to recall a large response's shape, ask the cache what it actually holds:

```ts
apiActions.context.paths('LOGIN_RESPONSE');
// -> ['LOGIN_RESPONSE.access_token', 'LOGIN_RESPONSE.token_type',
//     'LOGIN_RESPONSE.user.id', 'LOGIN_RESPONSE.user.email', ...]

apiActions.context.keys();   // -> top-level keys only
apiActions.context.dump();   // -> pretty-prints every key + full JSON value
```

`paths()` lists **leaf** paths only — i.e. exactly the strings you can pass to `get()` or drop into a `{{...}}` token. Call it with no argument to list paths across every cached entry.

#### Saving a response out to a JSON file (`saveToFile`)

The reverse of `loadJson()`: write a cached value to `e2e/data/<name>.json`, so a response you captured mid-test can be inspected in an editor, or reloaded later — in this test, or as the starting point for a checked-in fixture file:

```ts
await apiActions.sendRequest('POST', loginUrl, creds).expectStatus(200).saveResponseBody('LOGIN_RESPONSE');

apiActions.context.saveToFile('LOGIN_RESPONSE', 'login-response'); // writes e2e/data/login-response.json

// later - in this test, or in a completely different test/file:
const saved = apiActions.context.loadJson('login-response');
```

`fileName` is optional — omit it and `saveToFile()` derives a safe one from the key itself (e.g. the auto-cached key `"GET /posts/1"` becomes `GET-posts-1.json`). Returns the full path written.

#### Finding a field by name (`search`)

When a saved response is big and you don't want to remember where a field sits, search for it by name instead of writing its full path:

```ts
context.set('LOGIN_RESPONSE', { data: { session: { user: { username: 'surya' } } } });

context.search('username');   // -> 'surya' — found anywhere in the tree
```

- Exactly one match → returns the value.
- No match → throws.
- Several matches → throws listing every path; pass `{ occurrence: N }` (1-based) to pick one, or `{ in: 'SOME_KEY' }` to scope the search to one cached entry. `searchAll('username')` returns every `{ path, value }` for review.

#### Reading a saved JSON file directly (`getFromFile`, `searchInFile`)

`get()`/`search()` read the in-memory cache. `getFromFile()`/`searchInFile()` read an `e2e/data/*.json` file **directly off disk, every call** — no caching layer, nothing loaded into memory first. That means a human can hand-edit the JSON file and the very next call sees the change immediately:

```ts
// e2e/data/order-items.json
// { "items": [{ "id": 1, "name": "Widget", "price": 250 }, { "id": 2, "name": "Gadget", "price": 999 }] }

context.getFromFile('order-items', 'items[0]');        // -> { id: 1, name: 'Widget', price: 250 }
context.getFromFile('order-items', 'items[0].price');  // -> 250
context.getFromFile('order-items');                     // -> the whole file

context.searchInFile('order-items', 'price');           // ambiguous (2 matches) -> throws
context.searchInFile('order-items', 'price', { occurrence: 1 }); // -> 250
```

Same three `get()` forms (whole file / one path / several paths → one object) and the same `search()` ambiguity rules apply — just sourced from the file instead of the cache. Standalone functions `getFromJsonFile()`/`searchInJsonFile()` work the same way without a `ScenarioCache` instance at all.

#### Saving ANY value to a file directly (`saveJsonFile`)

`ScenarioCache.saveToFile()` saves something that's already in the cache. `saveJsonFile()` is the more general form — it writes any value straight to `e2e/data/<name>.json`, no cache involved at all:

```ts
import { saveJsonFile, getFromJsonFile } from 'playwright-without-bdd-library';

saveJsonFile('login-response', { access_token: '...', user: { id: 8 } });
// -> e2e/data/login-response.json, ready to reuse immediately:
getFromJsonFile('login-response', 'user.id'); // -> 8
```

`ScenarioCache.saveToFile()` is a thin wrapper over this for the "it's already in the cache" case.

#### Short paths: no need to remember (or retype) the full hierarchy

In a large, deeply-nested document, giving the full path every time is exactly the kind of thing this library tries to eliminate. `get()`/`getFromFile()` (and their file/cache counterparts) try the **exact** path first; if that doesn't resolve, they try it again as a **suffix** anywhere in the document — so a short path works without repeating everything above it:

```ts
// e2e/data/company.json — a real, 6-levels-deep document:
// { "company": { "departments": [{ "manager": { "name": "Rahul Sharma", ... } }, ...] } }

getFromJsonFile('company', 'company.departments[0].manager.name'); // full path
getFromJsonFile('company', 'departments[0].manager.name');         // short path — same result, no "company." root needed
getFromJsonFile('company', 'manager.name');                        // even shorter, if that's still unique
```

If a short path matches more than once (e.g. `'manager'` alone, when there are several departments each with one), it throws — listing every full path it matched — instead of silently picking the wrong one:

```
Field "manager" is ambiguous - found 2 matches:
  1) company.departments[0].manager
  2) company.departments[1].manager
Pass { occurrence: N } (1-based), or read one directly with a path.
```

Resolve it with `getFromJsonFileAt(name, path, { occurrence })` (or `ScenarioCache.getAt(path, occurrence)` for the cache version) — or just add one more segment of context to the path (`'departments[0].manager'`) until it's unique again, which is usually simpler than counting occurrences.

#### De-duplicating a value that's repeated many times (`$ref`)

A large fixture often has the *same* nested object copy-pasted under several keys (one "manager" object referenced as `manager`, `reportingManager`, `owner`, `reviewer`, `accountManager`, `approvedBy`, `createdBy`, …). That's the JSON equivalent of un-normalized data — update it in one place and the other six silently go stale. `{"$ref": "path"}` fixes this: define the value once, reference it everywhere else, and it's resolved automatically when the file loads:

```json
{
  "company": {
    "manager": { "name": "Rahul Sharma" },
    "departments": [{
      "employees": [{ "reportingManager": { "$ref": "company.manager" } }],
      "teams": [{ "projects": [{ "owner": { "$ref": "company.manager" } }] }]
    }],
    "clients": [{ "accountManager": { "$ref": "company.manager" } }],
    "audit": { "approvedBy": { "$ref": "company.manager" } }
  }
}
```

```ts
getFromJsonFile('company', 'company.departments[0].employees[0].reportingManager'); // -> { name: 'Rahul Sharma' }
getFromJsonFile('company', 'company.clients[0].accountManager');                    // -> { name: 'Rahul Sharma' }, same object
```

Change `company.manager.name` once and **every** `$ref` to it reflects the change — it's a genuine single source of truth, not coincidentally-matching duplicates. The `$ref` path uses the same syntax as `get()`, including the short/suffix fallback (`{"$ref": "manager"}` works if that's unambiguous). A circular `$ref` (`a` → `b` → `a`) throws immediately instead of hanging; an unresolvable path throws too, rather than silently embedding `undefined`. Resolution happens automatically inside `getFromJsonFile()`/`loadJson()` — nothing extra to call.

---

### Chained API testing (auto-map & capture analysis)

For API-only end-to-end flows, one call's response usually feeds the next call's request — often with several fields (app id, claim sequence number, …) that repeat unchanged. Two features remove the busywork.

#### `autoMap` — fill matching fields automatically

Mark the fields to carry over from the previous response with the `AUTO` sentinel; write only the fields that don't carry over. `autoMap` (or `apiActions.autoMapBody`) fills each `AUTO` by searching the source for a field of the same name:

```ts
import { AUTO } from 'playwright-without-bdd-library';

// after API 1 responded { appId: 'APP-123', claim: { claimSeqNo: 55 }, ... }
await apiActions
  .sendRequestAutoMapped('POST', submitUrl, { appId: AUTO, claimSeqNo: AUTO, action: 'SUBMIT' })
  .expectStatus(200);
// body sent: { appId: 'APP-123', claimSeqNo: 55, action: 'SUBMIT' }
```

`sendRequestAutoMapped()` maps against the previous response automatically; `autoMapBody(template, source?)` returns the built object if you'd rather pass it to a plain `sendRequest`. An `AUTO` that can't be uniquely resolved throws (so you notice), unless `{ keepUnresolved: true }` — then it's left in place and reported. Use `autoMapReport()` to get `{ value, unresolved }`.

#### `analyzeChain()` — see how captured calls connect

Every API call in a test is captured automatically. `analyzeChain()` scans them and reports which response field of one call feeds a request field of a later call — a summary you review (and then wire up with `saveResponseField`/`autoMap`):

```ts
import { printApiChainReport } from 'playwright-without-bdd-library';

printApiChainReport(apiActions.analyzeChain());
// [0] POST /auth/login -> 200
// [1] GET  /customers/8 -> 200
// Detected links (response field -> later request field):
//   [0] user.id  ->  [1] id   (id, value+name)
```

`matchType` is `value` (same field name **and** same value — a strong link) or `name` (same name only — worth reviewing).

Links are also detected through **URL path parameters**, not just JSON body fields — a numeric segment like `/users/1` is treated as an `id` field for matching purposes, since that's the overwhelmingly common REST convention. So a chain like `POST /auth/login` → `GET /users/{id}` → `GET /carts/user/{id}` gets linked even though the id never appears as a named JSON key in the later requests, only embedded in their URLs.

Numeric **URL query parameters** are linked too — `?postId=1` is matched by the query key's own name (`postId`), not a generic `id`, since a query param already carries an explicit name. So a chain like `GET /posts/1` → `GET /posts/1/comments` → `GET /comments?postId=1` correctly links the query param back to the `postId` field found in the comments response, not just the path-embedded id.

#### `generateApiChainSpec()` — turn the analysis into a runnable spec file

This is the "generate an API-only end-to-end test, the same way UI recordings generate spec files" feature. Give it the captured calls and their `analyzeApiChain()` report; it emits real TypeScript source — every **strong** (`'value'`) link becomes a `saveResponseField()` on the source call and a `apiActions.context.get(key)` read (or a lazy `() => \`...${...}\`` URL) wherever it's consumed, so the generated test survives the next run even though the server issues a different id every time. Fields with no detected source are left as the literal values that were captured — genuinely user-supplied input (credentials, free-text) has nothing to auto-link, so it stays as-is, same as any hand-written API test.

```ts
import { analyzeApiChain, generateApiChainSpec } from 'playwright-without-bdd-library';

const report = analyzeApiChain(capturedCalls);
const source = generateApiChainSpec(capturedCalls, report, { testName: 'Login -> user -> carts' });
fs.writeFileSync('tests/generated-chain.spec.ts', source);
```

See [tests/api-chain-codegen-example.spec.ts](tests/api-chain-codegen-example.spec.ts) for a complete, real example against a free public API (dummyjson.com) — it records a real 4-call login→user→carts→posts sequence, and the file it generates, [tests/generated-api-chain.spec.ts](tests/generated-api-chain.spec.ts), runs as its own real, passing test.

A second example, [tests/jsonplaceholder-chain-codegen.spec.ts](tests/jsonplaceholder-chain-codegen.spec.ts), records all 8 routes of a real jsonplaceholder.typicode.com CRUD flow (`GET /posts` → `GET /posts/1` → `GET /posts/1/comments` → `GET /comments?postId=1` → `POST /posts` → `PUT /posts/1` → `PATCH /posts/1` → `DELETE /posts/1`) and specifically exercises the query-parameter linking above — the generated file, [tests/generated-jsonplaceholder-chain.spec.ts](tests/generated-jsonplaceholder-chain.spec.ts), rebuilds `?postId=1` as `` `?postId=${apiActions.context.get("postId")}` `` and runs as its own real, passing test.

A third example, [tests/customer-billing-chain-codegen.spec.ts](tests/customer-billing-chain-codegen.spec.ts), runs against a **real production backend** (the one behind `customer-billing-deve.vercel.app`) instead of a public demo API — API-only, no UI involved, per the client's original ask. It records `POST /auth/login` → `GET /customers/entries/all?status=active` → `GET /customers/{id}` → `GET /customers/{id}/entries`, where the billing customer `id` is discovered purely from the entries-list response and auto-wired into both later URL path params — nobody typed `51` anywhere. It also demonstrates the tool correctly declining a false match: the logged-in user's own id (`user.id`, `8`) shares the field name `"id"` with the billing customer id but a different value, so it's surfaced only as a **weak** match in the generated file's review comment, not auto-wired. The generated file, [tests/generated-customer-billing-chain.spec.ts](tests/generated-customer-billing-chain.spec.ts), runs standalone against the live API and passes.

**Weak (`'name'`-only) links are never auto-wired** — same field name but a different/absent value is too weak a signal to trust blindly. They're listed in a comment at the top of the generated file instead, for a human to review and wire up manually (with `saveResponseField`/`autoMap`) if appropriate.

---

### JSON locator files & the JSON→YAML converter

Locator files can be **JSON or YAML** — both load transparently (a page's `.json` or `.yaml` is found automatically). Migrating from a JSON-locator setup (e.g. WDIO)? Your files work as-is.

To prefer one format when both exist, set it in `e2e/config/config.yaml`:

```yaml
locators:
  format: json   # default: yaml (both still load either way)
```

To adopt YAML, convert your JSON locators to sibling `.yaml` files once:

```bash
npx playwright-without-bdd-locators-to-yaml
```

It writes a `.yaml` next to every `.json` under `e2e/locators/generated/**` (skips any whose `.yaml` already exists unless you pass `--overwrite`). `convertLocatorsToYaml()` is the same logic as a callable function.

---

### Database verification (`dbActions`)

Run a query and assert on its results — the same fluent/chainable pattern as `webActions`/`apiActions`, and it shares the same `ScenarioCache`, so a DB value can feed into a later API/UI step (and vice versa):

```ts
test('a new user row exists after signup', async ({ dbActions }) => {
  await dbActions
    .query('SELECT * FROM users WHERE email = $1', ['tom@example.com'])
    .expectRowCount(1)
    .saveQueryField('0.id', 'userId'); // dot-path: row 0's "id" column

  await dbActions
    .query(() => `SELECT * FROM orders WHERE user_id = ${dbActions.context.get('userId')}`)
    .expectRowCount(0); // no orders yet for a brand-new user
});
```

| Method | Use |
|---|---|
| `query(sql, params?)` | Runs a parameterized query; `sql`/`params` can be a zero-arg function (see [Reusing responses between steps](#reusing-responses-between-steps)) |
| `expectRowCount(n)` | Asserts the last query returned exactly `n` rows |
| `saveQueryField(path, key)` | Saves a field from the last query's rows (dot-path, e.g. `"0.email"`) under `key` in `.context` |
| `saveQueryResult(key)` | Saves the entire last query's rows under `key` in `.context` |
| `lastQueryRows` | The full rows array from the last query |
| `context` | Shared `ScenarioCache` — same instance as `webActions.context`/`apiActions.context` |

Connects to **PostgreSQL** via the `database:` section of `e2e/config/config.yaml` (real env vars — `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_SSL` — always win, same as every other config value):

```yaml
database:
  host: localhost
  port: 5432
  user: postgres
  password: postgres
  database: postgres
  ssl: false
```

The connection pool is created lazily, per worker, only if a test actually requests the `dbActions` fixture — tests that never touch the database never attempt a connection. It's closed automatically at the end of the worker.

`DbActions` itself only depends on a minimal `QueryablePool` interface (`query(text, values?)`), not a concrete `pg` import — so it's also usable directly with any object matching that shape (e.g. a fake pool in a unit test), or with a different driver's pool by constructing `new DbActions(yourPool)` yourself instead of using the `dbActions` fixture. `createDatabaseService(engine?)` (`src/services/DatabaseService.ts`) is a thin factory in front of this — only `'postgres'` is wired today; adding MySQL/MSSQL later is one new pool-builder file plus one new `case`, no changes to `DbActions` itself.

---



## Validators & comparison reports

The full UI → API → DB flow: capture data once, save it, and validate it against the request/response/DB rows it produced — with a detailed ✓/✗ report on any mismatch. See [tests/scenario-cache.spec.ts](tests/scenario-cache.spec.ts) for the complete worked example (both a table-input flow and a login/password flow).

```ts
test('Verify Save Customer Flow', async ({ webActions, apiActions }) => {
  // 1. Read UI Table - capture what's actually on screen (not what you expect it to be).
  await webActions.navigate(url).readWebTable('table1', 'INPUT_ROWS');
  const inputRows = webActions.context.get<TableRow[]>('INPUT_ROWS');

  // 2. Click Save -> triggers the Save API.
  await apiActions
    .sendRequest('POST', saveUrl, () => ({ rows: apiActions.context.get('INPUT_ROWS') }))
    .expectStatus(201);

  // 3. Validate API Request: INPUT_ROWS vs. what was actually sent.
  expectRowsToMatch(inputRows, (apiActions.lastRequestBody as { rows: TableRow[] }).rows);

  // 4. Validate API Response: status, record count, extract generated IDs.
  const result = validateApiResponse(
    { status: 201, body: apiActions.lastResponseBody },
    { expectedStatus: 201, recordCountField: 'rows', expectedRecordCount: inputRows.length, idField: 'id' },
  );
  apiActions.context.set('CUSTOMER_IDS', result.extractedIds);

  // 5. Database Validation: query using the generated IDs, then compare.
  await dbActions.query(() => `SELECT * FROM CUSTOMER WHERE CUSTOMER_ID IN (${apiActions.context.get('CUSTOMER_IDS')})`).expectRowCount(inputRows.length);
  expectDatabaseToMatch(inputRows, dbActions.lastQueryRows as TableRow[]);
});
```

Every comparison is a **recursive deep-diff**, not a shallow/partial check (unlike `validateResponseFields()`'s "contains" semantics) — it walks nested objects/arrays and reports every field-level mismatch by JSON path.

### Custom assertion helpers

| Function | Use |
|---|---|
| `expectRowsToMatch(expected, actual, options?)` | Runs `compareTables()`, prints the ✓/✗ report, then fails the test if any row didn't match |
| `expectObjectsToMatch(expected, actual, options?)` | Same, for a single object (e.g. a login form vs. a login API payload) |
| `expectDatabaseToMatch(expected, actual, options?)` | Same, with DB-flavored defaults on (type coercion, date-only comparison, null/empty equivalence) |

### Validators (lower-level, used by the assertion helpers above)

| Function | Use |
|---|---|
| `compareObjects(expected, actual, options?)` | The core recursive deep-diff engine — everything else delegates to this |
| `compareTables(expected, actual, options?)` | Pairs rows (positionally, or by a `matchBy` field), diffs each pair via `compareObjects` |
| `validateApiRequest(inputData, requestPayload, options?)` | Compares captured input (table rows *or* a single object) against a request payload, extracting the right shape via an optional `payloadPath` |
| `validateApiResponse(response, options)` | Checks status/success-flag/record-count, extracts generated IDs, deep-compares business fields |
| `validateDatabaseRows(inputRows, dbRows, options?)` | `compareTables()` with DB-flavored defaults on |

`ObjectComparatorOptions` (accepted by all of the above): `ignoreFields?: string[]` (skip dynamic fields like timestamps), `coerceTypes?: boolean` (`"25"` matches `25`), `dateTolerance?: 'exact' | 'dateOnly'`, `treatNullAsEmpty?: boolean`. `TableValidatorOptions` adds `matchBy?: string` to pair rows by a field (e.g. an id) instead of position, so reordered rows still match correctly.

### Models (`src/models`)

Generic, business-agnostic types only — `TableRow`, `FieldDifference`, `ObjectComparisonResult`, `RowComparisonResult`, `TableComparisonResult`, `RequestModel<T>`, `ResponseModel<T>`, `DatabaseQueryResult<T>`. A `Customer`/`Employee`-style interface is *your* domain model — define it in your own spec file (see `tests/scenario-cache.spec.ts`'s local `Customer` interface), the library doesn't ship one.

---



## Locators

Same `[kind, value, xpathFallback?]` tuple format used across every branch of this toolkit — locator YAML authored for the BDD/WDIO branches works here unmodified.

```yaml
Sign In:
  - role:button
  - Sign In
  - //button[normalize-space(.)='Sign In']

Email Address:
  - placeholder
  - Email Address
  - //input[@placeholder='Email Address']
```


| Kind                                                                | Resolves via                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `role:<ariaRole>`                                                   | `page.getByRole(ariaRole, { name, exact: true })`                 |
| `label`                                                             | `page.getByLabel(value, { exact: true })`                         |
| `placeholder`                                                       | `page.getByPlaceholder(value, { exact: true })`                   |
| `text`                                                              | `page.getByText(value, { exact: true })`                          |
| `testid`                                                            | `page.getByTestId(value)`                                         |
| `alttext`                                                           | `page.getByAltText(value, { exact: true })`                       |
| `title`                                                             | `page.getByTitle(value, { exact: true })`                         |
| `xpath` / `css`                                                     | `page.locator(...)`                                               |
| `id` / `name` / `tagName` / `className` / `linkText` / `buttonText` | WDIO-style kinds, translated to their Playwright equivalent       |
| anything else                                                       | `page.locator('[<kind>="<value>"]')` — generic attribute fallback |


Files live at `e2e/locators/generated/<category>/<pageKey>.yaml` in **your** project (`category` is `web`, `api`, or `endtoend`), plus `e2e/locators/common.yaml` for elements shared across pages.

### Shorthand format

`- kind: value`— a single YAML mapp shorthand ing entry — can stand in for the `[kind, value]` pair, saving a line:

```yaml
Password Field:
  - label: Password
  - //input[@id='password']       # xpath fallback, still optional
```

is equivalent to:

```yaml
Password Field:
  - label
  - Password
  - //input[@id='password']
```



### Typo suggestions

If a name passed to `webActions.fill()`/`.click()`/etc. isn't found in any loaded locator YAML, the library falls back to a broad semantic guess (as before) but also logs a "did you mean...?" warning naming the closest registered name, so a typo doesn't silently degrade into flaky matching:

```
[locators] "Usernam Field" not found in any loaded locator YAML - did you mean "Username Field"? Falling back to a broad guess.
```



### Typed locator names

Regenerate a `LocatorName` union type covering every name across your locator YAML files:

```bash
npx playwright-without-bdd-generate-types
```

This writes `e2e/locators/generated/locator-names.d.ts`. Import `LocatorName` in your own typed wrapper functions (or reference it in editor tooling) to catch a typo'd element name at compile time instead of at runtime. Re-run it whenever you add or rename a locator entry.

---



## WebActions Reference


| Method                            | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `navigate(url)`                   | `page.goto()`                                                       |
| `usePage(pageKey)`                | Loads that page's locator YAML                                      |
| `getLocator(name)`                | Raw `Locator` for anything not covered below                        |
| `click(name)`                     | Click, with scroll/force-click fallback                             |
| `fill(name, text)`                | Fill, with keystroke/DOM-value fallback for masked or custom inputs |
| `check(name)` / `uncheck(name)`   | Checkbox/radio toggle                                               |
| `selectDropdown(name, value)`     | Native `<select>` or common custom-dropdown libraries               |
| `verifyTextPresent(text)`         | Substring search anywhere on screen (incl. iframes)                 |
| `verifyFieldText(name, expected)` | Checks `.value` (inputs) or text content (everything else)          |
| `verifyWebTable(name, rows)`      | Verifies expected rows appear in a table: `[header, ...dataRows]`   |
| `acceptNextDialog()`              | Accepts the next native `alert`/`confirm`                           |
| `extractText(name, key)`          | Saves a field's value/text under `key` in `.context`, for reuse in a later step |
| `extractFields(fields, key)`      | Saves several named fields as one object under `key` — e.g. a login/password form, not a table |
| `readWebTable(name, key)`         | Reads a table's *actual* current rows (header-keyed objects) and saves them under `key` — the capture counterpart to `verifyWebTable()` |
| `context`                         | Shared `ScenarioCache` key/value store (see [Reusing responses between steps](#reusing-responses-between-steps)) |


---



## ApiActions Reference


| Method                             | Description                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sendRequest(method, url, body?)`  | Registers a request (plain object body, no DataTable conversion needed)                                                      |
| `expectStatus(code)`               | Executes the pending request (or replays a matching one captured from the page's own network traffic) and asserts the status |
| `validateResponseFields(expected)` | Asserts the last response body contains the given fields, at any depth                                                       |
| `lastResponseBody`                 | The full last response body, for assertions beyond `validateResponseFields`                                                  |
| `lastRequestBody`                  | The body actually sent on the last request — for validating the request itself (see `validateApiRequest()`)                   |
| `saveResponseField(path, key)`     | Saves a field from the last response body (dot-path, e.g. `"user.token"`) under `key` in `.context`, for reuse in a later step |
| `saveResponseBody(key)`            | Saves the entire last response body under `key` in `.context`                                                                |
| `getCachedResponse(method, url)`   | Reads any previously-received response body by method+URL — cached automatically, no explicit save call needed              |
| `context`                          | Shared `ScenarioCache` key/value store (see [Reusing responses between steps](#reusing-responses-between-steps))               |


API capture is attached automatically per test — if the page under test makes the same request itself, `expectStatus()` replays that captured response instead of firing a duplicate request.

---



## CombinedActions Reference

Available via the `actions` fixture — see [Combined web + API chain](#combined-web--api-chain-actions-fixture).


| Method                                                                                        | Description                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `navigate(url)` / `usePage(pageKey)` / `click(name)` / `fill(name, text)`                     | Delegates to the underlying `WebActions`                                          |
| `verifyTextPresent(text)` / `verifyFieldText(name, expected)` / `verifyWebTable(name, rows)`  | Delegates to the underlying `WebActions`                                          |
| `extractFields(fields, key)` / `readWebTable(name, key)`                                      | Delegates to the underlying `WebActions` — capture a login/password form or a table's actual rows |
| `sendRequest(method, url, body?)` / `expectStatus(code)` / `validateResponseFields(expected)` | Delegates to the underlying `ApiActions`                                          |
| `extractText(name, key)` / `saveResponseField(path, key)` / `saveResponseBody(key)`           | Delegates to the underlying `WebActions`/`ApiActions` — see [Reusing responses between steps](#reusing-responses-between-steps) |
| `getCachedResponse(method, url)`                                                              | Delegates to the underlying `ApiActions` — reads any previously-received response by method+URL |
| `lastResponseBody` / `lastRequestBody`                                                        | The last API response body / the body actually sent on the last request           |
| `context`                                                                                     | Shared `ScenarioCache` key/value store (same instance as `web.context`/`api.context`) |
| `web` / `api`                                                                                 | The underlying `WebActions`/`ApiActions` instances, for anything not listed above |


---



## Function Reference (every function, by file)

Every function/method in the library and what it's for — useful when you need something not covered by the tables above, or when contributing to the library itself.

### `src/core/Chainable.ts` — `Chainable<TSelf>` (base class for WebActions/ApiActions/CombinedActions)


| Function                          | Use                                                                       |
| --------------------------------- | ------------------------------------------------------------------------- |
| `enqueue(action)`                 | Queues an action closure and returns `this`, enabling the fluent chain    |
| `softly()`                        | Marks every action queued after this call as soft (collected, not thrown) |
| `getSoftFailures()`               | Returns the errors collected during the last soft-mode drain              |
| `lastError()`                     | Returns the error from the last chain that threw, if any                  |
| `drain()` *(private)*             | Runs every queued action in order when the chain is awaited               |
| `then(onfulfilled?, onrejected?)` | Makes the class awaitable — triggers `drain()`                            |

### `src/cache/ScenarioCache.ts` — `ScenarioCache`

| Function | Use |
|---|---|
| `set(key, value)` | Saves a value under `key` |
| `get(...keysOrPaths)` | One key → whole object; one dot/bracket path → that value; several paths → an object keyed by each path's last segment. If the exact path doesn't resolve, also tries it as a suffix anywhere in the tree (short paths). Throws a clear error if nothing resolves |
| `getAt(path, occurrence)` | Same as `get()` for a single path that's genuinely ambiguous via the short-path fallback — picks a specific occurrence (1-based) instead of throwing |
| `has(key)` | Whether `key` (or dot-path) has a resolvable value |
| `loadJson(fixtureName, overrides?)` | Loads `e2e/data/<name>.json` and fills every `{{cache.path}}` token from this cache — keeps a large hierarchical payload out of the spec |
| `paths(key?)` | Every readable leaf dot-path (e.g. `'LOGIN_RESPONSE.user.email'`), so a big response's shape needn't be memorised. Omit `key` to list across all entries |
| `keys()` | Every top-level key currently stored |
| `dump(label?)` | Pretty-prints every key + full JSON value to the console |
| `saveToFile(keyOrPath, fileName?)` | Writes a cached value to `e2e/data/<fileName>.json` (auto-derives a safe filename from the key if omitted) — the reverse of `loadJson()`. Returns the full path written |
| `search(fieldName, options?)` | Finds a value by field name anywhere in the cache (or in one key via `{ in }`); unique → the value, ambiguous → throws unless `{ occurrence }` picks one |
| `getFromFile(fileName, ...pathsOrNone)` | Same three forms as `get()` (including the short-path fallback), but reads `e2e/data/<fileName>.json` fresh off disk every call — not the in-memory cache |
| `getFromFileAt(fileName, path, occurrence)` | Same as `getFromFile()` for an ambiguous short path — picks a specific occurrence (1-based) |
| `searchInFile(fileName, fieldName, options?)` | Same as `search()`, but searches `e2e/data/<fileName>.json` fresh off disk every call |
| `searchAll(fieldName, options?)` | Every `{ path, value }` match for a field name, for discovery/disambiguation |
| `clear()` | Removes every saved value |
| `getSingle(keyOrPath)` *(private)* | Resolves one key/path — exact key first, then path parsing; shared by `get()`/`has()` |
| `getByPath` (re-export) | Re-exported from `src/utils/pathUtils.ts` for backward compatibility — see that file's reference below |
| `collectLeafPaths(value, prefix, out)` *(module-level)* | Leaf-path collection used by `paths()` |




### `src/web/WebActions.ts` — `WebActions`


| Function                                              | Use                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `usePage(pageKey)`                                    | Loads a page's locator YAML                                          |
| `getLocator(name)`                                    | Raw `Locator` lookup by name, immediate (not queued)                 |
| `raw` (getter)                                        | Escape hatch to the underlying Playwright `Page`                     |
| `navigate(url)`                                       | `page.goto()`                                                        |
| `resolveVisible(element, timeout?)` *(private)*       | Resolves a locator (across frames) and waits for it to be visible    |
| `click(name)`                                         | Click, with scroll/force-click fallback                              |
| `check(name)` / `uncheck(name)`                       | Checkbox/radio toggle                                                |
| `fill(name, text)`                                    | Fill, with keystroke/DOM-value fallback for masked or custom inputs  |
| `selectDropdown(name, value)`                         | Selects from a native `<select>` or common custom-dropdown libraries |
| `verifyTextPresent(text)`                             | Substring search anywhere on screen (incl. iframes)                  |
| `verifyFieldText(name, expected)`                     | Checks `.value` (inputs) or text content (everything else)           |
| `verifyWebTable(name, rows, options?)`                | Verifies expected rows appear in a table                             |
| `acceptNextDialog()`                                  | Accepts the next native `alert`/`confirm`                            |
| `extractText(name, key)`                              | Reads a field's value/text and saves it under `key` in `.context`, for reuse in a later step |
| `extractFields(fields, key)`                          | Reads several named fields at once and saves them as one object under `key` (login/password, not a table) |
| `readFieldValue(name)` *(private)*                    | Shared read logic behind `extractText()`/`extractFields()`           |
| `readWebTable(name, key)`                             | Reads a table's actual current rows (header-keyed objects) and saves them under `key` |
| `context` (getter)                                    | Shared `ScenarioCache` key/value store, injected via the constructor   |
| `escapeRegExp(s)` / `normalizeWs(s)` *(module-level)* | Small string helpers used internally by `selectDropdown`/matching    |




### `src/api/ApiActions.ts` — `ApiActions`


| Function                                                     | Use                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `sendRequest(method, url, body?)`                            | Registers a request to run on the next `expectStatus()`                 |
| `expectStatus(code)`                                         | Executes (or replays a captured) request and asserts the status         |
| `validateResponseFields(expected)`                           | Asserts the last response body contains the given fields, at any depth  |
| `lastResponseBody` (getter)                                  | The full body of the last response                                      |
| `lastRequestBody` (getter)                                   | The body actually sent on the last request, captured in `expectStatus()` |
| `saveResponseField(path, key)`                               | Saves a field from the last response body (dot-path) under `key` in `.context`, for reuse in a later step |
| `saveResponseBody(key)`                                      | Saves the entire last response body under `key` in `.context`           |
| `getCachedResponse(method, url)`                             | Reads any previously-received response body by method+URL — cached automatically inside `expectStatus()` |
| `autoMapBody(template, source?, options?)`                   | Builds a payload, filling every `AUTO` leaf from `source` (default: last response) by matching field name — immediate |
| `sendRequestAutoMapped(method, url, template, options?)`     | `sendRequest()` whose body is auto-mapped from the previous response |
| `analyzeChain()`                                             | Reports which response field of a captured call feeds a later call's request field (see `analyzeApiChain`) |
| `cacheKeyFor(method, normalizedUrl)` *(private)*             | Builds the `"<METHOD> <url>"` key every response is auto-cached under   |
| `context` (getter)                                           | Shared `ScenarioCache` key/value store, injected via the constructor      |
| `createSyntheticResponse(captured)` *(module-level)*         | Wraps a captured network API as a `{status, json}` response-like object |
| `parseResponseBodyFromJsonOrText(resp)` *(module-level)*     | Parses a response body as JSON, falling back to text                    |
| `assertJsonIncludesPaths(actual, expected)` *(module-level)* | Recursively asserts `actual` contains every field/path in `expected`    |




### `src/combined/CombinedActions.ts` — `CombinedActions`


| Function                                                                                               | Use                                                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `navigate` / `usePage` / `click` / `fill` / `verifyTextPresent` / `verifyFieldText` / `verifyWebTable` / `extractText` / `extractFields` / `readWebTable` | Each queues and immediately drains one `WebActions` call, preserving chain order |
| `sendRequest` / `expectStatus` / `validateResponseFields` / `saveResponseField` / `saveResponseBody`                  | Each queues and immediately drains one `ApiActions` call, preserving chain order |
| `lastResponseBody` / `lastRequestBody` (getters)                                                       | The last API response body / the body actually sent on the last request           |
| `context` (getter)                                                                                     | `this.api.context` — the same shared `ScenarioCache` instance as `web.context`     |

### `src/db/DbActions.ts` — `DbActions`

| Function | Use |
|---|---|
| `query(sql, params?)` | Runs a query and stores its result for the next call; `sql`/`params` can be a zero-arg function |
| `expectRowCount(n)` | Asserts the last query returned exactly `n` rows |
| `saveQueryField(path, key)` | Saves a field from the last query's rows (dot-path) under `key` in `.context` |
| `saveQueryResult(key)` | Saves the entire last query's rows under `key` in `.context` |
| `lastQueryRows` (getter) | The full rows array from the last query |
| `context` (getter) | Shared `ScenarioCache` key/value store, injected via the constructor |
| `QueryablePool` (interface) | The minimal `query(text, values?)` shape `DbActions` depends on — not a concrete `pg` import |

### `src/db/pool.ts`

| Function | Use |
|---|---|
| `createDbPool()` | Builds the real `pg.Pool` used by the `dbActions` fixture, from `DB_*` env vars (see [Database verification](#database-verification-dbactions)) |

### `src/services/DatabaseService.ts`

| Function | Use |
|---|---|
| `createDatabaseService(engine?)` | Thin factory dispatching to the right pool builder for the configured DB engine — only `'postgres'` (→ `createDbPool()`) is wired today |

### `src/models/index.ts`

Type-only module — `TableRow`, `FieldDifference`, `ObjectComparisonResult`, `RowComparisonResult`, `TableComparisonResult`, `RequestModel<T>`, `ResponseModel<T>`, `DatabaseQueryResult<T>`. See the "Models" subsection under [Validators & Comparison Reports](#validators--comparison-reports) above.

### `src/validators/ObjectComparator.ts`

| Function | Use |
|---|---|
| `compareObjects(expected, actual, options?)` | The core recursive deep-diff engine — walks nested objects/arrays in parallel, collects every field-level difference by JSON path |
| `isPlainObject(v)` / `normalizeForCompare(v, options)` / `valuesEqual(a, b, options)` *(module-level)* | Type-narrowing + value-normalization helpers (type coercion, date tolerance, null handling) used by `compareObjects` |

### `src/validators/TableValidator.ts`

| Function | Use |
|---|---|
| `compareTables(expected, actual, options?)` | Pairs rows (by `matchBy` field, or positionally), diffs each pair via `compareObjects` — no duplicate comparison logic |

### `src/validators/APIRequestValidator.ts`

| Function | Use |
|---|---|
| `validateApiRequest(inputData, requestPayload, options?)` | Compares captured input (rows or a single object) against a request payload, via `compareTables`/`compareObjects` |

### `src/validators/APIResponseValidator.ts`

| Function | Use |
|---|---|
| `validateApiResponse(response, options)` | Checks status/success-flag/record-count, extracts generated IDs, deep-compares business fields via `compareObjects` |

### `src/validators/DatabaseValidator.ts`

| Function | Use |
|---|---|
| `validateDatabaseRows(inputRows, dbRows, options?)` | `compareTables()` with DB-flavored defaults on (type coercion, date-only comparison, null/empty equivalence) |

### `src/utils/logger.ts`

| Function | Use |
|---|---|
| `logTableComparisonReport(title, result, counts?)` | Prints the ✓/✗ per-row, Expected/Actual comparison report |
| `logObjectComparisonReport(title, differences)` | Same, for a single-object comparison |
| `logApiCall(args)` | Logs one API call's method/URL/headers/status/execution time — used by `ApiActions.expectStatus()` |

### `src/utils/assertions.ts`

| Function | Use |
|---|---|
| `expectRowsToMatch(expected, actual, options?)` | Runs `compareTables()`, logs the report, asserts via `expect()` |
| `expectObjectsToMatch(expected, actual, options?)` | Runs `compareObjects()`, logs the report, asserts via `expect()` |
| `expectDatabaseToMatch(expected, actual, options?)` | Runs `validateDatabaseRows()`, logs the report, asserts via `expect()` |




### `src/locators/LocatorStore.ts` — `LocatorStore`


| Function                                                                               | Use                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `loadCommonLocators()` *(private)*                                                     | Loads every `common.yaml`/`common.json` into the shared locator map                |
| `usePage(pageKey)`                                                                     | Loads a page's locator YAML into the page-scoped map                               |
| `tryResolveTuple(name)`                                                                | Looks up a name's `[kind, value, xpathFallback?]` tuple (page-scoped, then common) |
| `smartLocator(page, name)`                                                             | Fallback broad semantic guess when a name isn't registered anywhere                |
| `getLocator(page, name)`                                                               | Resolves a name to a real Playwright `Locator`                                     |
| `getLocatorInFirstFrame(page, name)`                                                   | Resolves a name inside the first `<iframe>`                                        |
| `resolveAcrossFrames(page, name)`                                                      | Tries the main page, then every child frame, for a matching locator                |
| `getTableRootLocator(page, objName)`                                                   | Resolves a table's root element by name                                            |
| `allKnownNames()`                                                                      | Every locator name currently loaded, used for typo suggestions                     |
| `warnIfUnresolved(name)` *(private)*                                                   | Logs a "did you mean...?" warning when a name isn't found anywhere                 |
| `isPlainObject(v)` / `tupleFromYamlValue(v)` / `parseLocatorFile(fp)` *(module-level)* | YAML parsing helpers, including the `[{kind: value}, xpathFallback?]` shorthand    |




### `src/locators/suggestLocatorName.ts`


| Function                                             | Use                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `levenshteinDistance(a, b)`                          | Computes edit distance between two strings                                    |
| `suggestClosestName(name, candidates, maxDistance?)` | Returns the closest candidate name, or `undefined` if nothing is close enough |




### `src/locators/locatorResolver.ts`


| Function                              | Use                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `buildLocatorFromTuple(scope, tuple)` | Turns a `[kind, value, xpathFallback?]` tuple into a real Playwright `Locator` |




### `src/locators/locatorPaths.ts`


| Function                              | Use                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `locatorDir(cat)`                     | Path to a category's locator folder (`e2e/locators/generated/<cat>`)            |
| `locatorFilePath(cat, pageKey, ext?)` | Full path to one page's locator file                                            |
| `findLocatorFile(pageKey)`            | Locates a page's locator file across categories/extensions/flat-layout fallback |
| `findCommonFiles()`                   | Every `common.yaml`/`common.json` file across categories, plus the shared one   |




### `src/codegen/generateLocatorTypes.ts`


| Function                                                                                      | Use                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `generateLocatorTypes(outFile?)`                                                              | Scans every locator YAML/JSON file and writes a `LocatorName` union type |
| `collectNamesFromFile(fp)` / `walk(dir, files)` / `collectAllLocatorFiles()` *(module-level)* | File-scanning helpers used by `generateLocatorTypes`                     |

### `src/codegen/convertLocatorsToYaml.ts`

| Function | Use |
|---|---|
| `convertLocatorsToYaml(options?)` | Converts every JSON locator file to a sibling YAML file; skips existing `.yaml` unless `{ overwrite }`. Returns `{ converted, skipped }`. CLI: `npx playwright-without-bdd-locators-to-yaml` |

### `src/utils/deepSearch.ts`

| Function | Use |
|---|---|
| `searchByFieldName(obj, fieldName, prefix?)` | Every property at any depth whose key === `fieldName`, with its full path — backs `ScenarioCache.search()` and `autoMap` |
| `searchByPathSuffix(obj, suffixPath, prefix?)` | Every node (leaf AND intermediate object/array, e.g. `'departments[0].manager'` itself) whose full path ends with `suffixPath` — backs the short-path fallback in `get()`/`getFromFile()`/`getFromJsonFile()` |

### `src/utils/autoMap.ts`

| Function | Use |
|---|---|
| `autoMap(template, source, options?)` | Builds a payload, filling every `AUTO` leaf from `source` by matching field name; throws on an unresolved `AUTO` unless `{ keepUnresolved }` |
| `autoMapReport(template, source, options?)` | Same, returning `{ value, unresolved }` |
| `AUTO` (const) | The `'<AUTO>'` sentinel marking a template leaf to fill from the source |

### `src/api/chainAnalyzer.ts`

| Function | Use |
|---|---|
| `analyzeApiChain(calls)` | Detects which response field of a captured call feeds a later call's request field (JSON body, a numeric URL path segment, OR a numeric URL query parameter); returns `{ calls, links }` |
| `resolveLinkValue(calls, link)` | Reads a detected link's source value out of the captured calls |
| `urlIdLeaves(url)` *(module-level)* | Treats numeric URL path segments (`/users/1`) as a matchable `"id"` field (`$url:` sentinel), and numeric query params (`?postId=1`) as a matchable field named after the query key itself (`$query:` sentinel) |
| `leafEntries(obj, prefix?)` / `leafName(path)` *(module-level)* | Flattens an object/array to every leaf value + path, and extracts a path's field name — shared analysis helpers |

### `src/codegen/generateApiChainSpec.ts`

| Function | Use |
|---|---|
| `generateApiChainSpec(calls, report, options?)` | Turns a captured sequence + its `analyzeApiChain()` report into real TypeScript spec source — strong links become `saveResponseField()`/`context.get()`, weak links are listed in a comment for manual review |
| `emitValue(value, path, linkedPaths)` *(module-level)* | Serializes a value to TS source, replacing any leaf at a linked path with a live `apiActions.context.get(key)` read |
| `emitUrlTemplate(url, urlLinks, keyOf)` *(module-level)* | Rebuilds a URL as a template literal, substituting linked numeric path segments |

### `src/utils/loadJsonFixture.ts`

| Function | Use |
|---|---|
| `loadJsonFixture(name, overrides?, lookup?)` | Loads `e2e/data/<name>.json` (or a path containing `/`), resolves `<CURRENT_DATE>` tokens, resolves `{{path}}` tokens via the optional `lookup` callback, and shallow-merges `overrides` on top |
| `CacheLookup` (type) | `(path: string) => unknown` — the lookup contract `ScenarioCache.loadJson()` supplies, so this module never imports the cache (no import cycle) |
| `resolveCacheTokensInString(value, lookup)` *(module-level)* | Resolves `{{...}}` in one string — whole-string token keeps its type, embedded token interpolates |
| `resolveTokensDeep(value, lookup?)` *(module-level)* | Recursive token resolution helper used by `loadJsonFixture` |
| `fixtureFilePath(name)` *(module-level)* | Resolves a fixture name to its `e2e/data/<name>.json` path (or a project-root-relative path if `name` contains `/`) — shared by `loadJsonFixture()`, `saveJsonFile()`, and `ScenarioCache.saveToFile()` |
| `getFromJsonFile(name, ...pathsOrNone)` | Reads `e2e/data/<name>.json` fresh off disk every call — no caching, no `{{...}}` tokens; same three forms as `ScenarioCache.get()`, including the short/suffix-path fallback |
| `getFromJsonFileAt(name, path, options)` | Same as `getFromJsonFile()` for an ambiguous short path — picks a specific `{ occurrence }` (1-based) |
| `saveJsonFile(name, value)` | Writes ANY value straight to `e2e/data/<name>.json`, pretty-printed — no `ScenarioCache` involved. The reverse of `getFromJsonFile()`; `ScenarioCache.saveToFile()` is a thin wrapper over this |
| `resolveOnePath(data, path, options?)` *(module-level)* | Resolves one path against already-loaded data: exact path first, then falls back to `searchByPathSuffix` if that doesn't resolve (including if it throws) — shared by `getFromJsonFile`/`getFromJsonFileAt` |
| `searchInJsonFile(name, fieldName, options?)` | Same as `ScenarioCache.search()`, sourced from a file on disk instead of the cache |
| `readRawJsonFile(name)` *(module-level)* | Reads and `JSON.parse`s a fixture file with no token resolution — shared by `getFromJsonFile`/`searchInJsonFile` |

### `src/utils/jsonRefs.ts`

| Function | Use |
|---|---|
| `resolveRefs(root)` | Replaces every `{"$ref": "path"}` node in a parsed document with the value at that path (resolved from the document root, same syntax + short-path fallback as `get()`) — de-duplicates a value repeated many times in one fixture. Throws on a circular or unresolvable ref. Applied automatically inside `loadJsonFixture()`/`getFromJsonFile()` |
| `resolveRefPath(root, refPath)` *(module-level)* | Resolves one `$ref` path against the whole document — exact path first, then suffix fallback |
| `isRefNode(v)` / `isPlainObject(v)` *(module-level)* | Type-narrowing helpers used by `resolveRefs` |

### `src/utils/pathUtils.ts`

| Function | Use |
|---|---|
| `tokenizePath(path)` | Splits a dot/bracket path into segments (`'items[0].price'` → `['items','0','price']`) |
| `getByPath(obj, path)` | Reads a path out of a nested object/array; `undefined` for a missing leaf, throws only when a mid-path segment descends into null/undefined |
| `leafSegment(path)` | The last segment of a path — the field name a multi-path `get()`/`getFromFile()` result is keyed by |

Lives here (not in `ScenarioCache.ts`) specifically so `loadJsonFixture.ts` can use it without an import cycle: `ScenarioCache.ts` depends on `loadJsonFixture.ts` (`loadJson`/`saveToFile`/`getFromFile`), so `loadJsonFixture.ts` must not depend back on `ScenarioCache.ts`. `ScenarioCache.ts` re-exports `getByPath` from here for backward compatibility.




### `src/web/textHelper.ts`


| Function                                                                         | Use                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `resolveDynamicTokens(input, now?)`                                              | Replaces `<CURRENT_DATE>`/`<CURRENT_DATE+N>` tokens with real dates     |
| `verifyTextOnScreen(page, text, opts?)`                                          | Substring search for text anywhere on screen, incl. iframes, with retry |
| `shouldDebug(explicit?)` / `formatCurrentDate(d)` / `sleep(ms)` *(module-level)* | Small internal helpers                                                  |




### `src/web/tableHelper.ts`


| Function                                                                                                      | Use                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `verifyWebTable(page, objName, rows, deps?, options?)`                                                        | Verifies expected rows appear in a table (`[header, ...dataRows]`)     |
| `resolveTableRoot(page, objName, getLocator?)`                                                                | Finds a table's root element by role/caption/aria-label/id/uniqueness  |
| `ensureTableElement(root)`                                                                                    | Descends into a nested `<table>` if the resolved root isn't one itself |
| `readTableData(table)`                                                                                        | Extracts headers + row cell text from a live `<table>`                 |
| `tableRowsToExpectedRows(rows)`                                                                               | Converts `[header, ...dataRows]` into header-keyed row objects         |
| `buildHeaderIndex(headers)`                                                                                   | Maps normalized header text to its column index                        |
| `compareCell(actual, expected, strict)`                                                                       | Cell-level comparison (exact or contains)                              |
| `scoreRow(actualCells, expectedCells, strict)`                                                                | Counts how many expected cells match a candidate row                   |
| `normalizeSpaces(s)` / `normalizeComparable(s)` / `normalizeDateLike(s)` / `log(debug, msg)` *(module-level)* | Text/date normalization + conditional logging helpers                  |




### `src/api/capture.ts`


| Function                                                   | Use                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `attachApiCapture(page, targetCapturedApis, options?)`     | Listens to every request/response on a page and records matched pairs, for `expectStatus()` to replay |
| `redactHeaderValue(key, value)` / `redactHeaders(headers)` | Strips `Authorization`/`Cookie` values before storing captured headers                                |
| `tryParseJson(raw)` / `contentTypeLooksJson(contentType)`  | Best-effort JSON parsing/detection for captured bodies                                                |
| `withTimeout(p, timeoutMs, onTimeout)`                     | Bounds an async body-parse with a fallback if it hangs                                                |
| `makeRequestKey(req)`                                      | Builds a matching key (method+URL+content-type+body length) to pair a request with its response       |




### `src/api/matcher.ts`


| Function                              | Use                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `normalizeUrl(inputUrl)`              | Strips scheme/host/trailing slash so URLs compare consistently                  |
| `urlToHostPlaceholder(normalizedUrl)` | Rebuilds a dummy absolute URL from a normalized path, for URL parsing utilities |
| `findCapturedApi(args)`               | Finds an unconsumed captured request matching a method+URL                      |
| `waitForCapturedApi(args)`            | Polls for a matching captured request up to a timeout                           |




### `src/api/token.ts`


| Function                               | Use                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `extractTokenFromJson(body)`           | Pulls an auth token out of a response body (`token`/`accessToken`/`access_token`/`jwt`) |
| `buildAuthorizationHeader(authToken?)` | Builds a `{ Authorization: 'Bearer ...' }` header, or `{}` if no token                  |




### `src/api/api-config.ts`


| Function                                                                                   | Use                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `resolveApiUrl(url)`                                                                       | Replaces `${alias}` tokens in a URL with base URLs collected from locator YAML |
| `clearApiUrlAliasCache()`                                                                  | Clears the cached alias map (for tests that change config between runs)        |
| `walkYamlFiles(dir, out)` / `collectStrings(obj, into)` / `loadAliases()` *(module-level)* | Alias-collection helpers used by `resolveApiUrl`                               |




### `src/core/config.ts`


| Function                                                    | Use                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `loadConfig()`                                              | Loads `e2e/config/config.yaml` and maps it into `process.env` (real env vars always win) |
| `channelFor(name?)` / `setEnv(key, value)` *(module-level)* | Maps a browser name to a Playwright channel; sets an env var only if unset               |




### `src/core/contextOptions.ts`


| Function                | Use                                                                            |
| ----------------------- | ------------------------------------------------------------------------------ |
| `resolveDevice(name?)`  | Looks up a Playwright device descriptor by name (e.g. `"iPhone 12 Pro"`)       |
| `launchOptions(extra?)` | Browser launch options that hide the "controlled by automated software" banner |
| `contextOptions(opts)`  | Context options applying device emulation + optional video recording           |




### `src/fixtures.ts`


| Export   | Use                                                                                         |
| -------- | ------------------------------------------------------------------------------------------- |
| `test`   | `@playwright/test`'s `test`, extended with the `webActions`/`apiActions`/`actions`/`scenarioCache`/`dbActions`/`dbPool` fixtures |
| `expect` | Re-exported from `@playwright/test`, unchanged                                              |

`dbPool` is a worker-scoped fixture (one real `pg.Pool` per worker, created lazily only if a test requests `dbActions`, closed at the end of the worker) — not meant to be used directly in a spec; use `dbActions` instead.

`scenarioCache` isn't meant to be used directly in a spec — it's the single `ScenarioCache` instance injected into both `webActions`/`apiActions` (and named `scenarioCache`, not `context`, to avoid colliding with Playwright's own built-in `context: BrowserContext` fixture). Reach it via `webActions.context`/`apiActions.context`/`actions.context` instead.




### `scripts/scaffold.js`


| Function                                              | Use                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `writeIfMissing(consumerRoot, relPath, content)`      | Writes a file into the consumer project, never overwriting an existing one                              |
| `mergePackageJsonField(consumerRoot, field, entries)` | Merges keys into the consumer's `package.json`, never overwriting an existing key                       |
| `runScaffold(consumerRoot, libraryRoot)`              | Writes every scaffold file (`playwright.config.ts`, `tsconfig.json`, config/locator YAML, starter spec) |




### `scripts/postinstall.js` / `scripts/init.js` / `scripts/generate-locator-types.js`

CLI entry points — `postinstall.js` runs `runScaffold()` automatically on `npm install`; `init.js` runs it manually (`npx playwright-without-bdd-init`); `generate-locator-types.js` runs the locator-name codegen manually (`npx playwright-without-bdd-generate-types`). No additional exported functions beyond what's documented above.

---



## Configuration

`e2e/config/config.yaml` in your project:

```yaml
browser:
  name: chrome            # chromium | chrome | edge | firefox
  headless: false
  slowMo: 0
  clickTimeoutMs: 30000
  recordVideo: true

run:
  retryOnFail: 0
  reportFolder: ./reports/integrationTests
  maxInstances: 1
```

Real environment variables always win over `config.yaml` (e.g. `HEADLESS=true npm test`).

`playwright.config.ts` (scaffolded into your project) is Playwright Test's own config format — add `projects`, change `testDir`, etc. as needed.

---



## Running Tests

```bash
npm test               # playwright test
npm run test:headed    # visible browser
npm run test:ui        # Playwright's interactive UI mode
npx playwright test tests/login.spec.ts
npx playwright test --grep @smoke
```

---



## Reports

```bash
npm run report          # opens the HTML report
```

Report location: `reports/integrationTests/` (configurable via `run.reportFolder`).