Feature: Auto Generated Test

  Scenario: User flow

    Given User navigates to "https://misha-customer-billing.vercel.app/" URL
    Given User is on "webtable" screen
    Given enters "surya@evanke.com" text in "Email Addresssss" textbox
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button
    When verify data from "webtable" web table
      | Name | DOB |
      | KENNY, ANDERSON | 06/12/1964 |
      | AARON, BLACK | 09/20/1991 |
