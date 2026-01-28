Feature: SauceDemo Login Functionality

@WebUI @saucedemo @login @test
#SAUCEDEMO01
Scenario: Verify successful login to SauceDemo with valid credentials
    Given User navigates to "https://www.saucedemo.com/" URL
    And User is on "Login Page" screen
    And enters "standard_user" text in "Username" textbox
    And enters "secret_sauce" text in "Password" textbox
    When User clicks on "Login" button
    Then User is on "Products" screen
