Feature: Verify Dropdown functionality

  Scenario: Verify welcome text, navigate to dropdown, select an option and verify selection
    Given User navigates to "https://the-internet.herokuapp.com" URL
    Then verify "Welcome to the-internet" text is present on the screen
    Given User navigates to "https://the-internet.herokuapp.com/dropdown" URL
    Then verify "Dropdown List" text is present on the screen
    When User clicks on "Dropdown" button
    When User clicks on "Option 1" button
    Then verify "Option 1" text is present on the screen
