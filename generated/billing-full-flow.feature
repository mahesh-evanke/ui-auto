Feature: Billing application login and dashboard validation

  Scenario: User logs in and verifies billing table data
    Given User navigates to "https://customer-billing-deve.vercel.app/" URL
    And User is on "loginPage" screen
    Given enters "surya@evanke.com" text in "Email" textbox
    And enters "Test@123" text in "Password" textbox
    When User clicks on "Login button" button
    Then verify "Misha House Billing" text is present on the screen
    And verify "Billing" text is present on the screen
