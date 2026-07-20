import { test, expect } from '../src';

test.describe('Web + API combined', () => {
  test('UI navigation and a direct API call in the same test', async ({ webActions, apiActions }) => {
    await webActions.navigate('https://the-internet.herokuapp.com/').verifyTextPresent('Welcome to the-internet');

    await apiActions
      .sendRequest('GET', 'https://jsonplaceholder.typicode.com/users/1')
      .expectStatus(200)
      .validateResponseFields({ id: 1, username: 'Bret' });
  });

  test('same thing as one chain via the combined actions fixture', async ({ actions }) => {
    await actions
      .navigate('https://the-internet.herokuapp.com/')
      .verifyTextPresent('Welcome to the-internet')
      .sendRequest('GET', 'https://jsonplaceholder.typicode.com/users/1')
      .expectStatus(200)
      .validateResponseFields({ id: 1, username: 'Bret' });
  });
});
