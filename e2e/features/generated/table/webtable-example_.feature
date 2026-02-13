Feature: webtable-example_

  @smoke
  Scenario: Interact with captured elements
    Given User navigates to "https://www.dezlearn.com/webtable-example/" URL
    And User is on "generated/table/webtable-example_" screen

    When verify data from "ProductTable" web table
      | Name | Email |
      | Tim Watson | tim@dezlearn.com |
      | Mayur Deshmukh | mayur@dezlearn.com |
      | John White | john@dezlearn.com |
