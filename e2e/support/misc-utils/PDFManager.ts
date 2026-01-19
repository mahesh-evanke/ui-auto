const fs = require('fs');
const path = require('path');
const underscore = require('underscore');
const pdf = require("pdf-extraction");
const e2eConfig = require('js-yaml').load(fs.readFileSync('e2e/config/config.yaml','utf8'));
export class PDFManager {

    private medicalEnrolmentKey: string = "{MEDICAL_ENROLMENT}";
    private medicalEnrolmentValue: string = "";
    private enrolledinGHPKey: string = "{ENROLLED_IN_GHP}";
    private enrolledinGHPValue: string = "";
    private medicadeSKey: string = "{MEDICAID_ES}";
    private medicadeSValue: string = "";
    private dateKey: string = "{DATE}";
    private dateValue: string = "";
    private dobKey: string = "{DOB}";
    private dobValue: string = "";
    private bncKey: string = "{BNC}";
    private bncValue: string = "";
    private nameKey: string = "{NAME}";
    private nameValue: string = "";
    private streetKey: string = "{STREET}";
    private streetValue: string = "";
    private cityKey: string = "{CITY}";
    private cityValue: string = "";
    private ssnKey: string = "{SSN}";
    private ssnValue: string = "";
    private statementPersonKey: string = "{STATEMENT_PERSON}";
    private statementPersonValue: string = "";
    private relationshipKey: string = "{RELATIONSHIP}";
    private relationshipValue: string = "";
    private marriedToKey: string = "{MARRIED_TO}";
    private marriedToValue: string = "";
    private marriageDateKey: string = "{MARRIAGE_DATE}";
    private marriageDateValue: string = "";
    private marriageCityKey: string = "{MARRIAGE_CITY}";
    private marriageCityValue: string = "";
    private signatureDateKey: string = "{SIGNATURE_DATE}";
    private signatureDateValue: string = "";
    private residentAddressKey: string = "{RESIDENT_ADDRESS}";
    private residentAddressValue: string = "";
    private mailAddressKey: string = "{MAIL_ADDRESS}";
    private mailAddressValue: string = "";
    private phoneNumberKey: string = "{PHONE_NUMBER}";
    private phoneNumberValue: string = "";
    private birthPlaceKey: string = "{BIRTH_PLACE}";
    private birthPlaceValue: string = "";
    private USCitizenKey: string = "{USCitizen}";
    private USCitizenValue: string = "";
    private expectedText: string = "";
    private actualPDF: string = "";
    public setMedicalEnrolment(medicalEnrolment: string) {
        if (medicalEnrolment == "R") {
            this.medicalEnrolmentValue = "No";
        } else {
            this.medicalEnrolmentValue = "Yes";
        }
    }

    public setEnrolledinGHP(enrolledinGHP: string) {
        this.enrolledinGHPValue = enrolledinGHP;
    }
    public setMedicadeS(medicadeS: Date) {

        if (isNaN(medicadeS.getTime())) {
            this.medicadeSValue = "No";
        } else {
            this.medicadeSValue = "Yes";
        }
    }
    public setUSCitizen(USCitizen: string) {
        this.USCitizenValue = USCitizen;
    }
    public setResidentAddress(residentAddress: string) {
        this.residentAddressValue = residentAddress;
    }
    public setMailAddres(mailAddress: string) {
        this.mailAddressValue = mailAddress;
    }
    public setPhoneNumber(phoneNumber: string) {
        this.phoneNumberValue = phoneNumber;
    }
    public setBirthPlace(birthPlace: string) {
        this.birthPlaceValue = birthPlace;
    }

    public setDate(date: string) {
        this.dateValue = date;
    }
    public setDob(dob: string) {
        this.dobValue = dob;
    }
    public setBNC(bnc: string) {
        this.bncValue = bnc;
    }
    public setName(name: string) {
        this.nameValue = name;
    }
    public setStreet(street: string) {
        this.streetValue = street;
    }
    public setCity(city: string) {
        this.cityValue = city;
    }
    public setSSN(ssn: string) {
        this.ssnValue = ssn;
    }
    public setStatementPerson(statementPerson: string) {
        this.statementPersonValue = statementPerson;
    }
    public setRelationship(relationship: string) {
        this.relationshipValue = relationship;
    }

