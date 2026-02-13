Feature: e2e_features_support_sample-form.html

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "http://127.0.0.1:5500/e2e/features/support/sample-form.html" URL
    And User is on "generated/Link/e2e_features_support_sample-form.html" screen
    When Verify field "Page Heading" text is "Sample Form - E2E Elements"
    When clicks on "Help" link
