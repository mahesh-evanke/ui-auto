Feature: Screen

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "https://primereact.org/dropdown/" URL
    And User is on "generated/rad2/Screen" screen
    When clicks on "Select a City" button
    When selects "option1" from "Option List" Drop-down list
