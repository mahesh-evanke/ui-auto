# Gherkin Step Definitions Reference

This document provides a comprehensive reference for all Gherkin step definitions available in the WebdriverIO test automation framework.

**Total Step Definitions:** 94
- **Given Statements:** 11 (Setup/Prerequisites)
- **When Statements:** 65 (Actions/Interactions)
- **Then Statements:** 18 (Assertions/Verifications)

---

## GIVEN Statements (Setup/Prerequisites)

### 1. `Given('enters {string} text in {string} textbox', ...)` (Line 42)
**Purpose:** Enters text into a textbox. Supports special values like "500 characters", "501 characters", `<CURRENT_DATE>`, `<DOB>`, and `<blank>`. Handles iframes for Person Info and Contact Info screens.

**Parameters:**
- `{string}` - Text input value (supports special values)
- `{string}` - Element name

---

### 2. `Given('User is on {string} screen', ...)` (Line 363)
**Purpose:** Navigates to and waits for a screen. Extracts data (DOB, SSN, name, etc.) from Person Info and Contact Info screens. Calculates enrollment results for Pre-Adjudicative Results.

**Parameters:**
- `{string}` - Screen name

---

### 3. `Given('select {string} Checkbox', ...)` (Line 475)
**Purpose:** Selects a checkbox by name.

**Parameters:**
- `{string}` - Checkbox element name

---

### 4. `Given('select {string} Checkbox with Wait', ...)` (Line 481)
**Purpose:** Selects a checkbox with explicit wait for display.

**Parameters:**
- `{string}` - Checkbox element name

---

### 5. `Given('User inputs information on {string} screen with following params', ...)` (Line 718)
**Purpose:** Inputs information on a screen using a data table. Handles text, checkbox, radio, button, and dropdown inputs. Supports date calculations.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with field names and values

---

### 6. `Given('User inputs information on {string} screen with following parameters', ...)` (Line 782)
**Purpose:** Inputs information using a data table with Field/Value columns.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with Field and Value columns

---

### 7. `Given('select Claims Summary Checkbox', ...)` (Line 819)
**Purpose:** Selects the Claims Summary checkbox.

---

### 8. `Given('clicks on Claims Summary button', ...)` (Line 850)
**Purpose:** Clicks the Claims Summary button.

---

### 9. `Given('closes the application', ...)` (Line 866)
**Purpose:** Closes the application.

---

### 10. `Given('enters {string} text in {string} textbox in a frame', ...)` (Line 1311)
**Purpose:** Enters text in a textbox within an iframe. Supports date calculations.

**Parameters:**
- `{string}` - Text input value
- `{string}` - Element name

---

### 11. `Given('User is on {string} CCE screen', ...)` (Line 1405)
**Purpose:** Navigates to a CCE (Consolidated Claims Experience) screen and waits for the correct page title.

**Parameters:**
- `{string}` - CCE screen name

---

## WHEN Statements (Actions)

### 1. `When('User are on scenare title {string}', ...)` (Line 28)
**Purpose:** Logs the scenario title (utility step).

**Parameters:**
- `{string}` - Scenario title

---

### 2. `When('Verify field {string} text is {string}', ...)` (Line 32)
**Purpose:** Verifies field text matches expected value. Handles special characters.

**Parameters:**
- `{string}` - Field name
- `{string}` - Expected text

---

### 3. `When('User updates following information to pup up using {string}', ...)` (Line 71)
**Purpose:** Updates popup information using a button and data table.

**Parameters:**
- `{string}` - Button name
- DataTable - Table with field names and values

---

### 4. `When('User adds following information to pup up using {string}', ...)` (Line 81)
**Purpose:** Adds new information to a popup using a button and data table.

**Parameters:**
- `{string}` - Button name
- DataTable - Table with field names and values

---

### 5. `When('click More Info link, and verfiy popup text', ...)` (Line 94)
**Purpose:** Clicks "More Info" links and verifies popup title and text content.

**Parameters:**
- DataTable - Table with linkNumber, expectedTitle, and expectedText

---

### 6. `When('click page link and verify new pages opens with title', ...)` (Line 144)
**Purpose:** Clicks a link, verifies a new tab opens with expected title, then closes it.

**Parameters:**
- DataTable - Table with LinkText and ExpectedTitle

---

