Feature: Verify CURRENT_DATE token resolution through real steps

  Scenario: Bare token, default format
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE>" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE>"

  Scenario: Format suffix only, no offsets
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE>:dd/mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE>:dd/mm/yyyy"

  Scenario: Single positive offset
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE,1M>:mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE,1M>:mm/yyyy"

  Scenario: Single negative offset
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE,-1Y>:mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE,-1Y>:mm/yyyy"

  Scenario: Combined positive offsets with dd/mm/yyyy format
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE,1Y,1M,1D>:dd/mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE,1Y,1M,1D>:dd/mm/yyyy"

  Scenario: Combined negative offsets with dd/mm/yyyy format
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<CURRENT_DATE,-1Y,-1M,-1D>:dd/mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<CURRENT_DATE,-1Y,-1M,-1D>:dd/mm/yyyy"

  Scenario: Case-insensitive token, multi-digit offsets
    Given User navigates to "file:///C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/date-field.html" URL
    Given enters "<Current_date,1Y,2M,7D>:mm/yyyy" text in "dateField" textbox
    When Verify field "dateField" text is "<Current_date,1Y,2M,7D>:mm/yyyy"
