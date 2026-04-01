Feature: Auto Generated Test

  Scenario: User flow
    Given User sends POST request to "https://misha-customer-billing-backend.vercel.app/auth/login" with body:
      | path  | value |
      | email | "surya@evanke.com" |
      | password | "Test@123" |
    Then User expects status code 200
    Given User sends GET request to "https://misha-customer-billing.vercel.app/logo192.png"
    Then User expects status code 200
    Given User sends GET request to "https://misha-customer-billing-backend.vercel.app/services/"
    Then User expects status code 200
    Given User sends GET request to "https://misha-customer-billing-backend.vercel.app/customers/entries/all?status=active"
    Then User expects status code 200
