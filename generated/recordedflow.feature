Feature: Auto Generated Test

  Scenario: User flow

    Given User navigates to "https://the-internet.herokuapp.com/" URL
    Given User is on "recordedflow" screen

    Given User sends GET request to "https://the-internet.herokuapp.com/"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/js/vendor/298279967.js"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/css/app.css"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/css/font-awesome.css"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/js/vendor/jquery-1.11.3.min.js"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/js/vendor/jquery-ui-1.11.4/jquery-ui.js"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/js/foundation/foundation.js"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/js/foundation/foundation.alerts.js"
    Then User expects status code 200
    Given User sends GET request to "https://the-internet.herokuapp.com/img/forkme_right_green_007200.png"
    Then User expects status code 200