### 7. `When('User selects {string} link on Person Status screen', ...)` (Line 158)
**Purpose:** Selects a link on the Person Status screen.

**Parameters:**
- `{string}` - Link name

---

### 8. `When('User inputs information on the {string} screen if exist', ...)` (Line 163)
**Purpose:** Inputs information on a screen if it exists (conditional).

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with field names and values

---

### 9. `When('User inputs information on the {string} screen', ...)` (Line 174)
**Purpose:** Inputs information on a screen using a data table.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with field names and values

---

### 10. `When('User verify information on {string} screen with following params', ...)` (Line 185)
**Purpose:** Verifies information on a screen against expected values. Supports text, checkbox, radio, and dropdown verification.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with field names and expected values

---

### 11. `When('User verifies field entries on the Payment Method', ...)` (Line 254)
**Purpose:** Verifies Payment Method field entries, handling Direct Deposit vs other methods.

**Parameters:**
- DataTable - Table with Field and Value columns

---

### 12. `When('User verifies field entries on the {string} screen in query mode', ...)` (Line 280)
**Purpose:** Verifies field entries in query/read-only mode.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with Field and Value columns

---

### 13. `When('enters SSN with criteria {string} in {string} textbox', ...)` (Line 336)
**Purpose:** Enters SSN from CSV data based on criteria.

**Parameters:**
- `{string}` - Criteria name (CSV key)
- `{string}` - Element name

---

### 14. `When('User clicks on {string} button', ...)` (Line 343)
**Purpose:** Clicks a button. Captures filing date and sets enrollment variables on specific screens.

**Parameters:**
- `{string}` - Button name

---

### 15. `When('clicks on {string} button', ...)` (Line 415)
**Purpose:** Clicks a button (generic, skips if `<blank>`).

**Parameters:**
- `{string}` - Button name

---

### 16. `When('selects {string} text from {string} Drop-down list', ...)` (Line 424)
**Purpose:** Selects an option from a dropdown by text. Handles iframes and date calculations.

**Parameters:**
- `{string}` - Option value
- `{string}` - Dropdown element name

---

### 17. `When('selects {string} from {string} Drop-down list', ...)` (Line 443)
**Purpose:** Selects an option from a dropdown (alternative implementation).

**Parameters:**
- `{string}` - Option value
- `{string}` - Dropdown element name

---

### 18. `When('verify {string} text is present on the screen', ...)` (Line 456)
**Purpose:** Verifies text is present on screen. Supports `<CURRENT_DATE>` replacement.

**Parameters:**
- `{string}` - Text to verify

---

### 19. `When('clicks on {string} Radio button', ...)` (Line 486)
**Purpose:** Clicks a radio button. Handles iframes.

**Parameters:**
- `{string}` - Radio button name

---

### 20. `When('verify data from {string} web table', ...)` (Line 495)
**Purpose:** Verifies web table data (headers and rows). Supports date replacements.

**Parameters:**
- `{string}` - Table element ID
- DataTable - Expected table data

---

### 21. `When('User verifies information on {string} screen header with following parameters', ...)` (Line 542)
**Purpose:** Verifies screen header information with date calculations and dynamic values.

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with Field and Value columns

---

### 22. `When('User verify information on {string} screen header with following parameters', ...)` (Line 595)
**Purpose:** Verifies screen header information (alternative implementation).

**Parameters:**
- `{string}` - Screen name
- DataTable - Table with Field and Value columns

---

### 23. `When('verify information from {string} webtable', ...)` (Line 656)
**Purpose:** Verifies webtable information by matching column headers and cell values.

**Parameters:**
- `{string}` - Table element ID
- DataTable - Expected table data

---

### 24. `When('clicks on {string} link', ...)` (Line 707)
**Purpose:** Clicks a link.

**Parameters:**
- `{string}` - Link name

---

### 25. `When('user refreshes {string} page', ...)` (Line 806)
**Purpose:** Refreshes page if "No information found" is displayed.

**Parameters:**
- `{string}` - Screen name

---

### 26. `When('user refreshes page', ...)` (Line 815)
**Purpose:** Refreshes the current page.

---

### 27. `When('user enters {string} in Employee Job Title field on T2T18 Determinations screen', ...)` (Line 825)
**Purpose:** Enters text in the Employee Job Title field.

**Parameters:**
- `{string}` - Text to enter

---

