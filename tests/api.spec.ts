import { test, expect } from '../src';

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
});
