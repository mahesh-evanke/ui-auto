import { test, expect } from '../src';

test.describe('Web only', () => {
  test('valid credentials reach the secure area', async ({ webActions }) => {
    await webActions
      .navigate('https://the-internet.herokuapp.com/login')
      .usePage('Login')
      .fill('Username Field', 'tomsmith')
      .fill('Password Field', 'SuperSecretPassword!')
      .click('Login Button')
      .verifyTextPresent('You logged into a secure area');
  });

  test('invalid password is rejected', async ({ webActions }) => {
    await webActions
      .navigate('https://the-internet.herokuapp.com/login')
      .usePage('Login')
      .fill('Username Field', 'tomsmith')
      .fill('Password Field', 'wrong-password')
      .click('Login Button')
      .verifyTextPresent('Your password is invalid');
  });
});