    public setMarriedTo(marriedTo: string) {
        this.marriedToValue = marriedTo;
    }
    public setMarriageDate(marriageDate: string) {
        this.marriageDateValue = marriageDate;
    }
    public setMarriageCity(marriageCity: string) {
        this.marriageCityValue = marriageCity;
    }
    public setSignatureDate(signatureDate: string) {
        this.signatureDateValue = signatureDate;
    }
    private replaceAllValue(input: string): string {
        input = this.replaceWithValue(input, "{SKIP_COMPARISON_LINE}", "");
        input = this.replaceWithValue(input, this.residentAddressKey, this.residentAddressValue);
        input = this.replaceWithValue(input, this.mailAddressKey, this.mailAddressValue);
        input = this.replaceWithValue(input, this.phoneNumberKey, this.phoneNumberValue);
        input = this.replaceWithValue(input, this.birthPlaceKey, this.birthPlaceValue);
        input = this.replaceWithValue(input, this.dateKey, this.dateValue);
        input = this.replaceWithValue(input, this.dobKey, this.dobValue);
        input = this.replaceWithValue(input, this.bncKey, this.bncValue);
        input = this.replaceWithValue(input, this.nameKey, this.nameValue);
        input = this.replaceWithValue(input, this.streetKey, this.streetValue);
        input = this.replaceWithValue(input, this.cityKey, this.cityValue);
        input = this.replaceWithValue(input, this.ssnKey, this.ssnValue);
        input = this.replaceWithValue(input, this.statementPersonKey, this.statementPersonValue);
        input = this.replaceWithValue(input, this.relationshipKey, this.relationshipValue);
        input = this.replaceWithValue(input, this.marriedToKey, this.marriedToValue);
        input = this.replaceWithValue(input, this.marriageDateKey, this.marriageDateValue);
        input = this.replaceWithValue(input, this.marriageCityKey, this.marriageCityValue);
        input = this.replaceWithValue(input, this.signatureDateKey, this.signatureDateValue);
        input = this.replaceWithValue(input, this.USCitizenKey, this.USCitizenValue);

        input = this.replaceWithValue(input, this.medicalEnrolmentKey, this.medicalEnrolmentValue);
        input = this.replaceWithValue(input, this.enrolledinGHPKey, this.enrolledinGHPValue);
        input = this.replaceWithValue(input, this.medicadeSKey, this.medicadeSValue);
        return input;
    }

    public async compareTwoFile(expectedFilePath: string, actualFilePath: string): Promise<boolean> {
        this.expectedText = fs.readFileSync(expectedFilePath, 'utf8');
        this.actualPDF = await this.getPDFContent(actualFilePath);
        this.skipComarisonLine(this.expectedText, this.actualPDF);

        this.expectedText = this.replaceAllValue(this.expectedText);
        let twoStringSame: boolean = this.compareTeoText(this.expectedText, this.actualPDF);
        return twoStringSame;
    }

    public getMostRecentDownloadedFile(): string {
        var downloadFolder = process.env.USERPROFILE + "\\Downloads";
        return downloadFolder + "\\" + this.getMostRecentFileName(downloadFolder);
    }
    public getTextFilePath(fileName: string) {
        return e2eConfig.testDataDir+"PDF_Verification_Templates/" + fileName + ".txt";
    }

    private async getPDFContent(path: string): Promise<string> {
        let dataBuffer = fs.readFileSync(path);
        let pdfText = await pdf(dataBuffer).then(function (data: any) {
            return data.text
        });
        return pdfText;
    }

    private removeSepecial(input: string): string | undefined {
        if (input == undefined) return undefined;
        let regex = /(\r\n|\n|\r|\\n|\\r| )/g;
        let regex2 = /[^a-zA-Z0-9]/g;
        return input.replace(regex, "").replace(regex2, "");
    }

