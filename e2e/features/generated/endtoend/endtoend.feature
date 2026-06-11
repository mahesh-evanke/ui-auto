Feature: Endtoend

  Scenario: User flow

    Given User navigates to "https://customer-billing-deve.vercel.app/login" URL

    And User is on "endtoend" screen
    Given enters "surya@evanke.com" text in "Email Address" textbox
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button
    Given User sends POST request to "${login}" with body:
      | path     | value |
      | email    | "surya@evanke.com" |
      | password | "Test@123" |
    Then User expects status code 200
    And User validates response has fields:
      | path            | value |
      | access_token    | "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4LCJlbWFpbCI6InN1cnlhQGV2YW5rZS5jb20iLCJleHAiOjE3ODEyMDI4NTB9.IP49zUpX1CD3VO3WVWoL4S2uxnrhYkfdLlHfTF7L8W8" |
      | token_type      | "bearer" |
      | user.id         | "8" |
      | user.email      | "surya@evanke.com" |
      | user.first_name | "surya" |
      | user.last_name  | "reddy" |
      | user.created_at | "2026-02-18T11:56:26.649370" |

    And User is on "customerBillingDeve" screen
    When User clicks on "Edit" button
    When User clicks on "Close" button
