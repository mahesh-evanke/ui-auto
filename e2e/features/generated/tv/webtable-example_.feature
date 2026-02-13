Feature: webtable-example_

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "https://www.dezlearn.com/webtable-example/" URL
    And User is on "generated/tv/webtable-example_" screen
    When verify "Name" text is present on the screen
