import { PageConfigHelper } from '../../support/misc-utils/PageHelper';
export class EnrollCalcInput {
    private static _dob: Date;
    deemedDOB: Date = new Date("");
    private _filingDate: Date;
    private _firstMonthInsured: Date;
    enrolledinGHP: string = "No";
    firstmonthGHP: Date = new Date("");
    lastmonthGHP: Date = new Date("");
    processDate: Date = new Date();
    userChoseSMIStMonth: Date = new Date("");
    smiRefusalInd: string = "";
    smiEnrollUSCrime: string = "";
    nonEquReliefStMonth: Date = new Date("");
    equitableReliefStCode: string = "";
    medicadeStDate: Date = new Date("");
    csaAnnuity: string = "N";
    GHPPlanType: string = "";

    dateFormat(convtdt: string | number | Date) {
        var olddate = new Date(convtdt);
        var d = olddate.getDate(); var m = olddate.getMonth() + 1; var y = olddate.getFullYear();
        var newdate: string | number | Date;
        if (m <= 9 && d <= 9) { newdate = (('0' + m) + '/' + ('0' + d) + '/' + y); }
        else if (m <= 9) { newdate = (('0' + m) + '/' + d + '/' + y); }
        else if (d <= 9) { newdate = (m + '/' + ('0' + d) + '/' + y); }
        else { newdate = convtdt; }
        return newdate;
    }

    public get dob() {
        return EnrollCalcInput._dob;
    }

    public get filingDate() {
        return this._filingDate;
    }

    public get firstMonthInsured() {
        return this._firstMonthInsured;
    }

    public set dob(theDOB: string | Date) {
        EnrollCalcInput._dob = new Date(this.dateFormat(theDOB));
    }
    public set filingDate(theFlDt: string | Date) {
        this._filingDate = new Date(this.dateFormat(theFlDt));
    }
    public set firstMonthInsured(theFtInsDt: string | Date) {
        this._firstMonthInsured = new Date(this.dateFormat(theFtInsDt));
    }

    public async setVariableValues() {
        let smiEnrolment = await (await PageConfigHelper.findElement("SMIEnrollmentOptions", false)).getValue();
        if (smiEnrolment.trim() == "Refuse") {
            this.smiRefusalInd = "R";
        }
        else if(smiEnrolment.trim() == "Enroll"){
            let deemedDOBCheckBox: boolean = await (await PageConfigHelper.findElement("check_DeemedEnroll", false)).isSelected();
            if (deemedDOBCheckBox) {
                let deemedDOBInput = await (await PageConfigHelper.findElement("IEPDate", false)).getValue();
                this.deemedDOB = new Date(deemedDOBInput);
            }

            let firstmonthGHPCheckBox = await PageConfigHelper.findElement("GroupHealthPlanYesINput", false);
            if (await firstmonthGHPCheckBox.isSelected()) {
                this.enrolledinGHP = "Yes";
                this.GHPPlanType = await (await PageConfigHelper.findElement("plantypeGHP", false)).getText();
                let firstmonthValue = await (await PageConfigHelper.findElement("firstmonthGHPL", false)).getText();
                this.firstmonthGHP = new Date(firstmonthValue.trim().replace("/", "/1/"));

                let lastmonthGHPText = await (await PageConfigHelper.findElement("lastmonthGHP", false)).getText();
                if (lastmonthGHPText.trim() != "Continuing") {
                    this.lastmonthGHP = new Date(lastmonthGHPText.trim().replace("/", "/1/"));
                }
                let partBStartMonth = "";
                let MedicarePartBStart = await (await PageConfigHelper.findElement("MedicarePartBStart", false)).getTagName();
                if (MedicarePartBStart == 'label') {
                    partBStartMonth = await (await PageConfigHelper.findElement("SMIStartMonth", false)).getValue();
                } else {
                    partBStartMonth = await (await PageConfigHelper.findElement("SMIStartMonthText", false)).getText();
                }
                this.userChoseSMIStMonth = new Date(partBStartMonth.trim().replace("/", "/1/"));
            }

            let smiEnrollUSCrimeBool: boolean = await (await PageConfigHelper.findElement("ClaimantConvicted", false)).isSelected();
            if (smiEnrollUSCrimeBool) {
                this.smiEnrollUSCrime = "D";
            }

            let nonEquReliefStMonthCheckBox: boolean = await (await PageConfigHelper.findElement("check_PossibleMisInfo", false)).isSelected();
            if (nonEquReliefStMonthCheckBox) {
                let nonEquReliefStMonthInput = await (await PageConfigHelper.findElement("DateofError", false)).getValue();
                this.nonEquReliefStMonth = new Date(nonEquReliefStMonthInput.trim().replace("/", "/1/"));

                let equitableReliefStCodeBool: boolean = await (await PageConfigHelper.findElement("EquitableReliefGrant", false)).isSelected();
                if (equitableReliefStCodeBool) {
                    this.equitableReliefStCode = "G";
                }
                else { this.equitableReliefStCode = "W"; }
            }

            let recieveMedicade = await PageConfigHelper.findElement("ReceivingMedicaidYes", false);
            if (await recieveMedicade.isSelected()) {
                let medicadeStartDtvalue = await (await PageConfigHelper.findElement("MedicaidStartDate", false)).getText();
                this.medicadeStDate = new Date(medicadeStartDtvalue.trim().replace("/", "/1/"));
            }

            let applincantCSAannuity = await PageConfigHelper.findElement("ReceivingAnnuityYes", false);
            if (await applincantCSAannuity.isSelected())
                this.csaAnnuity = "Y";
            else {
                let applincantCSAannuityNo = await PageConfigHelper.findElement("ReceivingAnnuityNo", false);
                if(await applincantCSAannuityNo.isSelected()){
                    let spouseCSAannuity = await PageConfigHelper.findElement("SpouseAnnuity_Yes", false);
                    if(await spouseCSAannuity.isSelected())
                        this.csaAnnuity = "Y";
                }
            }
        }
    }
}
