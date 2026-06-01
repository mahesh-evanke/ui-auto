Feature: Verify navigation and text on the-internet site

  Scenario: Home page and checkboxes page verification
    Given User navigates to "https://the-internet.herokuapp.com" URL
    Then verify "Welcome to the-internet" text is present on the screen
    Given User navigates to "https://the-internet.herokuapp.com/checkboxes" URL
    Then verify "Checkboxes" text is present on the screen
