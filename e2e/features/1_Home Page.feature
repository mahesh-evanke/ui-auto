Feature: Verify functionality on home page

@WebUI @page-test @homepage @Completed  @exec-cas
#HOMEPAGE01
Scenario Outline:  Verify edits on CCE home page with <Scenario_Title>
    Given User navigates to "Home Page" screen to Establish New Medicare claim
    And User is on "Home Page" screen
    And enters <Officecode> text in "Office Code" textbox
    And enters <Claim> text in "Claim" textbox
    When User clicks on "Next" button
    Then system generates edit message with description <Error_Message_Text>
    And User is on "Home Page" screen
    Examples:
        | Scenario_Title                | Officecode | Claim          | Error_Message_Text                                                                       |
        | blank Claim field input         | "L8A"      | "<blank>"    | "Error: Claim is required"                                                                 |
        | invalid Claim field input 1     | "PC8"      | "123456789"  | "Error: Claim is invalid"                                                                  |
        | invalid Claim field input 2     | "h05"      | "101010101"  | "Error: Claim is invalid"                                                                  |
        | inpur 8 digit Claim field input | "273"      | "30502520"   | "Error: Claim is invalid"                                                                  |
        | restricted record             | "X21"      | "512121495"  | "Error: The Claim you entered is a restricted record. Have your manager call 410-965-8006" |
        | blank offoce code             | "<blank>"  | "277705706 " | "Error: Office Code is required"                                                         |
        | invalid office code 1         | "Q00"      | "477903409"  | "Error: Office Code is invalid"                                                          |
        | invalid office code 2         | "SDF"      | "305783306"  | "Error: Office Code is invalid"                                                          |
        | blank officecode and Claim      | "<blank>"  | "<blank>"    | "Error: Office Code is required; Error: Claim is required"                                 |
        | Scenario 01                   | "L8A"      | "512121495"  | "Error: The Claim you entered is a restricted record. Have your manager call 410-965-8006" |
        | Scenario 02                   | "L8A"      | "000-00-0000"| "Error: Claim is invalid"                                                                  |


