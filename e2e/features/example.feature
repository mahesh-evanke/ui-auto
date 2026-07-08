Feature: Example smoke test (runs against the installed wdio-playwright-library)

  Scenario: Verify the-internet homepage loads
    Given User navigates to "https://the-internet.herokuapp.com/" URL
    When verify "Welcome to the-internet" text is present on the screen
