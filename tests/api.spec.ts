import { test, expect, loadJsonFixture } from '../src';

test.describe('API only', () => {
  test('GET returns the expected post', async ({ apiActions }) => {
    await apiActions
      .sendRequest('GET', 'https://jsonplaceholder.typicode.com/posts/1')
      .expectStatus(200)
      .validateResponseFields({ id: 1, userId: 1 });
  });

  test('POST creates a resource', async ({ apiActions }) => {
    await apiActions
      .sendRequest('POST', 'https://jsonplaceholder.typicode.com/posts', { title: 'foo', body: 'bar', userId: 1 })
      .expectStatus(201)
      .validateResponseFields({ title: 'foo', body: 'bar', userId: 1 });
  });

  test('POST with a large body loaded from a JSON fixture file, not inlined', async ({ apiActions }) => {
    // e2e/data/create-post-payload.json - keeps a big request body out of the spec file
    const body = loadJsonFixture('create-post-payload');
    await apiActions
      .sendRequest('POST', 'https://jsonplaceholder.typicode.com/posts', body)
      .expectStatus(201)
      .validateResponseFields(body);
  });

  test('every response is cached automatically - reusable later without an explicit save call', async ({ apiActions }) => {
    await apiActions.sendRequest('GET', 'https://jsonplaceholder.typicode.com/posts/1').expectStatus(200);
    await apiActions.sendRequest('GET', 'https://jsonplaceholder.typicode.com/posts/2').expectStatus(200);

    // No saveResponseField()/saveResponseBody() was called for either request -
    // both responses are still retrievable by method+URL.
    const post1 = apiActions.getCachedResponse<{ id: number }>('GET', 'https://jsonplaceholder.typicode.com/posts/1');
    const post2 = apiActions.getCachedResponse<{ id: number }>('GET', 'https://jsonplaceholder.typicode.com/posts/2');
    expect(post1.id).toBe(1);
    expect(post2.id).toBe(2);
  });
});
