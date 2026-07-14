Feature: Web Actions Step Verification

  Verifies the new presence/link/dropdown/checkbox/button/radio verification
  steps against e2e/support/sample-form.html (served locally by wdio.conf.ts).

  @smoke
  Scenario: Generic element presence
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "Page Heading" is present on the screen
    When verify "Definitely Fake Element Xyz" is not present on the screen

  @smoke
  Scenario: Link presence, href, and redirect
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "Help" link is present on the screen
    When verify "Definitely Fake Link Xyz" link is not present on the screen
    When verify "Help" link points to "#help"
    When verify "Help" link redirects to "#help"

  @smoke
  Scenario: Dropdown option presence
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "North" is present in "Region" Drop-down list
    When verify "Definitely Fake Option Xyz" is not present in "Region" Drop-down list

  @smoke
  Scenario: Checkbox checked state
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "Agree" Checkbox is not checked
    Given select "Agree" Checkbox
    When verify "Agree" Checkbox is checked

  @smoke
  Scenario: Enabled and disabled fields
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "Submit" is enabled
    When verify "Locked Field" is disabled

  @smoke
  Scenario: Button presence
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "Submit" button is present on the screen
    When verify "Definitely Fake Button Xyz" button is not present on the screen

  @smoke
  Scenario: Radio button presence and selected state
    Given User navigates to "http://127.0.0.1:5500/e2e/support/sample-form.html" URL
    And User is on "Sample Form" screen
    When verify "active" Radio button is present on the screen
    When verify "Definitely Fake Radio Xyz" Radio button is not present on the screen
    When verify "active" Radio button is not selected
    When clicks on "active" Radio button
    When verify "active" Radio button is selected
