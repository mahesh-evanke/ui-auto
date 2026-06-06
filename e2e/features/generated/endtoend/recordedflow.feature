@smoke

Feature: Auto Generated Test
  
  Scenario: User flow

    Given User navigates to "https://customer-billing-deve.vercel.app/" URL
    Given User is on "recordedflow" screen
    When verify "Misha House Billing" text is present on the screen
    When User clicks on "Email Address" button
    Given enters "surya@evanke.com" text in "Email Address" textbox
    When User clicks on "Password" button
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button
    