### 28. `When('delete Lawful Presence status row data', ...)` (Line 832)
**Purpose:** Deletes a Lawful Presence status row.

---

### 29. `When('save New Lawful Presence Status row data', ...)` (Line 838)
**Purpose:** Saves new Lawful Presence Status row data.

---

### 30. `When('User clicks on {string} link on Person Status screen', ...)` (Line 844)
**Purpose:** Clicks a link on Person Status screen.

**Parameters:**
- `{string}` - Page name

---

### 31. `When('clicks on {string} link with {string} instance', ...)` (Line 857)
**Purpose:** Clicks a link by instance (e.g., "Second").

**Parameters:**
- `{string}` - Link name
- `{string}` - Instance (e.g., "Second")

---

### 32. `When('user fills in birth proof and citizenship information', ...)` (Line 871)
**Purpose:** Checks for birth proof and citizenship information requirements.

---

### 33. `When('clicks on {string} Chevron link', ...)` (Line 881)
**Purpose:** Clicks a chevron link by matching text.

**Parameters:**
- `{string}` - Chevron link text

---

### 34. `When('verifies status of {string} chevron link and {string} text in textbox', ...)` (Line 891)
**Purpose:** Verifies chevron link status and textbox text.

**Parameters:**
- `{string}` - Element name
- `{string}` - Expected text

---

### 35. `When('User clicks on {string} link in Claim Development path', ...)` (Line 900)
**Purpose:** Clicks a link in the Claim Development navigation path.

**Parameters:**
- `{string}` - Page name (e.g., "Development Notes", "Person Statement", "Report of Contact")

---

### 36. `When('Select from Person Providing Statement', ...)` (Line 915)
**Purpose:** Selects from "Person Providing Statement" dropdown.

---

### 37. `When('click on save button on Person Statement screen', ...)` (Line 919)
**Purpose:** Clicks save button on Person Statement screen.

---

### 38. `When('Select Person Contacted on Report of Contact screen', ...)` (Line 924)
**Purpose:** Selects "Person Contacted" on Report of Contact screen.

---

### 39. `When('clicks on the Report of Contact OK button', ...)` (Line 930)
**Purpose:** Clicks OK button on Report of Contact screen.

---

### 40. `When('selects {string}', ...)` (Line 936)
**Purpose:** Selects various options/buttons (switch-based: Add Signature, Oral/Ink Signature, Affirmations, Save, Cancel, etc.).

**Parameters:**
- `{string}` - Option name (e.g., "Add Signature and Attestation", "Oral Signature Type", "Save", "Cancel")

---

### 41. `When('select Annuity from Civil Service Annuity Type Drop-down List', ...)` (Line 991)
**Purpose:** Selects "Annuity" from Civil Service Annuity Type dropdown.

---

### 42. `When('Select Spouse enrolled in SMI Check Box on HI screen', ...)` (Line 1047)
**Purpose:** Selects "Spouse enrolled in SMI" checkbox if not already selected.

---

### 43. `When('Select Consent obtained from spouse Check Box on HI screen', ...)` (Line 1053)
**Purpose:** Selects "Consent obtained from spouse" checkbox if not already selected.

---

### 44. `When('verify data from {string} webtable', ...)` (Line 1059)
**Purpose:** Verifies webtable data with enrollment calculation replacements (HI dates, SMI dates, surcharges, etc.).

**Parameters:**
- `{string}` - Table element ID
- DataTable - Expected table data

---

### 45. `When('clicks on {string} button from {string} popup window', ...)` (Line 1270)
**Purpose:** Clicks a button within a popup window.

**Parameters:**
- `{string}` - Button name
- `{string}` - Popup window element name

---

### 46. `When('verify {string} text is present in {string} popup window', ...)` (Line 1278)
**Purpose:** Verifies text is present in a popup window.

**Parameters:**
- `{string}` - Text to verify
- `{string}` - Popup window element name

---

### 47. `When('Click OK in popup window', ...)` (Line 1286)
**Purpose:** Accepts a browser alert/popup.

---

### 48. `When('verify {string} text is present in popup window', ...)` (Line 1290)
**Purpose:** Verifies text in a browser alert popup.

**Parameters:**
- `{string}` - Expected alert text

---

### 49. `When('navigate to GN 00204.010 Protective Filing link on Filing Date screen', ...)` (Line 1297)
**Purpose:** Navigates to Protective Filing link and verifies new window title.

