Feature: Recordedflow

  Scenario: User flow

    Given User navigates to "https://misha-customer-billing.vercel.app/login" URL

    And User is on "recordedflow" screen
    Given enters "surya@evanke.com" text in "Email Address" textbox
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button

    And User is on "mishaCustomerBilling" screen
    When verify data from "Orders" web table
      | S.No | Name | DOB |
      | 1 | KENNY, ANDERSON | 06/12/1964 |
      | 2 | KIMBERLY, ANDERSON |  |
      | 3 |  |  |