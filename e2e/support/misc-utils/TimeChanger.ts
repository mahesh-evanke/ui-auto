import { DataTable } from '@wdio/cucumber-framework';
import * as moment from 'moment';
export class TimeChanger {

    private addYear: number = 0;
    private addMonth: number = 0;
    private addDate: number = 0;
    private setDate: number = 0;
    private dateTime: Date = new Date();
    private baseTime: BaseTimetype;

    constructor(time: Date, value: string) {
        value = value.toUpperCase();
        value.split(',').forEach(eachElem => {
            if (eachElem.includes("DOB")) {
                this.dateTime = time;
                this.baseTime = BaseTimetype.DOB;
            } else if (eachElem.includes("CURRENT_DATE")) {
                this.dateTime = new Date();
                this.baseTime = BaseTimetype.CURRENT_DATE;
            } else if (eachElem.endsWith("Y")) {
                this.addYear = this.getNumberFromString(eachElem);
            } else if (eachElem.endsWith("M")) {
                this.addMonth = this.getNumberFromString(eachElem);
            } else if (eachElem.endsWith("D")) {
                this.addDate = this.getNumberFromString(eachElem);
            } else if (eachElem.endsWith("S")) {
                this.setDate = this.getNumberFromString(eachElem);
            }
        }
        );
    }

    public static formatDateTime(dateTime: Date, format: string): string {
        return moment(dateTime).format(format);
    }

    public static getActualTime(timeFormula: string, date: Date, timeFormat = "MM/DD/yyyy"): string {
        if (timeFormula == "<FRA>") {
            timeFormula = this.getRFA(date);
        }
        let actualTimeFormula = timeFormula.substring(timeFormula.lastIndexOf("<") + 1, timeFormula.lastIndexOf(">"));
        if (actualTimeFormula.length > 2) {

            let timeChanger: TimeChanger = new TimeChanger(date, actualTimeFormula);
            return timeChanger.getDateString(timeFormat);
        } else {
            return timeFormula;
        }
    }

    public static changeToAcutalTime(table: DataTable, key: string, row: number, columns: number, time: Date, timeFormat: string = "MM/DD/yyyy"): DataTable {

        if (table && table.raw() && table.raw()[row] && table.raw()[row][columns] && table.raw()[row][0] == key) {
            table.raw()[row][columns] = this.getActualTime(table.raw()[row][columns], time, timeFormat);
        }
        return table;
    }

    private static getRFA(date: Date): string {
        date.setDate(date.getDate() - 1);
        let fullYear: number = date.getFullYear();
        date.setDate(date.getDate() + 1);
        let ageYear: number = 65;
        let ageMonth: number = 0;
        if (fullYear >= 1943 && fullYear < 1960) {
            ageYear = 66;
        } else if (fullYear >= 1960) {
            ageYear = 67;
        }

        switch (fullYear) {
            case (1938):
            case (1955):
                ageMonth = 2;
                break;
            case (1939):
            case (1956):
                ageMonth = 4;
                break;
            case (1940):
            case (1957):
                ageMonth = 6;
                break;
            case (1941):
            case (1958):
                ageMonth = 8;
                break;
            case (1942):
            case (1959):
                ageMonth = 10;
                break;

            default:
                console.log('invalid numbers');
        }
        return "<DOB," + ageYear + "Y," + ageMonth + "M,01S>";
    }

    public getDateString(format: string): string {
        const date: Date = this.getDate();
        return moment(date).format(format);
    }
    public getDate(): Date {
        let newDateTime: Date = new Date();
        let newYears: number = this.dateTime.getFullYear() + this.addYear;
        let newMonth: number = this.dateTime.getMonth() + this.addMonth;
        let newDate: number = (this.setDate == 0) ? this.dateTime.getDate() + this.addDate : this.setDate;
        newDateTime.setFullYear(newYears);
        newDateTime.setMonth(newMonth);
        newDateTime.setDate(newDate);
        return newDateTime;
    }

    private getNumberFromString(input: string): number {
        return Number.parseInt(input.replace(/[^0-9]-/gi, ''));
    }
}

enum BaseTimetype {
    DOB,
    CURRENT_DATE,
    FRA
}