---

### 50. `When('click on {string} button in a frame', ...)` (Line 1326)
**Purpose:** Clicks a button within an iframe.

**Parameters:**
- `{string}` - Button name

---

### 51. `When('click on {string} Radio button in a frame', ...)` (Line 1333)
**Purpose:** Clicks a radio button within an iframe.

**Parameters:**
- `{string}` - Radio button name

---

### 52. `When('click on {string} Checkbox in a frame', ...)` (Line 1340)
**Purpose:** Clicks a checkbox within an iframe.

**Parameters:**
- `{string}` - Checkbox name

---

### 53. `When('selects {string} from {string} Drop-down list in a frame', ...)` (Line 1349)
**Purpose:** Selects from a dropdown within an iframe.

**Parameters:**
- `{string}` - Option value
- `{string}` - Dropdown element name

---

### 54. `When('save Lawful Presence record', ...)` (Line 1358)
**Purpose:** Saves a Lawful Presence record.

---

### 55. `When('check if {string} text is present on the screen', ...)` (Line 1389)
**Purpose:** Checks if text is present on screen.

**Parameters:**
- `{string}` - Text to check

---

### 56. `When('select {string} from Report of Contact Relationship to Claimant Drop-down', ...)` (Line 1394)
**Purpose:** Selects from "Relationship to Claimant" dropdown.

**Parameters:**
- `{string}` - Option value

---

### 57. `When('clicks on Select All Address Types Checkbox', ...)` (Line 1470)
**Purpose:** Clicks "Select All" checkbox for address types.

---

### 58. `When('input {string} text in {string} textbox', ...)` (Line 1566)
**Purpose:** Inputs text in a textbox with date calculation support.

**Parameters:**
- `{string}` - Text input value
- `{string}` - Element name

---

### 59. `When('enters {string} for {string}', ...)` (Line 1598)
**Purpose:** Enters a value for an element (checkbox support).

**Parameters:**
- `{string}` - Value (e.g., "Yes")
- `{string}` - Element name

---

### 60. `When('switch to {string} tab', ...)` (Line 1605)
**Purpose:** Switches to a browser tab/window.

**Parameters:**
- `{string}` - Tab identifier

---

### 61. `When('click on {string} button on {string} screen', ...)` (Line 1623)
**Purpose:** Clicks a button on a specific screen (handles multiple buttons).

**Parameters:**
- `{string}` - Button name
- `{string}` - Screen name

---

### 62. `When('User clicks on T2 {string} screen link', ...)` (Line 1637)
**Purpose:** Clicks T2 screen links (Disability, Children, Foreign Coverage, etc.).

**Parameters:**
- `{string}` - Screen name (e.g., "Disability", "Children", "Foreign Coverage", "Voluntary Tax Withholding")

---

### 63. `When('check if Uninsured', ...)` (Line 1661)
**Purpose:** Checks if user is uninsured and selects appropriate radio button.

---

### 64. `When('click More Info link, and verify popup text', ...)` (Line 1675)
**Purpose:** Clicks "More Info" links and verifies popup content (alternative implementation).

**Parameters:**
- DataTable - Table with linkNumber, expectedTitle, and expectedText

---

### 65. `When('verify {string} is not on {string} screen', ...)` (Line 1710)
**Purpose:** Verifies an element is not present on a screen.

**Parameters:**
- `{string}` - Element name
- `{string}` - Screen name

---

## THEN Statements (Assertions/Verifications)

### 1. `Then('verify alerts displayed on the screen', ...)` (Line 637)
**Purpose:** Verifies alerts displayed on screen match expected values.

**Parameters:**
- DataTable - Expected alerts array

---

### 2. `Then('User switches to SSIWeb application', ...)` (Line 694)
**Purpose:** Switches to SSIWeb application window.

---

### 3. `Then('enters {string} text into textfield', ...)` (Line 984)
**Purpose:** Enters text into a textfield (SSN field).

**Parameters:**
- `{string}` - Text to enter

---

### 4. `Then('system generates notice messages with description {string}', ...)` (Line 998)
**Purpose:** Verifies system notice messages match expected description.

**Parameters:**
- `{string}` - Expected message (semicolon-separated for multiple)

---

### 5. `Then('User waits for {string} seconds', ...)` (Line 1016)
**Purpose:** Waits for specified seconds.

