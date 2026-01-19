export class PageVariables {
    private name: string;
    private ssn: string;
    private residentAddress: string;
    private mailAddress: string;
    private phoneNumber: string;
    private birthPlace: string;
    private _citizenship: string;
    public get citizenship(): string {
        return this._citizenship;
    }
    public set citizenship(value: string) {
        this._citizenship = value;
    }
    public set setBirthPlace(birthPlace: string) {
        this.birthPlace = birthPlace;
    }

    public get getBirthPlace() {
        return this.birthPlace;
    }
    public set setPhoneNumber(phoneNumber: string) {
        this.phoneNumber = phoneNumber;
    }

    public get getPhoneNumber() {
        return this.phoneNumber;
    }

    public set setResidentAddress(residentAddress: string) {
        this.residentAddress = residentAddress;
    }

    public get getResidentAddress() {
        return this.residentAddress;
    }

    public set setMailAddress(mailAddress: string) {
        this.mailAddress = mailAddress;
    }

    public get getMailAddress() {
        return this.mailAddress;
    }
    public set setName(name: string) {
        this.name = name;
    }

    public get getName() {
        return this.name;
    }

    public set setSSN(ssn: string) {
        this.ssn = ssn;
    }
    public get getSSN() {
        return this.ssn;
    }

}
