import { test, expect } from '../src';

test.describe('Web + API combined', () => {
  test('UI navigation and a direct API call in the same test', async ({ webActions, apiActions }) => {
    // Web side
    await webActions.navigate('https://the-internet.herokuapp.com/');
    await webActions.verifyTextPresent('Welcome to the-internet');

    // API side — same test, same fixtures, independent of the page's own network traffic
    apiActions.sendRequest('GET', 'https://jsonplaceholder.typicode.com/users/1');
    await apiActions.expectStatus(200);
    await apiActions.validateResponseFields({ id: 1, username: 'Bret' });
  });
});
