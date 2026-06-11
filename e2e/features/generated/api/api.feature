Feature: api API Flow

  Scenario: API calls
    Given User sends POST request to "${login}" with body:
      | path     | value |
      | email    | "surya@evanke.com" |
      | password | "Test@123" |
    Then User expects status code 200
  
    Given User sends GET request to "${service}/"
    Then User expects status code 200
    And User validates response has fields:
      | path             | value |
      | [0].name         | "ASS" |
      | [0].rate_per_day | "220.65" |
      | [0].default_days | "1" |
      | [0].id           | "1" |
