Feature: dom-generated-flow
  Scenario: dom generated flow
    Given User navigates to "https://the-internet.herokuapp.com/" URL
    And User is on "mainPage" screen
    Then verify "A/B Testing" text is present on the screen
