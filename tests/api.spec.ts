import { test, expect } from '../src';

test.describe('API only', () => {
  test('GET returns the expected post', async ({ apiActions }) => {
    apiActions.sendRequest('GET', 'https://jsonplaceholder.typicode.com/posts/1');
    await apiActions.expectStatus(200);
    await apiActions.validateResponseFields({ id: 1, userId: 1 });
  });

  test('POST creates a resource', async ({ apiActions }) => {
    apiActions.sendRequest('POST', 'https://jsonplaceholder.typicode.com/posts', {
      title: 'foo',
      body: 'bar',
      userId: 1,
    });
    await apiActions.expectStatus(201);
    await apiActions.validateResponseFields({ title: 'foo', body: 'bar', userId: 1 });
  });
});
