@smoke @login
Feature: Login

  Scenario: api test for login
    Given User makes a request to the login API
    | Attribute | Value |
    | Laptop       | 1        |
    | Mouse        | 2        |
    | Keyboard     | 1        |
    Then the response should be successful
    And the response should contain the user's email
    And the response should contain the user's token
    And the response should contain the user's name
    And the response should contain the user's role
    And the response should contain the user's permissions
    And the response should contain the user's permissions
