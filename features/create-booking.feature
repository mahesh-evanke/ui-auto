@booking @create
Feature: CreateBooking - Create a new booking

  As a client of the Restful Booker API
  I want to create a new booking
  So that I can manage reservations via the API

  Scenario: Successfully create a new booking with valid data
    Given User sends POST request to "https://restful-booker.herokuapp.com/booking" with body:
      | path                          | value          |
      | firstname                     | "James"        |
      | lastname                      | "Brown"        |
      | totalprice                    | 111            |
      | depositpaid                   | true           |
      | bookingdates.checkin          | "2018-01-01"   |
      | bookingdates.checkout         | "2019-01-01"   |
      | additionalneeds              | "Breakfast"    |
    Then User expects status code 200
    Then User validates response has bookingid
    Then User validates response has fields:
      | path                              | value          |
      | booking.firstname                 | "James"        |
      | booking.lastname                  | "Brown"        |
      | booking.totalprice                | 111            |
      | booking.depositpaid               | true           |
      | booking.bookingdates.checkin      | "2018-01-01"   |
      | booking.bookingdates.checkout    | "2019-01-01"   |
      | booking.additionalneeds          | "Breakfast"    |

