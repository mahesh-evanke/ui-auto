Feature: API tests

  @api @smoke
  Scenario: Verify login
    Given User sends POST request to "http://localhost:8000/auth/login" with body:
      | path  | value          |
      | email | "prudhviankamreddi1@gmail.com" |
      | password | "Prudhvi" |
    Then User expects status code 200
