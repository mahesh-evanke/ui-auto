@smoke @login
Feature: Login

  Scenario: User can log in
    Given User navigates to "http://localhost:4200/" URL
    And User is on "Login Page" screen
    And enters "user@example.com" text in "Username" textbox
    And enters "password" text in "Password" textbox
    When User clicks on "Login" button
    Then User is on "Home" screen
