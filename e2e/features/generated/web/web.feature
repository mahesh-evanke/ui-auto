Feature: Web

  Scenario: User flow

    Given User navigates to "https://customer-billing-deve.vercel.app/login" URL

    And User is on "web" screen
    When User clicks on "Email Address" button
    Given enters "surya@evanke.com" text in "Email Address" textbox
    When User clicks on "Password" button
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button
    When User clicks on "Edit" button
    When User clicks on "Close" button
