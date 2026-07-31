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

  test('reuse a value from one API response as input to the next, in one chain', async ({ apiActions }) => {
    await apiActions
      .sendRequest('GET', 'https://jsonplaceholder.typicode.com/posts/1')
      .expectStatus(200)
      .saveResponseField('userId', 'userId') // stash the first response's userId
      .sendRequest('GET', () => `https://jsonplaceholder.typicode.com/users/${apiActions.context.get('userId')}`)
      .expectStatus(200)
      .validateResponseFields({ id: 1, username: 'Bret' }); // proves userId=1 was actually reused
  });

  test('reuse text read from the page as input to an API call, in one chain', async ({ actions }) => {
    await actions
      .navigate('https://the-internet.herokuapp.com/')
      .extractText('Welcome to the-internet', 'heading') // save the page heading
      .sendRequest('POST', 'https://jsonplaceholder.typicode.com/posts', () => ({
        title: actions.context.get('heading'),
        userId: 1,
      }))
      .expectStatus(201);

    expect(actions.lastResponseBody).toMatchObject({ title: actions.context.get('heading') });
  });
});
