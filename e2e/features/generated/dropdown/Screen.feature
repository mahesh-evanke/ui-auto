Feature: e2e_features_support_sample-form.html

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "http://127.0.0.1:5500/e2e/features/support/sample-form.html" URL
    And User is on "generated/dropdown/e2e_features_support_sample-form.html" screen
    When selects "north" from "Region" Drop-down list
