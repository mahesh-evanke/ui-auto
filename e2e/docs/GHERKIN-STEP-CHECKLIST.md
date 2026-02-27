---
title: Gherkin step-definition checklist
description: Checklist for verifying Gherkin step definitions from stepdefinitions/web and stepdefinitions/db.
---
# Gherkin step-definition checklist

Check off each step when you have verified it works. Source: `e2e/stepdefinitions/web/web.steps.ts`.

---

## Given

- [X] `Given enters {string} text in {string} textbox`
- [X] `Given User is on {string} screen`
- [X] `Given select {string} Checkbox`
- [ ] `Given select {string} Checkbox with Wait`
- [X] `Given User inputs information on {string} screen with following params`
- [X] `Given User inputs information on {string} screen with following parameters`
- [X] `Given User navigates to {string} URL`
- [ ] `Given select Claims Summary Checkbox`
- [ ] `Given clicks on Claims Summary button`
- [ ] `Given closes the application -> which exists only in Appium, not in Chrome`
- [ ] `Given enters {string} text in {string} textbox in a frame`
- [ ] `Given User is on {string} CCE screen`

---

## When

- [ ] `When User are on scenare title {string}`
- [ ] `When Verify field {string} text is {string}`
- [ ] `When click More Info link, and verfiy popup text`
- [ ] `When click page link and verify new pages opens with title`
- [ ] `When User selects {string} link on Person Status screen`
- [ ] `When User inputs information on the {string} screen if exist`
- [ ] `When User inputs information on the {string} screen`
- [ ] `When User verify information on {string} screen with following params`
- [ ] `When User verifies field entries on the Payment Method`
- [ ] `When User verifies field entries on the {string} screen in query mode`
- [ ] `When enters SSN with criteria {string} in {string} textbox`
- [ ] `When User clicks on {string} button`
- [X] `When clicks on {string} button`
- [ ] `When selects {string} text from {string} Drop-down list`
- [X] `When selects {string} from {string} Drop-down list`
- [ ] `When verify {string} text is present on the screen`
- [X] `When clicks on {string} Radio button`
- [X] `When verify data from {string} web table`
- [ ] `When User verifies information on {string} screen header with following parameters` (2 definitions)
- [ ] `When User verify information on {string} screen header with following parameters`
- [X] `When verify information from {string} webtable`
- [ ] `When clicks on {string} link`
- [ ] `When user refreshes {string} page`
- [X] `When user refreshes page`
- [ ] `When user enters {string} in Employee Job Title field on T2T18 Determinations screen`
- [ ] `When delete Lawful Presence status row data`
- [ ] `When save New Lawful Presence Status row data`
- [ ] `When User clicks on {string} link on Person Status screen`
- [ ] `When clicks on {string} link with {string} instance`
- [ ] `When user fills in birth proof and citizenship information`
- [ ] `When clicks on {string} Chevron link`
- [ ] `When verifies status of {string} chevron link and {string} text in textbox`
- [ ] `When User clicks on {string} link in Claim Development path`
- [ ] `When Select from Person Providing Statement`
- [ ] `When click on save button on Person Statement screen`
- [ ] `When Select Person Contacted on Report of Contact screen`
- [ ] `When clicks on the Report of Contact OK button`
- [ ] `When selects {string}`
- [ ] `When select Annuity from Civil Service Annuity Type Drop-down List`
- [ ] `When Select Spouse enrolled in SMI Check Box on HI screen`
- [ ] `When Select Consent obtained from spouse Check Box on HI screen`
- [ ] `When verify data from {string} webtable`
- [ ] `When clicks on {string} button from {string} popup window`
- [ ] `When verify {string} text is present in {string} popup window`
- [ ] `When Click OK in popup window`
- [ ] `When verify {string} text is present in popup window`
- [ ] `When navigate to GN 00204.010 Protective Filing link on Filing Date screen`
- [ ] `When click on {string} button in a frame`
- [ ] `When click on {string} Radio button in a frame`
- [ ] `When click on {string} Checkbox in a frame`
- [ ] `When selects {string} from {string} Drop-down list in a frame`
- [ ] `When save Lawful Presence record`
- [ ] `When check if {string} text is present on the screen`
- [ ] `When select {string} from Report of Contact Relationship to Claimant Drop-down`
- [ ] `When clicks on Select All Address Types Checkbox`
- [X] `When input {string} text in {string} textbox`
- [ ] `When enters {string} for {string}`
- [ ] `When switch to {string} tab`
- [ ] `When click on {string} button on {string} screen`
- [ ] `When User clicks on T2 {string} screen link`
- [ ] `When check if Uninsured`
- [ ] `When click More Info link, and verify popup text`
- [ ] `When verify {string} is not on {string} screen`

---

## Then

- [ ] `Then verify alerts displayed on the screen`
- [ ] `Then User switches to SSIWeb application`
- [ ] `Then enters {string} text into textfield`
- [ ] `Then system generates notice messages with description {string}`
- [ ] `Then User waits for {string} seconds`
- [ ] `Then verify data from {string} webtable dates`
- [ ] `Then Verify {string} PDF data generated from CCM`
- [ ] `Then system generates notice warning message with description {string}`
- [ ] `Then system generates edit message with description {string}`
- [ ] `Then system generates edit message with description {string} on {string} model`
- [ ] `Then system generates error message with description {string} in a frame`
- [ ] `Then system generates error message with description {string} on Contact Info Manage Addresses screen`
- [ ] `Then delete current Citizen Information entry`
- [ ] `Then verify {string} label is displayed below date field`
- [ ] `Then system generates notice message with description {string}`
- [ ] `Then system generates exclusion message with description {string}`
- [ ] `Then enters {string} date in {string} textbox`
- [ ] `Then User switches to SSIWeb application` (duplicate definition at line 1636)

---

## Given (database)

Source: `e2e/stepdefinitions/db/database.steps.ts`. Use when providing credentials in Gherkin (pgsql or sqlite).

- [X] `Given the database connection:` (table: for pgsql: type | host | port | user | password | database; for sqlite: type | path)

---

## Then (database – basic SQL verification)

Source: `e2e/stepdefinitions/db/database.steps.ts`. Use after Given with credentials, or with `db` in config (sqlite).

- [X] `Then the database table "{table}" should have at least N row(s)`
- [X] `Then the database table "{table}" should have at most N row(s)`
- [ ] `Then the database table "{table}" should have exactly N row(s)`
- [X] `Then the database table "{table}" should have row where column "{col}" equals "{value}"`
- [X] `Then the database table "{table}" should contain value "{value}" in column "{col}"`
- [X] `Then the database table "{table}" should have no rows where column "{col}" equals "{value}"`

---

## How to use

1. Run a scenario or feature that uses the step.
2. If the step runs without error and the outcome is correct, check the box: `- [x]`.
3. If it fails or behaves wrongly, leave unchecked and note the issue (e.g. in a comment or separate log).

*Last generated from `stepdefinitions/web/web.steps.ts` step definitions.*
