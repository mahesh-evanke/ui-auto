Feature: Auto Generated Test

  Scenario: User flow
    Given User sends POST request to "${api1}auth/login" with body:
      | path  | value |
      | email | "surya@evanke.com" |
      | password | "Test@123" |
    Then User expects status code 200
    Given User sends GET request to "${api1}services/"
    Then User expects status code 200
    Given User sends GET request to "${api1}customers/entries/all?status=active"
    Then User expects status code 200
