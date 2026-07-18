Feature: Locator kind coverage (id, name, tagName, linkText, buttonText, className, xpath, custom attribute)

  Proves buildLocatorFromTuple() in world.ts correctly resolves every WDIO-style
  locator kind, not just css/xpath, against e2e/support/locator-kind-fixture.html.
  Entries registered in e2e/locators/generated/web/LocatorKindFixture.yaml.
  Verify field uses getLocator() directly for any element (value for inputs,
  text content otherwise), so it exercises every kind uniformly.

  Scenario: id kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    Given enters "id-kind-value" text in "Office Code By Id" textbox
    When Verify field "Office Code By Id" text is "id-kind-value"

  Scenario: name kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    Given enters "name-kind-value" text in "Office Code By Name" textbox
    When Verify field "Office Code By Name" text is "name-kind-value"

  Scenario: tagName kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Heading By Tag" text is "Locator Kind Fixture"

  Scenario: linkText kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Help By LinkText" text is "Help"

  Scenario: buttonText kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Submit By ButtonText" text is "Submit"

  Scenario: className kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Marker By ClassName" text is "Marker"

  Scenario: xpath kind
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Heading By Xpath" text is "Locator Kind Fixture"

  Scenario: custom attribute kind (generic fallback branch)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Marker By TestId" text is "Marker"

  # ---- Recorder-captured (Playwright semantic) kinds, same feature, same run ----

  Scenario: role kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Save By Role" text is "Save"

  Scenario: label kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    Given enters "secret123" text in "Password By Label" textbox
    When Verify field "Password By Label" text is "secret123"

  Scenario: placeholder kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    Given enters "search-term" text in "Search By Placeholder" textbox
    When Verify field "Search By Placeholder" text is "search-term"

  Scenario: alttext kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Logo By AltText" text is ""

  Scenario: title kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Info By Title" text is "i"

  Scenario: text kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Paragraph By Text" text is "Standalone paragraph text"

  Scenario: testid kind (recorder-captured)
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/locator-kind-fixture.html" URL
    And User is on "LocatorKindFixture" screen
    When Verify field "Save By TestId" text is "Save"
