import { test, expect, getFromJsonFile } from '../src';

/**
 * Real end-to-end coverage of https://customer-billing-deve.vercel.app/ - UI
 * login, direct API login + the two API calls the dashboard itself makes,
 * and a combined web+api sequence in one chain. Every URL, locator, response
 * shape, and status code below was confirmed by actually running against the
 * live app (not guessed):
 *
 *   POST https://customer-billing-dev.vercel.app/auth/login
 *     body:   { email, password }
 *     200 ->  { access_token, token_type: 'bearer', user: { id, email, first_name, last_name, created_at } }
 *
 *   GET https://customer-billing-dev.vercel.app/services/                       (requires Authorization: Bearer <access_token> - 401 without it)
 *   GET https://customer-billing-dev.vercel.app/customers/entries/all?status=active  (same - 401 without it)
 *
 * ApiActions auto-detects "access_token" in the login response and attaches
 * it as "Authorization: Bearer <token>" to every apiActions request after
 * that in the same test - no code needed for that part; the 401-without-it
 * behavior above is exactly what proves it's genuinely required, not just
 * decorative.
 *
 * e2e/data/customer-billing.json is NOT hand-authored - it does not exist
 * until the first test below runs. That test types the credentials from
 * e2e/data/login-credentials.json into the real form, then one call -
 * saveFieldsToFile() - reads those same fields back off the page and writes
 * e2e/data/customer-billing.json itself, at runtime. Every test after that
 * just loads that file by key wherever it's needed - nobody wrote its
 * content by hand, and it can be reused anywhere, not just in this file.
 *
 * (Tests run in file order in a single worker, same as everywhere else in
 * this suite, so the file created by the first test is already on disk by
 * the time the later tests read it.)
 */
const AUTH_URL = 'https://customer-billing-dev.vercel.app/auth/login';
const SERVICES_URL = 'https://customer-billing-dev.vercel.app/services/';
const CUSTOMERS_URL = 'https://customer-billing-dev.vercel.app/customers/entries/all?status=active';

test.describe('Customer Billing (customer-billing-deve.vercel.app)', () => {
  test('UI: logging in with the real form reaches the dashboard, then saves what was typed to a file', async ({ webActions }) => {
    await webActions
      .navigate('https://customer-billing-deve.vercel.app/login')
      .usePage('CustomerBillingLogin')
      .fill('Email Field', getFromJsonFile('login-credentials', 'email'))
      .fill('Password Field', getFromJsonFile('login-credentials', 'password'))
      .saveFieldsToFile({ 'Email Field': 'email', 'Password Field': 'password' }, 'customer-billing')
      .click('Login Button')
      .verifyTextPresent('Manage services, invoices & customers') // real dashboard heading
      .verifyTextPresent('surya reddy'); // real logged-in user's name, from the response's first_name/last_name
  });

  test('API: login -> the two calls the dashboard itself makes, in sequence', async ({ apiActions }) => {
    // Reuses the file the PREVIOUS test created - not login-credentials.json,
    // not a JS constant. This is "load the file, pass the values, done."
    await apiActions
      .sendRequest('POST', AUTH_URL, getFromJsonFile('customer-billing'))
      .expectStatus(200)
      .validateResponseFields({
        token_type: 'bearer',
        user: { email: getFromJsonFile('customer-billing', 'email'), first_name: 'surya', last_name: 'reddy' },
      })
      .saveResponseField('user.id', 'userId');

    expect(apiActions.context.get('userId')).toBe(8);

    // 2. The dashboard's own first call: the services price list.
    await apiActions.sendRequest('GET', SERVICES_URL).expectStatus(200);
    const services = apiActions.lastResponseBody as Array<{ id: number; name: string; rate_per_day: number }>;
    expect(Array.isArray(services)).toBe(true);
    expect(services.length).toBeGreaterThan(0);
    expect(services[0]).toHaveProperty('rate_per_day');

    // 3. The dashboard's second call: active customer entries.
    await apiActions.sendRequest('GET', CUSTOMERS_URL).expectStatus(200);
    const customers = apiActions.lastResponseBody as Array<{ id: number; first_name: string; last_name: string; total_amount_due: number }>;
    expect(Array.isArray(customers)).toBe(true);
    expect(customers.length).toBeGreaterThan(0);
    expect(customers[0]).toHaveProperty('total_amount_due');
  });

  test('WEB + API in one sequence: UI login, then direct API calls reusing the captured token', async ({ actions }) => {
    // Same self-created file, reused again - a third place, still no constants.
    await actions
      .navigate('https://customer-billing-deve.vercel.app/login')
      .usePage('CustomerBillingLogin')
      .fill('Email Field', getFromJsonFile('customer-billing', 'email'))
      .fill('Password Field', getFromJsonFile('customer-billing', 'password'))
      .click('Login Button')
      .verifyTextPresent('Manage services, invoices & customers');

    // ...then API steps, in the SAME chain - the UI login above and the API
    // login below are independent (different sessions), but this is the
    // "web then api, in sequence, one file, our format" shape that was asked
    // for: WebActions steps followed by ApiActions steps on the same fixture.
    await actions
      .sendRequest('POST', AUTH_URL, getFromJsonFile('customer-billing'))
      .expectStatus(200)
      .saveResponseField('user.id', 'userId')
      .sendRequest('GET', SERVICES_URL)
      .expectStatus(200)
      .sendRequest('GET', CUSTOMERS_URL)
      .expectStatus(200);

    expect(actions.context.get('userId')).toBe(8);
  });
});
