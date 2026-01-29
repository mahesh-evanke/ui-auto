@booking @update
Feature: UpdateBooking - Update an existing booking

  As a client of the Restful Booker API
  I want to update an existing booking
  So that I can change reservation details

  Scenario: Successfully update an existing booking with valid data
    Given User sends GET request to "https://restful-booker.herokuapp.com/booking/1957"
    And User has a valid auth token from "https://restful-booker.herokuapp.com/auth" with body:
      | path     | value          |
      | username | "admin"        |
      | password | "password123"  |
    When User sends PUT request to "https://restful-booker.herokuapp.com/booking/1957" with body:
      | path                     | value        |
      | firstname                | "James"      |
      | lastname                 | "Brown"      |
      | totalprice               | 0            |
      | depositpaid              | true         |
      | bookingdates.checkin     | "2018-01-01" |
      | bookingdates.checkout    | "2019-01-01" |
      | additionalneeds          | "Breakfast"  |
    Then User expects status code 200
    Then User validates response has fields:
      | path            | value       |
      | firstname       | "James"     |
      | lastname        | "Brown"     |
      | totalprice      | 0           |
      | depositpaid     | true        |
      | bookingdates.checkin | "2018-01-01" |
      | bookingdates.checkout| "2019-01-01" |
      | additionalneeds      | "Breakfast" |

