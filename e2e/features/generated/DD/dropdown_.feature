Feature: dropdown_

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "https://primereact.org/dropdown/" URL
    And User is on "generated/DD/dropdown_" screen
    When selects "London" from "Select a City" Drop-down list
