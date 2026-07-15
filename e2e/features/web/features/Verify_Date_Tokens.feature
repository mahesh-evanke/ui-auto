Feature: Verify CURRENT_DATE token resolution through real steps (WDIO)

  Uses the Office Code text field on e2e/support/sample-form.html (served
  locally by wdio.conf.ts) to prove <CURRENT_DATE,...>:format tokens get
  resolved automatically via the Given/When/Then wrapper in web.steps.ts,
  with beforeStep logging detection ahead of each step.

  @smoke
  Scenario: Bare token, default format
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    Given enters "<CURRENT_DATE>" text in "Office Code" textbox
    When Verify field "Office Code" text is "<CURRENT_DATE>"

  @smoke
  Scenario: Single positive offset with format suffix
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    Given enters "<CURRENT_DATE,1M>:mm/yyyy" text in "Office Code" textbox
    When Verify field "Office Code" text is "<CURRENT_DATE,1M>:mm/yyyy"

  @smoke
  Scenario: Combined negative offsets with dd/mm/yyyy format
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    Given enters "<CURRENT_DATE,-1Y,-1M,-1D>:dd/mm/yyyy" text in "Office Code" textbox
    When Verify field "Office Code" text is "<CURRENT_DATE,-1Y,-1M,-1D>:dd/mm/yyyy"

  @smoke
  Scenario: Case-insensitive token, multi-digit offsets
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    Given enters "<Current_date,1Y,2M,7D>:mm/yyyy" text in "Office Code" textbox
    When Verify field "Office Code" text is "<Current_date,1Y,2M,7D>:mm/yyyy"