**Parameters:**
- `{string}` - Number of seconds

---

### 6. `Then('verify data from {string} webtable dates', ...)` (Line 1021)
**Purpose:** Verifies webtable data with date calculations.

**Parameters:**
- `{string}` - Table element ID
- DataTable - Expected table data with date formulas

---

### 7. `Then('Verify {string} PDF data generated from CCM', ...)` (Line 1152)
**Purpose:** Verifies PDF data matches expected content by comparing downloaded PDF with expected text file.

**Parameters:**
- `{string}` - Expected PDF file name

---

### 8. `Then('system generates notice warning message with description {string}', ...)` (Line 1185)
**Purpose:** Verifies notice warning message matches expected description.

**Parameters:**
- `{string}` - Expected warning message

---

### 9. `Then('system generates edit message with description {string}', ...)` (Line 1193)
**Purpose:** Verifies edit/error messages match expected description.

**Parameters:**
- `{string}` - Expected error message (semicolon-separated for multiple)

---

### 10. `Then('system generates edit message with description {string} on {string} model', ...)` (Line 1211)
**Purpose:** Verifies edit messages on a specific modal/model.

**Parameters:**
- `{string}` - Expected error message
- `{string}` - Modal/model ID

---

### 11. `Then('system generates error message with description {string} in a frame', ...)` (Line 1225)
**Purpose:** Verifies error messages in an iframe. Takes screenshot on failure.

**Parameters:**
- `{string}` - Expected error message

---

### 12. `Then('system generates error message with description {string} on Contact Info Manage Addresses screen', ...)` (Line 1257)
**Purpose:** Verifies error messages on Contact Info Manage Addresses screen.

**Parameters:**
- `{string}` - Expected error message (semicolon-separated for multiple)

---

### 13. `Then('delete current Citizen Information entry', ...)` (Line 1364)
**Purpose:** Deletes current Citizen Information entry.

---

### 14. `Then('verify {string} label is displayed below date field', ...)` (Line 1372)
**Purpose:** Verifies label is displayed below date field with current date.

**Parameters:**
- `{string}` - Element name

---

### 15. `Then('system generates notice message with description {string}', ...)` (Line 1478)
**Purpose:** Verifies system notice messages (alternative implementation).

**Parameters:**
- `{string}` - Expected message (semicolon-separated for multiple)

---

### 16. `Then('system generates exclusion message with description {string}', ...)` (Line 1489)
**Purpose:** Verifies exclusion message matches expected description.

**Parameters:**
- `{string}` - Expected exclusion message

---

### 17. `Then('enters {string} date in {string} textbox', ...)` (Line 1508)
**Purpose:** Enters a calculated date in a textbox (supports CURRENT_DATE +/- days/months).

**Parameters:**
- `{string}` - Date formula (e.g., "CURRENT_DATE + 15 DAYS", "CURRENT_DATE - 2 MONTHS")
- `{string}` - Element name

---

### 18. `Then('User switches to SSIWeb application', ...)` (Line 1613)
**Purpose:** Switches to SSIWeb application (alternative implementation with better window handling).

---

## Special Value Support

Many step definitions support special values for dynamic data:

- **`<CURRENT_DATE>`** - Current date in various formats
- **`<CURRENT_DATE + X DAYS>`** - Current date plus X days
- **`<CURRENT_DATE + X MONTHS>`** - Current date plus X months
- **`<DOB>`** - Date of birth (from enrollment calculation)
- **`<DOB + X DAYS>`** - Date of birth plus X days
- **`<blank>`** - Clears the field
- **`<Skip>`** - Skips dropdown selection
- **`500 characters`** - Generates random 500-character string
- **`501 characters`** - Generates random 501-character string

## Data Table Support

Several step definitions accept DataTable parameters for structured input:

- **Field/Value pairs** - Used for form inputs and verifications
- **Multiple rows** - Used for adding multiple records
- **Column headers** - Used for table verifications

## Notes

- All browser commands are properly awaited (required in WebdriverIO v9)
- Iframe handling is automatic for Person Info, Contact Info, and Marriage screens
- Date calculations support various formats (mm/dd/yyyy, mm/yyyy)
- Enrollment calculation variables are automatically populated when available

---

**File Location:** `e2e/stepdefinitions/web_actions_stepdefs.ts`

**Last Updated:** WebdriverIO v9 Migration