    private replaceWithValue(input: string, key: string, value: string): string {
        const searchRegExp = new RegExp(key, 'g');
        return input.replace(searchRegExp, value);
    }

    private getMostRecentFileName(dir: string) {
        var files = fs.readdirSync(dir);
        return underscore.max(files, function (f: string) {
            var fullpath = path.join(dir, f);
            return fs.statSync(fullpath).ctime;
        });
    }

    private compareTeoText(expected: string, actual: string): boolean {
        let expectedList: string[] = expected.split(/\r?\n/);
        let expectedText = '';
        expectedList.forEach(eachline => { expectedText = expectedText + this.removeSepecial(eachline); });

        let actualList: string[] = actual.split(/\r?\n/);
        let actualText = '';
        actualList.forEach(eachline => { actualText = actualText + this.removeSepecial(eachline); });
        if (actualText != expectedText) {
            console.log("Expected: " + expectedText);
            console.log("Actual: " + actualText);
        }
        return actualText == expectedText;
    }
    private compareTwoLIneText(expected: string, actual: string): boolean {
        let twoStringSame: boolean = true;
        let expectedList: string[] = expected.split(/\r?\n/);
        let actualList: string[] = actual.split(/\r?\n/);
        const sizeEx: number = expectedList.length;
        const sizeAct: number = actualList.length;
        if (sizeEx != sizeAct) {
            console.log("size of expected is " + sizeEx + ", and size of actual is " + sizeAct);
        }
        const bigLen: number = (sizeAct > sizeEx) ? sizeAct : sizeEx;
        const smallen = (sizeAct > sizeEx) ? sizeEx : sizeAct;
        for (let index = 0; index < smallen; index++) {
            if (this.removeSepecial(expectedList[index]) != this.removeSepecial(actualList[index])) {
                console.log("at postion " + (index + 1) + " is mismatch.");
                console.log("expected: " + expectedList[index]);
                console.log("actual: " + actualList[index]);
                twoStringSame = false;
                throw new Error("at line " + (index + 1) + ", expected: " + expectedList[index] + ", actual: " + actualList[index]);
            }
        }
        for (let index = smallen; index < bigLen; index++) {
            let value: string | undefined = (expectedList[index]) ? expectedList[index] : actualList[index];
            value = this.removeSepecial(value);
            if (value != undefined && value.length > 0) {
                console.log("at line " + (index + 1) + " is mismatch.");
                let expectedText = (expectedList[index]) ? expectedList[index] : "empty";
                console.log("expected: " + expectedText);
                let actualText = (actualList[index]) ? actualList[index] : "empty";
                console.log("actual: " + actualText);
                twoStringSame = false;
                throw new Error("at line " + (index + 1) + ", expected: " + expectedText + ", actual: " + actualText);
            }
        }
        return twoStringSame;
    }

    private skipComarisonLine(expected: string, actual: string) {
        let lines: number[] = [];
        let expectedList: string[] = expected.split(/\r?\n/);
        let actualList: string[] = actual.split(/\r?\n/);
        for (let i: number = 0; i < actualList.length; i++) {
            if (actualList[i].includes("Lawfully present in the U.S")) {
                actualList[i] = "";
                break;
            }
        }
        actualList = actualList.map(s => s.trim());
        actualList = actualList.filter(value => value != null && value.length > 0);
        expectedList = expectedList.map(s => s.trim());
        expectedList = expectedList.filter(value => value != null && value.length > 0);
        let lineNum: number = 0;
        expectedList.forEach(eachline => {
            if (eachline.includes("{SKIP_COMPARISON_LINE}")) {
                lines.push(lineNum);
            }
            if (eachline.includes("{CITY}") && actualList[lineNum]) {
                actualList[lineNum] = actualList[lineNum].split('-')[0].toUpperCase().trim();
            }
            lineNum++;
        });

        lines.forEach(lineN => {
            actualList[lineN] = "";
            expectedList[lineN] = "";
        })
        this.actualPDF = actualList.join("\n");
        this.expectedText = expectedList.join("\n");
    }
}
