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

  test('softly() runs every check and reports all failures together', async ({ webActions }) => {
    await webActions.navigate('https://the-internet.herokuapp.com/login').usePage('Login');

    let caught: Error | undefined;
    try {
      await webActions
        .softly()
        .click('This Button Does Not Exist On The Page') // fails after ~15s
        .verifyTextPresent('Username'); // this one passes - still runs even though the first failed
    } catch (error) {
      caught = error as Error;
    }

    expect(caught?.message).toContain('1 soft assertion(s) failed');
  });
});
