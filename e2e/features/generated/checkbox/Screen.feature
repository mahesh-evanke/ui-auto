Feature: Screen

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "https://primereact.org/" URL
    And User is on "generated/checkbox/Screen" screen
    When clicks on "Get Started" link
    When clicks on "Components" button
    When clicks on "Checkbox" link
    Given select "Pepper" Checkbox
    Given select "Pepper" Checkbox
