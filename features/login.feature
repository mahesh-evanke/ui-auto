@smoke @auth
Feature: Validate auth API (POST)

  Scenario: Auth success returns token
    Given User sends POST request to "https://restful-booker.herokuapp.com/auth" with body:
      | path     | value           |
      | username | "admin"         |
      | password | "password123"   |
    Then User expects status code 200
    Then User validates response has token

  Scenario: Auth failure returns reason
    Given User sends POST request to "https://restful-booker.herokuapp.com/auth" with body:
      | path     | value           |
      | username | "admin"         |
      | password | "wrongPass123"  |
    Then User expects status code 200
    Then User validates response has fields:
      | path   | value              |
      | reason | "Bad credentials"  |