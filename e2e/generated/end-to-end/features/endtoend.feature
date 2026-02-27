# Web UI + API — TRUE E2E
Feature: Web UI + API Integration

  @webui-api @smoke
  Scenario: endtoend

    Given User navigates to "http://localhost:3000/" URL
    And User is on "generated/endtoend" screen
    And enters "surya@evanke.com" text in "Email Address" textbox
    And enters "Test@123" text in "Password" textbox
    When clicks on "Login" button
    Given User sends POST request to "http://192.168.31.217:8000/auth/login" with body:
      | path  | value |
      | email | "surya@evanke.com" |
      | password | "Test@123" |
    Then User expects status code 200

    Given User sends GET request to "http://192.168.31.217:8000/services/"
    Then User expects status code 200

    Given User sends GET request to "http://192.168.31.217:8000/services/"
    Then User expects status code 200

    Given User sends GET request to "http://192.168.31.217:8000/customers/entries/all?status=active"
    Then User expects status code 200

