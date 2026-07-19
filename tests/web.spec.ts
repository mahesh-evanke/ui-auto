import { test, expect } from '../src';

test.describe('Web only', () => {
  test('valid credentials reach the secure area', async ({ webActions }) => {
    await webActions.navigate('https://the-internet.herokuapp.com/login');
    webActions.usePage('Login');

    await webActions.fill('Username Field', 'tomsmith');
    await webActions.fill('Password Field', 'SuperSecretPassword!');
    await webActions.click('Login Button');

    await webActions.verifyTextPresent('You logged into a secure area');
  });

  test('invalid password is rejected', async ({ webActions }) => {
    await webActions.navigate('https://the-internet.herokuapp.com/login');
    webActions.usePage('Login');

    await webActions.fill('Username Field', 'tomsmith');
    await webActions.fill('Password Field', 'wrong-password');
    await webActions.click('Login Button');

    await webActions.verifyTextPresent('Your password is invalid');
  });
});
