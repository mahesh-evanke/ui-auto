import { test, expect, request as playwrightRequest } from '@playwright/test';
import { saveJsonFile, getFromJsonFile } from '../src';

/**
 * The simplest version of "use API1's response as API2's input" against a
 * real API - saving and reading the JSON file are each ONE function call:
 *
 *   1. Call API1 with some input.
 *   2. saveJsonFile('api1-response', api1Body)   <- saves it in one call
 *   3. getFromJsonFile('api1-response', 'access_token')   <- reads it back in one call
 *   4. Send that value as input to API2.
 *
 * API1 = login (https://customer-billing-dev.vercel.app/auth/login)
 * API2 = active customer entries (https://customer-billing-dev.vercel.app/customers/entries/all)
 * The value that flows from API1 to API2 is the login's access_token, sent
 * as API2's Authorization header.
 */
test('API1 response saved to JSON, then read back and sent as API2 input', async () => {
  const apiContext = await playwrightRequest.newContext();

  // ---------- Step 1: Call API1 ----------
  const api1Response = await apiContext.post('https://customer-billing-dev.vercel.app/auth/login', {
    data: {
      email: 'surya@evanke.com',
      password: 'Test@123',
    },
  });
  expect(api1Response.status()).toBe(200);
  const api1Body = await api1Response.json();

  // ---------- Step 2: Save API1's response - one function call ----------
  saveJsonFile('api1-response', api1Body); // -> e2e/data/api1-response.json

  // ---------- Step 3: Read the value we need back - one function call ----------
  const accessToken = getFromJsonFile('api1-response', 'access_token');

  // ---------- Step 4: Send that value as input to API2 ----------
  const api2Response = await apiContext.get('https://customer-billing-dev.vercel.app/customers/entries/all', {
    params: { status: 'active' },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  expect(api2Response.status()).toBe(200);
  const api2Body = await api2Response.json();
  saveJsonFile('api2-response', api2Body);
  expect(Array.isArray(api2Body)).toBe(true);
  expect(api2Body.length).toBeGreaterThan(0);

  await apiContext.dispose();
});
