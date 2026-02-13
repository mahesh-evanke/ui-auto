Feature: Sample Form - Verify field text step

  Verifies that the step "Verify field {string} text is {string}" works
  against e2e/features/support/sample-form.html using Sample Form locators.

  @smoke
  Scenario: Verify field text matches expected values on Sample Form
    Given User navigates to "http://127.0.0.1:5500/e2e/features/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When Verify field "Page Heading" text is "Sample Form - E2E Elements"
    When Verify field "Office Code Label" text is "Office Code"
    When Verify field "Order Amount" text is "$100.00"
    When Verify field "Submit" text is "Submit"
    When Verify field "Help" text is "Help"

  @smoke
  Scenario: Verify Order Total label text (with colon and amount)
    Given User navigates to "http://127.0.0.1:5500/e2e/features/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When Verify field "Order Total Label" text is "Order Total : $100.00"
