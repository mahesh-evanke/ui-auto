import {EnrollCalcInput} from './EnrollCalcInput';
import * as  fs from 'fs';
const e2eConfig = require('js-yaml').load(fs.readFileSync('e2e/config/config.yaml','utf8'));
export class EnrollResultsCalc {

    private static instance: EnrollResultsCalc;

    private constructor() {
    }

    static getInstance() {
        if (!EnrollResultsCalc.instance) {
            EnrollResultsCalc.instance = new EnrollResultsCalc();
        }
        return EnrollResultsCalc.instance;
    }

     // Determine Age 65 Attainment Date based on DOB
private Age65_date(dobdate: string | Date) {
    var Age65date: string | number;
    let agetemp = new Date(dobdate);
    agetemp.setFullYear(agetemp.getFullYear() + 65);
    if ((String(agetemp.getDate()).padStart(2, '0')) === '01')
       Age65date = agetemp.setMonth(agetemp.getMonth() -1);
    Age65date = agetemp.toLocaleDateString();
    return Age65date;
 }

 // Months diffrences for two Dates
private monthDiff ({ mn1, mn2 }: { mn1: Date; mn2: Date; }) {
   //  var months,month1,month2;
   //  let tempmn1 = new Date(mn1);
   //  let tempmn2 = new Date(mn2);
   //  month1 = tempmn1.getMonth() + 1;
   //  month2 = tempmn2.getMonth() + 1;
   //  months = ((tempmn2.getFullYear() - tempmn1.getFullYear()) * 12 - (month1 -month2));
    var months,month1,month2
    let tempmn1 = new Date(mn1);
    let tempmn2 = new Date(mn2);
    month1 = tempmn1.getMonth() + 1;
    month2 = tempmn2.getMonth() + 1;
    let day1 = tempmn1.getDate();
    let day2 =  tempmn2.getDate();
    let year1 = tempmn1.getFullYear();
    let year2 = tempmn2.getFullYear();
    if (day1 > day2) { (month2 = month2 - 1);}
    months = ((year2 - year1) * 12 - (month1 - month2));
     return months;
 }

 // Deducting Months for Date
private minusMonths({ dtm, mncnt }: { dtm: Date; mncnt: number; }) {
    var month_minus: string | number
    let actualdtm = new Date(dtm);
    let monthctr:number = actualdtm.getMonth() - mncnt;
    let daycntr = actualdtm.getDate();
    let tempyear = actualdtm.getFullYear();
    let leap_year: string;
    if (monthctr < 0){monthctr = monthctr + 12;actualdtm.setFullYear(tempyear -1);tempyear = actualdtm.getFullYear();}
    if((tempyear % 4 === 0) && (tempyear % 100 === 0 || tempyear % 400 === 0)) {leap_year = 'Yes'} else { leap_year = 'No'}
    if((daycntr === 31) && (monthctr === 3 || monthctr === 5 || monthctr === 8 || monthctr === 10)){actualdtm.setDate(30);}
    else if((daycntr >= 29) && (monthctr === 1) && (leap_year === 'No')){actualdtm.setDate(28);}
    else if((daycntr >= 30) && (monthctr === 1) && (leap_year === 'Yes')){actualdtm.setDate(29);}
    month_minus = actualdtm.setMonth(monthctr);
    month_minus = actualdtm.toLocaleDateString();
    return month_minus;
 }

 // Adding Months for Date
private addMonths({ dtp, mncnt }: { dtp: Date; mncnt: number; }) {
    var month_plus: string | number
    let actualdtp = new Date(dtp);
    let monthctr = actualdtp.getMonth() + mncnt;
    let daycntr = actualdtp.getDate();
    let tempyear = actualdtp.getFullYear();
    let leap_year: string;
    if (monthctr >11){ monthctr = monthctr - 12; actualdtp.setFullYear(tempyear + 1); tempyear = actualdtp.getFullYear();}
    if((tempyear % 4 === 0) && (tempyear % 100 === 0 || tempyear % 400 === 0 )){leap_year = 'Yes'} else {leap_year = 'No'}
    if((daycntr === 31) && (monthctr === 3 || monthctr === 5 || monthctr === 8 || monthctr === 10)) {actualdtp.setDate(30);}
    else if((daycntr >= 29) && (monthctr === 1) && (leap_year === 'No')) {actualdtp.setDate(28);}
    else if((daycntr >= 30) && (monthctr === 1) && (leap_year === 'Yes')){actualdtp.setDate(29);}
    month_plus = actualdtp.setMonth(monthctr);
    month_plus = actualdtp.toLocaleDateString();
    return month_plus;
 }

 // Months number in the Date
private MonthNumber(mnval: Date) {
    var monthsVal: number
    let tempmnval = new Date(mnval);
    monthsVal = parseInt(String(tempmnval.getMonth() + 1).padStart(2, '0'));
    return monthsVal;
 }

 public HICalculation(enrollCalc: EnrollCalcInput) {
    //added by Mah
    let DOB=enrollCalc.dob;
    let Deemed_DOB=enrollCalc.deemedDOB;
    let Filing_Date=enrollCalc.filingDate;
    let First_Month_of_Insured_Status=enrollCalc.firstMonthInsured;
    let Enrolled_in_GHP=enrollCalc.enrolledinGHP;
    let first_month_of_GHP=enrollCalc.firstmonthGHP;
    let last_month_of_GHP=enrollCalc.lastmonthGHP;
    let Batch_Run_Processed_Date=enrollCalc.processDate;
    let User_chosen_SMI_Start_Month=enrollCalc.userChoseSMIStMonth;
    let SMI_Refusel_Indicator=enrollCalc.smiRefusalInd;
    let SMI_Enroll_USCrime=enrollCalc.smiEnrollUSCrime;
    let Non_equitable_relief_Start_month=enrollCalc.nonEquReliefStMonth;
    let Equitable_Relief_Status_Code=enrollCalc.equitableReliefStCode;
    let Medicade_Start_Date=enrollCalc.medicadeStDate;
    let CSA_Annuity_IND=enrollCalc.csaAnnuity;
    let GHP_Plan_Type = enrollCalc.GHPPlanType;
   // end of added by Mah

   //Determine Age 65 Attainment Date based on DOB  =IF(DAY(C1)=1,EDATE(C1,(65*12)-1),EDATE(C1,65*12))
   var Determine_Age_65_DOB =  this.Age65_date(DOB);
   let DOBmedicare = new Date(DOB);
   //console.log(Determine_Age_65_DOB + ':' + DOB);
   var Age_65_attainment_deemed_DOB
   //Age 65 attainment based on deemed DOB   =IF(ISBLANK(C2),"N/A",IF(DAY(C2)=1,EDATE(C2,(65*12)-1),EDATE(C2,65*12)))
   //let dDOB =  String(Deemed_DOB.getMonth() + 1).padStart(2, '0');     // .length);
   var tempFilingDate =new Date(Filing_Date);
   let tempMedicaid = new Date(Filing_Date);
   tempFilingDate.setDate(1);
   let tempdob = new Date(Deemed_DOB);
   let dDOB =  String(tempdob.getFullYear());
   if (dDOB === 'NaN'){ Age_65_attainment_deemed_DOB = '';} else {Age_65_attainment_deemed_DOB = this.Age65_date(Deemed_DOB);}
    //Determine First Eligibility Date and HI Delay Reason  =IF(C12="N/A",IF(C11>C4,C11,C4),IF(C12>C4,C12,C4))

   let C11 = new Date(Determine_Age_65_DOB);let C4 = new Date(First_Month_of_Insured_Status);let C5  = Enrolled_in_GHP;let C2 = new Date(Deemed_DOB);let C3 = new Date(tempFilingDate);
   let C6 = new Date(first_month_of_GHP);let C7 = new Date(last_month_of_GHP);let C8 = new Date(Batch_Run_Processed_Date);let C12 = new Date(Age_65_attainment_deemed_DOB);
   let F1 = SMI_Refusel_Indicator;let F1_1 = SMI_Enroll_USCrime;let F2 = new Date(Non_equitable_relief_Start_month);let F3 = Equitable_Relief_Status_Code;let F4 = new Date(Medicade_Start_Date);
   var Determine_First_Eligibility_Date_HI_Dealy;
   if (dDOB === 'NaN')
    {
      if(C11.getTime() > C4.getTime()){Determine_First_Eligibility_Date_HI_Dealy = Determine_Age_65_DOB;}
      else{Determine_First_Eligibility_Date_HI_Dealy = First_Month_of_Insured_Status;}
    }
   else
    {
      if(C12.getTime() > C4.getTime()){Determine_First_Eligibility_Date_HI_Dealy = Age_65_attainment_deemed_DOB;}
      else{Determine_First_Eligibility_Date_HI_Dealy = First_Month_of_Insured_Status;}
    }
   //Determine HI Start  =IF(C2="",IF(C3>C13,IF(DATEDIF(C13,C3,"m")>5,EDATE(C3,-6),C13),C13),IF(C11>C4,IF(C3>C11,IF(DATEDIF(C11,C3,"m")>5,EDATE(C3,-6),C11),C11),IF(C3>C4,IF(DATEDIF(C4,C3,"m")>5,EDATE(C3,-6),C4),C4)))
   let C13 = new Date(Determine_First_Eligibility_Date_HI_Dealy);
   var Determine_HI_Start;
   if (dDOB === 'NaN') //IF(C2="")
      {
            if (C3.getTime() > C13.getTime()) //IF(C3>C13)
               {
               if (Math.abs(parseInt(this.monthDiff({ mn1: C3, mn2: C13 }))) > 5) //IF(DATEDIF(C13,C3,"m")>5
                  //{let temp1 = C3;temp1.setMonth(temp1.getMonth() - 6);Determine_HI_Start = temp1.toLocaleDateString();}
                  {let temp1 = C3;Determine_HI_Start = this.minusMonths({ dtm: temp1, mncnt: 6 });}
               else
                  {Determine_HI_Start = Determine_First_Eligibility_Date_HI_Dealy;}
               }
            else
               { Determine_HI_Start = Determine_First_Eligibility_Date_HI_Dealy;}
      }
   else
      {
         if (C11.getTime() > C4.getTime())  //IF(C11>C4
            {
               if (C3.getTime() > C11.getTime())
                  {
                     if (Math.abs(parseInt(this.monthDiff({ mn1: C3, mn2: C11 }))) > 5)
                        //{ let temp1 = C3; temp1.setMonth(temp1.getMonth() - 6);Determine_HI_Start = temp1.toLocaleDateString();}
                        {let temp1 = C3;Determine_HI_Start = this.minusMonths({ dtm: temp1, mncnt: 6 });}
                     else
                        {Determine_HI_Start = Determine_Age_65_DOB;}
                  }
               else
                  {Determine_HI_Start = Determine_Age_65_DOB;}
            }
         else
            {
               if (C3.getTime() > C4.getTime()) //IF(C3>C4
                  if (Math.abs(parseInt(this.monthDiff({ mn1: C3, mn2: C4 }))) > 5) //IF(DATEDIF(C4,C3,"m")>5
                     //{let temp1 = C3;temp1.setMonth(temp1.getMonth() - 6); Determine_HI_Start = temp1.toLocaleDateString();}
                     {let temp1 = C3;Determine_HI_Start = this.minusMonths({ dtm: temp1, mncnt: 6 });}
                  else {Determine_HI_Start = First_Month_of_Insured_Status;}
               else
                  { Determine_HI_Start = First_Month_of_Insured_Status;}
            }
      }
   //Determine HI Type
   var Determine_HI_Type = 'Free'
     //Determine IEP Months for Deemed DOB ---  C18,D18,E18,F18,G18,H18,I18    =IF(C12<>"N/A",EDATE(C12,-3),"N/A")
   let C14 = new Date(Determine_HI_Start)
   var C18,D18,E18,F18,G18,H18,I18
   if (dDOB === 'NaN') //IF(C12 ="N/A)
      {
         C18 = ''; D18 = ''; E18 = ''; F18 = ''; G18 = ''; H18 = ''; I18 = '';
      }
   else  //IF(C12<>"N/A")  EDATE(C12,-3)
      {
         C18 = this.minusMonths({ dtm: C12, mncnt: 3 });D18 = this.minusMonths({ dtm: C12, mncnt: 2 });E18 = this.minusMonths({ dtm: C12, mncnt: 1 }); F18 = this.addMonths({ dtp: C12, mncnt: 0 }); G18 = this.addMonths({ dtp: C12, mncnt: 1 }); H18 = this.addMonths({ dtp: C12, mncnt: 2 }) ; I18 = this.addMonths({ dtp: C12, mncnt: 3 }); //EDATE(C12,-3)
      }
   //Determine_IEP_Months_for_DOB ---  C18,D18,E18,F18,G18,H18,I18  =EDATE(C11,-3)
   var C19,D19,E19,F19,G19,H19,I19
   C19 = this.minusMonths({ dtm: C11, mncnt: 3 });D19 = this.minusMonths({ dtm: C11, mncnt: 2 });E19 = this.minusMonths({ dtm: C11, mncnt: 1 }); F19 = this.addMonths({ dtp: C11, mncnt: 0 }); G19 = this.addMonths({ dtp: C11, mncnt: 1 }); H19 = this.addMonths({ dtp: C11, mncnt: 2 }) ; I19 = this.addMonths({ dtp: C11, mncnt: 3 }); //=EDATE(C11,-3)
   //Select_IEP_Months_for_SMI_Enrollment_Purposes ---  C18,D18,E18,F18,G18,H18,I18 =IF(C18="N/A",C19,C18)
   var C20,D20,E20,F20,G20,H20,I20
   if (dDOB === 'NaN') //IF(C12 ="N/A)
      {
         C20 = this.minusMonths({ dtm: C11, mncnt: 3 });D20 = this.minusMonths({ dtm: C11, mncnt: 2 });E20 = this.minusMonths({ dtm: C11, mncnt: 1 }); F20 = this.addMonths({ dtp: C11, mncnt: 0 }); G20 = this.addMonths({ dtp: C11, mncnt: 1 }); H20 = this.addMonths({ dtp: C11, mncnt: 2 }) ; I20 = this.addMonths({ dtp: C11, mncnt: 3 }); //C19
      }
   else  //IF(C18<>"N/A")
      {
         C20 = this.minusMonths({ dtm: C12, mncnt: 3 });D20 = this.minusMonths({ dtm: C12, mncnt: 2 });E20 = this.minusMonths({ dtm: C12, mncnt: 1 }); F20 = this.addMonths({ dtp: C12, mncnt: 0 }); G20 = this.addMonths({ dtp: C12, mncnt: 1 }); H20 = this.addMonths({ dtp: C12, mncnt: 2 }) ; I20 = this.addMonths({ dtp: C12, mncnt: 3 }); //C18
      }
   //Determine if IEP Applies	Yes   =IF(F4="",IF(F3<>"G",IF(AND(C3>=EDATE(C20,-1),MONTH(C3)<=MONTH(I20),YEAR(C3)<=YEAR(I20)),"Yes","No"),IF(F2<=I20,"Yes","No")),"Yes")
   var Determine_if_IEP_Applies
   C20 = new Date(C20); C3 = new Date(tempFilingDate); I20 = new Date(I20);F2 = new Date(F2);D20 = new Date(D20);E20 = new Date(E20);F20 = new Date(F20);G20 = new Date(G20);H20 = new Date(H20);
   if ( String(F4.getFullYear()) === 'NaN') //IF(F4="")
      {
            if (F3 != 'G') // IF(F3<>"G"
            {
               let fDate = new Date(C20);
               let Temp1 = new Date(this.minusMonths({ dtm: fDate, mncnt: 1 }));
               let Temp2 = new Date(this.addMonths({ dtp: I20, mncnt: 0 }));
               if (C3.getTime() >= Temp1.getTime() &&   C3.getTime() <= Temp2.getTime() && C3.getFullYear() <= I20.getFullYear())  //IF(AND(C3>=EDATE(C20,-1),MONTH(C3)<=MONTH(I20),YEAR(C3)<=YEAR(I20))
                  {Determine_if_IEP_Applies = 'Yes';}
               else
                  {Determine_if_IEP_Applies = 'No';}
            }
            else
            {
               if (F2 <= I20){Determine_if_IEP_Applies = 'Yes';}
               else{Determine_if_IEP_Applies = 'No';}
            }
     }
   else
     {Determine_if_IEP_Applies = 'Yes';}
   let C21 = Determine_if_IEP_Applies;
   //Determine SMI Start with IEP Involved	7/27/2021  =IF(F4="",IF(AND(F3<>"G",F2=""),IF((F1=""),IF(AND(C21="Yes",OR(MONTH(C3)=MONTH(C20)-1,MONTH(C3)=MONTH(C20),MONTH(C3)=MONTH(D20),MONTH(C3)=MONTH(E20))),C13,IF(AND(C21="Yes",MONTH(C3)=MONTH(F20)),EDATE(C13,1),IF(AND(C21="Yes",MONTH(C3)=MONTH(G20)),EDATE(C13,3),IF(AND(C21="Yes",MONTH(C3)=MONTH(H20)),EDATE(C13,5),IF(AND(C21="Yes",MONTH(C3)=MONTH(I20)),EDATE(C13,6),"N/A"))))),"N/A"),C3),IF(F4>C13,F4,C13))
   var Determine_SMI_Start_with_IEP_Involved;
   //console.log('I am at 280:' + String(F4.getFullYear()));
   if ( String(F4.getFullYear()) === 'NaN') //IF(F4="")
      {
         if (F3 != 'G' && String(F2.getFullYear()) === 'NaN') //=IF(AND(F3<>"G",F2=""),
            {
               if (F1 === '' && F1_1 === '') //IF((F1="")
                   {
                     if((C21 === 'Yes') && (C3.getMonth() === C20.getMonth(this.minusMonths({ dtm: C20, mncnt: 1 }))) || (C3.getMonth() === C20.getMonth()) || (C3.getMonth() === D20.getMonth()) || (C3.getMonth() === E20.getMonth())) //IF(AND(C21="Yes",OR(MONTH(C3)=MONTH(C20)-1,MONTH(C3)=MONTH(C20),MONTH(C3)=MONTH(D20),MONTH(C3)=MONTH(E20))),C13,"Test")
                          { Determine_SMI_Start_with_IEP_Involved = C13.toLocaleDateString();}
                     else if ((C21 === 'Yes') && (C3.getMonth() === F20.getMonth())) //IF(AND(C21="Yes",MONTH(C3)=MONTH(F20))
                              {  Determine_SMI_Start_with_IEP_Involved = this.addMonths({ dtp: C13, mncnt: 1 });                                 }
                     else if ((C21 === 'Yes') && (C3.getMonth() === G20.getMonth())) //IF(AND(C21="Yes",MONTH(C3)=MONTH(F20))
                              {  Determine_SMI_Start_with_IEP_Involved = this.addMonths({ dtp: C13, mncnt: 3 });}
                     else if ((C21 === 'Yes') && (C3.getMonth() === H20.getMonth())) //IF(AND(C21="Yes",MONTH(C3)=MONTH(F20))
                              {Determine_SMI_Start_with_IEP_Involved = this.addMonths({ dtp: C13, mncnt: 5 });}
                     else if ((C21 === 'Yes') && (C3.getMonth() === I20.getMonth())) //IF(AND(C21="Yes",MONTH(C3)=MONTH(F20))
                              { Determine_SMI_Start_with_IEP_Involved = this.addMonths({ dtp: C13, mncnt: 6 });}
                     else {Determine_SMI_Start_with_IEP_Involved = '';}
                   }
               else{Determine_SMI_Start_with_IEP_Involved = '';}
            }
         else
            {Determine_SMI_Start_with_IEP_Involved = C3;}
      }
   else
      {
         if (F4.getTime() > C13.getTime()){ Determine_SMI_Start_with_IEP_Involved = F4;}
         else {Determine_SMI_Start_with_IEP_Involved = C13.toLocaleDateString();}
      }
   //GEP
   //Determine if GEP without GHP Applies
   var Determine_if_GEP_without_GHP_Applies;  //=IF(AND(C21="No",C5="No", MONTH(C3)<=3,YEAR(C3)=YEAR(C8)), "GEP Applies", "GEP does not apply")
   if ((C21 === 'No') && (C5 === 'No') && (parseInt(String(C3.getMonth() + 1).padStart(2, '0')) <= 3) && (C3.getFullYear() === C8.getFullYear()))
      {Determine_if_GEP_without_GHP_Applies = 'GEP Applies';}
   else
      {Determine_if_GEP_without_GHP_Applies = 'GEP does not apply';}
   //Determine if GEP with GHP Applies
   var Determine_if_GEP_with_GHP_Applies;  //=IF(AND(C21="No",C44<>"SEP applies", MONTH(C3)<=3,YEAR(C3)=YEAR(C8)), "GEP Applies", "GEP does not apply")
   //**************************************************************************** SEP rules can apply*/
   var Determine_if_SEP_rules_can_Apply_if_GHP_ended  //=IF(AND(C21="No",C5="Yes",C7<>""), "SEP rules can apply", "SEP rules does not apply")
   let C7Temp =  String(C7.getFullYear());
   //if ((C21 === 'No') && (C5 === 'Yes') && (String(C7.getFullYear()) != 'NaN'))
   if ((C21 === 'No') && (C5 === 'Yes') && (C7Temp != 'NaN'))
      {Determine_if_SEP_rules_can_Apply_if_GHP_ended = 'SEP rules can apply';}
   else
      {Determine_if_SEP_rules_can_Apply_if_GHP_ended = 'SEP rules does not apply';}
   let C45 = Determine_if_SEP_rules_can_Apply_if_GHP_ended;
   // Determine if SEP rules can Apply if GHP not ended
   var Determine_if_SEP_rules_can_Apply_if_GHP_not_ended;  //=IF(AND(C21="No",C5="Yes",C7=""), "SEP rules can apply", "SEP rules does not apply")
   if ((C21 === 'No') && (C5 === 'Yes') && (C7Temp === 'NaN'))
      {Determine_if_SEP_rules_can_Apply_if_GHP_not_ended = 'SEP rules can apply';}
   else
      {Determine_if_SEP_rules_can_Apply_if_GHP_not_ended = 'SEP rules does not apply';}
   let C53 = Determine_if_SEP_rules_can_Apply_if_GHP_not_ended;
   // Determine SEP Months if GHP ended
   var Determine_SEP_Months_if_GHP_ended; // =IF(C45="SEP rules can apply", EDATE(C7,-2),"N/A")
   var C46,D46,E46,F46,G46,H46,I46,J46,K46,L46,M46;
   if (C45 === 'SEP rules can apply') //=IF(C45="SEP rules can apply"
      {C46 = this.minusMonths({ dtm: C7, mncnt: 2 });D46 = this.minusMonths({ dtm: C7, mncnt: 1 });E46 = this.addMonths({ dtp: C7, mncnt: 0 }); F46 = this.addMonths({ dtp: C7, mncnt: 1 }); G46 = this.addMonths({ dtp: C7, mncnt: 2 }); H46 = this.addMonths({ dtp: C7, mncnt: 3 }) ; I46 = this.addMonths({ dtp: C7, mncnt: 4 }); J46 = this.addMonths({ dtp: C7, mncnt: 5 }); K46 = this.addMonths({ dtp: C7, mncnt: 6 }); L46 = this.addMonths({ dtp: C7, mncnt: 7 }); M46 = this.addMonths({ dtp: C7, mncnt: 8 });}
   else  //"N/A"
      {C46 = ''; D46 = ''; E46 = ''; F46 = ''; G46 = ''; H46 = ''; I46 = ''; J46 = ''; K46 = ''; L46 = ''; M46 = '';}
   let CC46 = new Date(C46);let DD46 = new Date(D46);let EE46 = new Date(E46);let FF46 = new Date(F46);let HH46 = new Date(H46); // Determine SMI Start Options with SEP Involved (filing is in the 1st SEP Month) if GHP ended  //=IF(C46<>"N/A",IF(AND(MONTH(C3)=MONTH(C46),YEAR(C3)=YEAR(C46)),C46,"N/A"),"N/A")
   var C47,D47,E47;
   let C9 = new Date(User_chosen_SMI_Start_Month);
   if (String(CC46.getFullYear()) != 'NaN') //=IF(C46<>"N/A"
      {
         if (parseInt(String(C3.getMonth() + 1).padStart(2, '0'))  === parseInt(String(CC46.getMonth() + 1).padStart(2, '0')) && (C3.getFullYear() === CC46.getFullYear())) //IF(AND(MONTH(C3)=MONTH(C46),YEAR(C3)=YEAR(C46))
            {
               C47 = new Date(C46); D47 = new Date(F46);   //=IF(AND(C45="SEP rules can apply",C9<>""),IF(C47<>"N/A",IF(AND(EDATE(C9,0)>=EDATE(C47,0),EDATE(C9,0)<=EDATE(D47,0)),EDATE(C9,0),"N/A"),"N/A"),"N/A")
               if (C45 === 'SEP rules can apply' && String(C9.getFullYear()) != 'NaN') //=IF(AND(C45="SEP rules can apply",C9<>"")
                  { let C47temp = String(C47.getFullYear());
                     if (C47temp != 'NaN') //IF(C47<>"N/A"
                        {
                           if(C9.getTime >= C47.getTime && C9.getTime >= D47.getTime) {E47 = C9;}   //IF(AND(EDATE(C9,0)>=EDATE(C47,0),EDATE(C9,0)<=EDATE(D47,0))
                           else {E47 = '';}
                        }
                     else {E47 = '';}
                  }
               else {E47 = '';}
            }
         else {C47 = ''; D47 = ''; E47 = '';}
      }
   else {C47 = ''; D47 = ''; E47 = '';}
   let CC47 = new Date(C47);let DD47 = new Date(D47); let EE47 = new Date(E47);
   // Determine SMI Start Options with SEP Involved (filing is in the 2nd SEP Month) if GHP ended //=IF(C46<>"N/A",IF(AND(MONTH(C3)=MONTH(D46),YEAR(C3)=YEAR(D46)),D46,"N/A"),"N/A")
   var C48,D48,E48
   if (String(CC46.getFullYear()) != 'NaN') //=IF(C46<>"N/A"
      {
         if (parseInt(String(C3.getMonth() + 1).padStart(2, '0'))  === parseInt(String(DD46.getMonth() + 1).padStart(2, '0')) && (C3.getFullYear() === DD46.getFullYear())) //IF(AND(MONTH(C3)=MONTH(D46),YEAR(C3)=YEAR(D46))
            {
               C48 = D46; D48 = G46;   //=IF(AND(C45="SEP rules can apply",C9<>""),IF(C48<>"N/A",IF(AND(EDATE(C9,0)>=EDATE(C48,0),EDATE(C9,0)<=EDATE(D48,0)),EDATE(C9,0),"N/A"),"N/A"),"N/A")
               let CC48 = new Date(C48); let DD48 = new Date(D48);
               if (C45 === 'SEP rules can apply' && String(C9.getFullYear()) != 'NaN') //=IF(AND(C45="SEP rules can apply",C9<>"")
                  {
                     if (String(CC48.getFullYear()) != 'NaN') //IF(C48<>"N/A"
                     {
                        if(C9.getTime >= CC48.getTime && C9.getTime >= DD48.getTime){E48 = C9.toLocaleDateString();}   //IF(AND(EDATE(C9,0)>=EDATE(C48,0),EDATE(C9,0)<=EDATE(D48,0))
                        else {E48 = '';}
                     }
                     else {E48 = '';}
                  }
               else {E48 = '';}
            }
         else {C48 = ''; D48 = ''; E48 = '';}
      }
   else {C48 = ''; D48 = ''; E48 = '';}
   let EE48 = new Date(E48);
   // Determine SMI Start Options with SEP Involved (filing is in the 3rd SEP Month) if GHP ended  //=IF(C46<>"N/A",IF(AND(MONTH(C3)=MONTH(F46),YEAR(C3)=YEAR(F46)),F46,"N/A"),"N/A")
   var C49,D49,E49;
   if (String(CC46.getFullYear()) != 'NaN') //=IF(C46<>"N/A"
      {
         if (parseInt(String(C3.getMonth() + 1).padStart(2, '0'))  === parseInt(String(EE46.getMonth() + 1).padStart(2, '0')) && (C3.getFullYear() === EE46.getFullYear())) //IF(AND(MONTH(C3)=MONTH(E46),YEAR(C3)=YEAR(E46))
            {
               C49 = new Date(E46); D49 = new Date(H46);   //=IF(AND(C45="SEP rules can apply",C9<>""),IF(C49<>"N/A",IF(AND(EDATE(C9,0)>=EDATE(C49,0),EDATE(C9,0)<=EDATE(D49,0)),EDATE(C9,0),"N/A"),"N/A"),"N/A")
               if (C45 === 'SEP rules can apply' && String(C9.getFullYear()) != 'NaN') //=IF(AND(C45="SEP rules can apply",C9<>"")
                  {
                  if (String(C49.getFullYear()) != 'NaN') //IF(C49<>"N/A"
                     {
                        if(C9.getTime >= C49.getTime && C9.getTime >= D49.getTime) {E49 = C9;} //IF(AND(EDATE(C9,0)>=EDATE(C49,0),EDATE(C9,0)<=EDATE(D49,0))
                        else {E49 = '';}
                     }
                     else {E49 = '';}
                  }
               else {E49 = '';}
            }
         else {C49 = ''; D49 = ''; E49 = '';}
      }
   else
      {C49 = ''; D49 = ''; E49 = '';}
   let CC49 = new Date(C49); let DD49 = new Date(D49); let EE49 = new Date(E49);
   // Determine SMI Start Options with SEP Involved (filing is in the 4th SEP Month) if GHP ended  //=IF(C46<>"N/A",IF(AND(MONTH(C3)=MONTH(F46),YEAR(C3)=YEAR(F46)),F46,"N/A"),"N/A")
   var C50,D50,E50
   if (String(CC46.getFullYear()) != 'NaN') //=IF(C46<>"N/A"
      {
         if (parseInt(String(C3.getMonth() + 1).padStart(2, '0'))  === parseInt(String(FF46.getMonth() + 1).padStart(2, '0')) && (C3.getFullYear() === FF46.getFullYear())) //IF(AND(MONTH(C3)=MONTH(F46),YEAR(C3)=YEAR(F46))
            {
               C50 =new Date(F46); D50 = new Date(I46);   //=IF(AND(C45="SEP rules can apply",C9<>""),IF(C50<>"N/A",IF(AND(EDATE(C9,0)>=EDATE(C50,0),EDATE(C9,0)<=EDATE(D50,0)),EDATE(C9,0),"N/A"),"N/A"),"N/A")
               if (C45 === 'SEP rules can apply' && String(C9.getFullYear()) != 'NaN') //=IF(AND(C45="SEP rules can apply",C9<>"")
                  {
                  if (String(C50.getFullYear()) != 'NaN') //IF(C50<>"N/A"
                     {
                        if(C9.getTime >= C50.getTime && C9.getTime >= D50.getTime) {E50 = C9;}  //IF(AND(EDATE(C9,0)>=EDATE(C50,0),EDATE(C9,0)<=EDATE(D50,0))
                        else {E50 = '';}
                     }
                     else {E50 = '';}
                  }
               else {E50 = '';}
            }
         else {C50 = ''; D50 = ''; E50 = '';}
      }
   else {C50 = ''; D50 = ''; E50 = '';}
   let CC50 = new Date(C50); let DD50 = new Date(D50); let EE50 = new Date(E50); let GG46 = new Date(G46); let MM46 = new Date(M46);
   // Determine Mandatory SMI Start with SEP Involved (filing in from 5th to last applicable SEP month) if GHP ended
   var Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended; //=IF(AND(C46<>"N/A",C9<>""),IF(AND(EDATE(C9,0)>=EDATE(G46,0),EDATE(C9,0)<=EDATE(M46,0)),EDATE(C3,1),"N/A"),"N/A")
   if ((String(CC46.getFullYear()) != 'NaN') && (String(C9.getFullYear()) != 'NaN')) //=IF(AND(C46<>"N/A",C9<>"")
      {
         if (C9.getTime() >= GG46.getTime() && C9.getTime() <= MM46.getTime()) //IF(AND(EDATE(C9,0)>=EDATE(G46,0),EDATE(C9,0)<=EDATE(M46,0))
            {Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended = this.addMonths({ dtp: C3, mncnt: 1 });}
         else {Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended = '';}
      }
   else {Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended = '';}
   // Determine final SEP start month
   var Determine_final_SEP_start_month;  //=IF(C45="SEP rules can apply",IF(E47<>"N/A",E47,IF(E48<>"N/A",E48,IF(E49<>"N/A",E49,IF(E50<>"N/A",E50,IF(C51<>"N/A",C51,"N/A"))))),"N/A")
   let C51 = new Date(Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended);
   if (C45 === 'SEP rules can apply')  //IF(C45="SEP rules can apply"
      {
         if (String(EE47.getFullYear()) != 'NaN')
            { Determine_final_SEP_start_month = E47;}
         else
            {
               if (String(EE48.getFullYear()) != 'NaN')
                  {Determine_final_SEP_start_month = E48;}
               else
                  {
                     if (String(EE49.getFullYear()) != 'NaN')
                        {Determine_final_SEP_start_month = E49;}
                     else
                        {
                           if (String(EE50.getFullYear()) != 'NaN')
                              {Determine_final_SEP_start_month = E50;}
                           else
                              {
                              if (String(C51.getFullYear()) != 'NaN') {Determine_final_SEP_start_month = C51;}
                              else {Determine_final_SEP_start_month = '';}
                              }
                        }
                  }
            }
      }
   else {Determine_final_SEP_start_month = '';}
   // Check if user chosen month is any of SEP months with GHP not ended  //=IF(AND(C9<>"",C54<>"N/A"),IF(OR(AND(MONTH(C9)=MONTH(C54),YEAR(C9)=YEAR(C54)),AND(MONTH(C9)=MONTH(D54),YEAR(C9)=YEAR(D54)),AND(MONTH(C9)=MONTH(E54),YEAR(C9)=YEAR(E54)),AND(MONTH(C9)=MONTH(F54),YEAR(C9)=YEAR(F54))),C9,"N/A"),"N/A")
   var Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended;
   var C54,D54,E54,F54;
   //Determine_SEP_Months_if_GHP_not_ended   =IF(C53="SEP rules can apply", EDATE(C3,0),"N/A")
   if(C53 === 'SEP rules can apply'){(C54 = C3);(D54= this.addMonths({ dtp: C3, mncnt: 1 })); (E54= this.addMonths({ dtp: C3, mncnt: 2 })); (F54= this.addMonths({ dtp: C3, mncnt: 3 })); }
   else{(C54 = '');(D54 = '');(E54 = '');(F54 = '');}
   let CC54 = new Date(C54); let DD54 = new Date(D54); let EE54 = new Date(E54); let FF54 = new Date(F54);
   if ((String(C9.getFullYear()) != 'NaN') && (String(CC54.getFullYear()) != 'NaN'))  //IF(AND(C9<>"",C54<>"N/A")
      {
         if((this.MonthNumber(C9) === this.MonthNumber(CC54) && C9.getFullYear() === CC54.getFullYear()) || (this.MonthNumber(C9) === this.MonthNumber(DD54) && C9.getFullYear() === DD54.getFullYear()) || (this.MonthNumber(C9) === this.MonthNumber(EE54) && C9.getFullYear() === EE54.getFullYear()) || (this.MonthNumber(C9) === this.MonthNumber(FF54) && C9.getFullYear() === FF54.getFullYear())) //IF(OR(AND(MONTH(C9)=MONTH(C54),YEAR(C9)=YEAR(C54)),AND(MONTH(C9)=MONTH(D54),YEAR(C9)=YEAR(D54)),AND(MONTH(C9)=MONTH(E54),YEAR(C9)=YEAR(E54)),AND(MONTH(C9)=MONTH(F54),YEAR(C9)=YEAR(F54)))
            {Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended = C9;}
         else {Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended = '';}
      }
   else {Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended = '';}
   // Determine if SEP applies
   var Determine_if_SEP_Applies   //=IF(AND(C45="SEP rules can apply",C52="N/A"),IF(AND(C53="SEP rules can apply",C55<>"N/A"),"SEP applies","SEP does not apply"),"SEP applies")
   let C52 = new Date(Determine_final_SEP_start_month);
   let C55 = new Date(Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended);
   if ((C45 === 'SEP rules can apply') && (String(C52.getFullYear()) === 'NaN')) //=IF(AND(C45="SEP rules can apply",C52="N/A")
      {
         if ((C53 === 'SEP rules can apply') && (String(C55.getFullYear()) != 'NaN')) {Determine_if_SEP_Applies = 'SEP applies';} //IF(AND(C53="SEP rules can apply",C55<>"N/A")
         else {Determine_if_SEP_Applies = 'SEP does not apply';}
      }
   else {Determine_if_SEP_Applies = 'SEP applies';}
   let C44 = Determine_if_SEP_Applies;
   //**************************************************************************** SEP rules can apply*/
   var Determine_if_SEP_rules_can_Apply_if_GHP_ended  //=IF(AND(C21="No",C5="Yes",C7<>""), "SEP rules can apply", "SEP rules does not apply")
   if ((C21 === 'No') && (C5 === 'Yes') && (String(C7.getFullYear()) != 'NaN')) {Determine_if_SEP_rules_can_Apply_if_GHP_ended = 'SEP rules can apply';}
   else {Determine_if_SEP_rules_can_Apply_if_GHP_ended = 'SEP rules does not apply';}
   let C24 = Determine_if_GEP_without_GHP_Applies;
   if ((C21 === 'No') && (C44 != 'SEP applies') && (parseInt(String(C3.getMonth() + 1).padStart(2, '0')) <= 3) && (C3.getFullYear() === C8.getFullYear())) {Determine_if_GEP_with_GHP_Applies = 'GEP Applies';}
   else {Determine_if_GEP_with_GHP_Applies = 'GEP does not apply';}
   let C25 = Determine_if_GEP_with_GHP_Applies;
   // Determine if GEP Applies
   var Determine_if_GEP_Applies   //=IF(OR(C24="GEP Applies",C25="GEP Applies"),"GEP Applies","GEP does not apply")
   if ((C24 === 'GEP Applies') || (C25 === 'GEP Applies')) {Determine_if_GEP_Applies = 'GEP Applies';}
   else {Determine_if_GEP_Applies = 'GEP does not apply';}
    // Determine Last Non-IEP Enrollment Period Month for GEP
   var Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP  //=IF(C26="GEP Applies",CONCATENATE("03/",YEAR(C3)),"N/A")
   let C26 = Determine_if_GEP_Applies;
   if (C26 === 'GEP Applies') {Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP = '03/01/' + C3.getFullYear();}
   else {Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP = '';}
   // Determine SMI Start with GEP Involved
   var Determine_SMI_Start_with_GEP_Involved   //=IF(C26="GEP Applies",CONCATENATE("07/",YEAR(C3)),"N/A")
   if (C26 === 'GEP Applies') {Determine_SMI_Start_with_GEP_Involved = '07/01/' + C3.getFullYear();}
   else {Determine_SMI_Start_with_GEP_Involved = '';}
    // Determine Premium Surcharge Countable Months (individual who is enrolling for the first time) - GEP
   var Determine_Premium_Surcharge_Countable_Months  //=IF(AND(C21="No",C26="GEP Applies"),IF(EDATE(C27,0)>EDATE(I20,1),DATEDIF(EDATE(I20,1),EDATE(C27,0),"m")+2,"N/A"),"N/A")
   let C27 = new Date(Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP);
   if ((C21 === 'No') && (C26 === 'GEP Applies')) //IF(AND(C21="No",C26="GEP Applies")
      {  let Temp1 = new Date(I20);let Temp2 = new Date(this.addMonths({ dtp: Temp1, mncnt: 1 }));
         if( C27.getTime() > Temp2.getTime()) {Determine_Premium_Surcharge_Countable_Months =  Math.abs(parseInt(this.monthDiff({ mn1: Temp2, mn2: C27 })) + 2);}  //IF(EDATE(C27,0)>EDATE(I20,1)
         else {Determine_Premium_Surcharge_Countable_Months = '';}
      }
   else {Determine_Premium_Surcharge_Countable_Months = '';}
   // Determine exclusion months from GHP
   let C29 = Determine_Premium_Surcharge_Countable_Months;
   var Determine_exclusion_months_from_GHP //=IF(AND(C26="GEP Applies",C5="Yes",C7<>"",C29<>"N/A"),IF(EDATE(C7,0)>EDATE(I20,0),DATEDIF(EDATE(I20,1),EDATE(C7,0),"m")+1,IF(AND(C7="",C26="GEP Applies"),IF(AND(C5="Yes",EDATE(C6,0)<=EDATE(I20,1)),C29,IF(AND(C7="",C26="GEP Applies"),IF(EDATE(C6,0)>EDATE(I20,1),DATEDIF(EDATE(C6,0),EDATE(C27,0),"m")+2,"N/A"),"N/A")),"N/A")),"N/A")
   if ((C26 === 'GEP Applies') && (C5 === 'Yes') && (String(C7.getFullYear()) != 'NaN') && (C29 != ''))  //IF(AND(C26="GEP Applies",C5="Yes",C7<>"",C29<>"N/A")
      {
         let Temp1 = new Date(I20);
         let Temp2 = new Date(this.addMonths({ dtp: Temp1, mncnt: 1 }));
         if( C7.getTime() > I20.getTime()) //IF(EDATE(C7,0)>EDATE(I20,0),DATEDIF(EDATE(I20,1),EDATE(C7,0),"m")+1
            {
               Determine_exclusion_months_from_GHP =  Math.abs(parseInt(this.monthDiff({ mn1: Temp2, mn2: C7 })) + 1);
            }
         else
            {
               if ((String(C7.getFullYear()) != 'NaN') && (C26 === 'GEP Applies'))  //IF(AND(C7="",C26="GEP Applies")
               {
                  let Temp3 = new Date(I20);
                  let Temp4 = new Date(this.addMonths({ dtp: Temp3, mncnt: 1 }));
                  if ((C5 === 'Yes') && (C6.getTime() <= Temp4.getTime()))  //IF(AND(C5="Yes",EDATE(C6,0)<=EDATE(I20,1))
                     Determine_exclusion_months_from_GHP = C29;  //C29
                  else
                     if ((String(C7.getFullYear()) != 'NaN') && (C26 === 'GEP Applies'))   ///IF(AND(C7="",C26="GEP Applies")
                        {
                           let Temp5 = new Date(I20);
                           let Temp6 = new Date(this.addMonths({ dtp: Temp5, mncnt: 1 }));
                           if (C6.getTime() > Temp6.getTime())
                              {Determine_exclusion_months_from_GHP =   Math.abs(parseInt(this.monthDiff({ mn1: C6, mn2: C27 })) + 2);}
                           else
                              {Determine_exclusion_months_from_GHP  = '';}  //"N/A"
                        }
                     else
                        {Determine_exclusion_months_from_GHP  = '';}  //"N/A"
               }
               else
                  {Determine_exclusion_months_from_GHP  = '';}  //"N/A"
            }
      }
   else
   {
      Determine_exclusion_months_from_GHP = '';   //"N/A"
   }
   // Determine final premium surcharge countable months
   var Determine_final_premium_surcharge_countable_months  //=IF(C30<>"N/A",C29-C30,C29)
   let C30 = Determine_exclusion_months_from_GHP;
   if (C30 !='') //=IF(C30<>"N/A"
      {Determine_final_premium_surcharge_countable_months = (C29 - C30);} //C29-C30
   else
      {Determine_final_premium_surcharge_countable_months = C29;}  //C29
   // Determine Premium Surcharge Number(BRM) of Twelve Month Periods (GEP)
   var Determine_Premium_Surcharge_Number_BRM_12Months;  //=IF(C31<>"N/A",1+TRUNC((C31/12)*0.1,1),"N/A")
   let C31 = Determine_final_premium_surcharge_countable_months;
   if (C31 !='') // =IF(C31<>"N/A"
      {Determine_Premium_Surcharge_Number_BRM_12Months =   Math.floor(((C31/12 * 0.1) + 1)*10) /10;} //1+TRUNC((C31/12)*0.1,1)
   else
      {Determine_Premium_Surcharge_Number_BRM_12Months = '';}  //"N/A"
   let C32 = Determine_Premium_Surcharge_Number_BRM_12Months;
   //AEP
   //Determine if AEP without GHP Applie
   var Determine_if_AEP_without_GHP_Applies;  //=IF(AND(C21="No",C5="No", MONTH(C3)>3, YEAR(C3)=YEAR(C8)), "AEP Applies", "AEP does not apply")
   if ((C21 === 'No') && (C5 === 'No') && (this.MonthNumber(C3) > 3) && (C3.getFullYear() === C8.getFullYear())) //=IF(AND(C21="No",C5="No", MONTH(C3)>3, YEAR(C3)=YEAR(C8))
      {Determine_if_AEP_without_GHP_Applies = 'AEP Applies';}
   else
      {Determine_if_AEP_without_GHP_Applies = 'AEP does not apply';}
    //Determine if AEP with GHP Applies
   var Determine_if_AEP_with_GHP_Applies;   //=IF(AND(C21="No",C5="Yes", C44<>"SEP applies",MONTH(C3)>3, YEAR(C3)=YEAR(C8)), "AEP Applies", "AEP does not apply")
   //if ((C21 === 'No') && (C5 === 'Yes') && (C44 !='SEP applies') && (parseInt(String(C3.getMonth() + 1).padStart(2, '0')) > 3) && (C3.getFullYear() === C8.getFullYear())) //=IF(AND(C21="No",C5="Yes", C44<>"SEP applies",MONTH(C3)>3, YEAR(C3)=YEAR(C8))
   if ((C21 === 'No') && (C5 === 'Yes') && (C44 != 'SEP applies') && (this.MonthNumber(C3) > 3) && (C3.getFullYear() === C8.getFullYear())) //=IF(AND(C21="No",C5="Yes", C44<>"SEP applies",MONTH(C3)>3, YEAR(C3)=YEAR(C8))
      {Determine_if_AEP_with_GHP_Applies = 'AEP Applies';}
   else
      {Determine_if_AEP_with_GHP_Applies = 'AEP does not apply';}
   //Determine Last Non-IEP Enrollment Period Month for AEP
   let C34 = Determine_if_AEP_without_GHP_Applies;
   let C35 = Determine_if_AEP_with_GHP_Applies;
   var Determine_if_AEP_applies; //=IF(OR(C34="AEP Applies",C35="AEP Applies"),"AEP Applies","AEP does not apply")
   if ((C34 === 'AEP Applies') || (C35 === 'AEP Applies')) //IF(OR(C34="AEP Applies",C35="AEP Applies")
      {Determine_if_AEP_applies = 'AEP Applies';}
   else
      {Determine_if_AEP_applies = 'AEP does not apply';}
   var Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP  //=IF(C36="AEP Applies",CONCATENATE("03/",YEAR(C3)+1),"N/A")
   let C36 = Determine_if_AEP_applies;
   if (C36 === 'AEP Applies')
      {Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP = '03/01/' + (C3.getFullYear() + 1);}
   else
      {Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP = '';}
    // Determine SMI Start with AEP Involved
   var Determine_SMI_Start_with_AEP_Involved   //=IF(C36="AEP Applies",CONCATENATE("07/",YEAR(C3)),"N/A")
   if (C36 === 'AEP Applies')
      {Determine_SMI_Start_with_AEP_Involved = '07/01/' + (C3.getFullYear() +1) ;}
   else
      {Determine_SMI_Start_with_AEP_Involved = '';}
   // Determine Premium Surcharge Countable Months (individual who is enrolling for the first time) - AEP
   var Determine_Premium_Surcharge_Countable_Months_AEP  //=IF(AND(C21="No",C36="AEP Applies"),IF(EDATE(C37,0)>EDATE(I20,1),DATEDIF(EDATE(I20,1),EDATE(C37,0),"m")+2,"N/A"),"N/A")
   let C37 = new Date(Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP);
   if ((C21 === 'No') && (C36 === 'AEP Applies')) //IF(AND(C21="No",C26="AEP Applies")
      {
         let Temp1 = new Date(I20);
         let Temp2 = new Date(this.addMonths({ dtp: Temp1, mncnt: 1 }));
         if( C37.getTime() > Temp2.getTime())  //IF(EDATE(C37,0)>EDATE(I20,1)
            {Determine_Premium_Surcharge_Countable_Months_AEP =  Math.abs(parseInt(this.monthDiff({ mn1: Temp2, mn2: C37 })) + 2);}
         else
            {Determine_Premium_Surcharge_Countable_Months_AEP = '';}
      }
   else
      {Determine_Premium_Surcharge_Countable_Months_AEP = '';}
    // Determine exclusion months from GHP
   let C39 = Determine_Premium_Surcharge_Countable_Months_AEP;
   var Determine_exclusion_months_from_GHP_AEP //=IF(AND(C36="AEP Applies",C5="Yes",C7<>"",C39<>"N/A"),IF(EDATE(C7,0)>EDATE(I20,0),DATEDIF(EDATE(I20,1),EDATE(C7,0),"m")+1,IF(AND(C7="",C36="AEP Applies"),IF(AND(C5="Yes",EDATE(C6,0)<=EDATE(I20,1)),C39,IF(AND(C7="",C36="AEP Applies"),IF(EDATE(C6,0)>EDATE(I20,1),DATEDIF(EDATE(C6,0),EDATE(C37,0),"m")+2,"N/A"),"N/A")),"N/A")),"N/A")
   if ((C36 === 'AEP Applies') && (C5 === 'Yes') && (String(C7.getFullYear()) != 'NaN') && (C39 != ''))  //IF(AND(C26="AEP Applies",C5="Yes",C7<>"",C39<>"N/A")
      {
         let Temp1 = new Date(I20);
         let Temp2 = new Date(this.addMonths({ dtp: Temp1, mncnt: 1 }));
         if( C7.getTime() > I20.getTime()) //IF(EDATE(C7,0)>EDATE(I20,0),DATEDIF(EDATE(I20,1),EDATE(C7,0),"m")+1
            {
               Determine_exclusion_months_from_GHP_AEP =  Math.abs(parseInt(this.monthDiff({ mn1: Temp2, mn2: C7 })) + 1);
            }
         else
            {
               if ((String(C7.getFullYear()) != 'NaN') && (C36 === 'AEP Applies'))  //IF(AND(C7="",C36="AEP Applies")
               {
                  let Temp3 = new Date(I20);
                  let Temp4 = new Date(this.addMonths({ dtp: Temp3, mncnt: 1 }));
                  if ((C5 === 'Yes') && (C6.getTime() <= Temp4.getTime()))  //IF(AND(C5="Yes",EDATE(C6,0)<=EDATE(I20,1))
                     {Determine_exclusion_months_from_GHP_AEP = C39;}  //C29
                  else
                     if ((String(C7.getFullYear()) != 'NaN') && (C36 === 'AEP Applies'))   ///IF(AND(C7="",C36="AEP Applies")
                        {
                           let Temp5 = new Date(I20);
                           let Temp6 = new Date(this.addMonths({ dtp: Temp5, mncnt: 1 }));
                           if (C6.getTime() > Temp6.getTime())   ///IF(EDATE(C6,0)>EDATE(I20,1)
                              {Determine_exclusion_months_from_GHP_AEP =   Math.abs(parseInt(this.monthDiff({ mn1: C6, mn2: C37 })) + 2);}
                           else
                              {Determine_exclusion_months_from_GHP_AEP  = '';}  //"N/A"
                        }
                     else
                        {Determine_exclusion_months_from_GHP_AEP  = '';}  //"N/A"
               }
               else
                  {Determine_exclusion_months_from_GHP_AEP  = '';}  //"N/A"
            }
      }
   else
   {
      Determine_exclusion_months_from_GHP_AEP = '';   //"N/A"
   }
   // Determine final premium surcharge countable months AEP
   var Determine_final_premium_surcharge_countable_months_AEP  //=IF(C40<>"N/A",C39-C40,C39)
   let C40 = Determine_exclusion_months_from_GHP_AEP;
   if (C40 !='') //=IF(C40<>"N/A"
      {Determine_final_premium_surcharge_countable_months_AEP = (C39 - C40);} //C39-C40
   else
      {Determine_final_premium_surcharge_countable_months_AEP = C39;} //C39
   // Determine Premium Surcharge Number(BRM) of Twelve Month Periods (AEP)
   var Determine_Premium_Surcharge_Number_BRM_12Months_AEP  //=IF(C41<>"N/A",1+TRUNC((C41/12)*0.1,1),"N/A")
   let C41 = Determine_final_premium_surcharge_countable_months_AEP;
   if (C41 !='') // =IF(C31<>"N/A"
      {Determine_Premium_Surcharge_Number_BRM_12Months_AEP = Math.floor(((C41/12 * 0.1) + 1)*10) /10;} //1+TRUNC((C31/12)*0.1,1)
   else
      {Determine_Premium_Surcharge_Number_BRM_12Months_AEP = '';}  //"N/A"
   let C42 = Determine_Premium_Surcharge_Number_BRM_12Months_AEP;
         ///Output Elements
      //HI_START
      let tempHistart = C14;
      tempHistart.setDate(1);
      var dd_H = String(tempHistart.getDate()).padStart(2, '0');
      var mm_H = String(tempHistart.getMonth() + 1).padStart(2, '0'); //January is 0!
      var yyyy_H = tempHistart.getFullYear();
      var HI_START = mm_H + '/' + dd_H + '/' + yyyy_H;
      //var HI_START = tempHistart.toLocaleDateString();  //C14

      //HI_TYPE
      var HI_TYPE = 'F'           //=IF(C15="Free","F","")
      // SMI_DLAYD_ENRLT_RTP_CD
      var SMI_DLAYD_ENRLT_RTP_CD; //=IF(F4="",IF(AND(C44="SEP applies",C9<>"",C51="N/A"),"C",""),IF(C3>=C11,"S",""))
                                 // =IF(F4="",IF(AND(C44="SEP Applies",C9<>"",C51="N/A"),"C",""),IF(N15<> "","","S"))
      let temmedyear = (Batch_Run_Processed_Date.getFullYear() - DOBmedicare.getFullYear());
      let temmedmonth = (Batch_Run_Processed_Date.getMonth() - DOBmedicare.getMonth());
      if (String(F4.getFullYear()) === 'NaN')
         {
            if(C44 === 'SEP applies' && (String(C9.getFullYear()) !='NaN') && (String(C51.getFullYear()) ==='NaN'))
              {SMI_DLAYD_ENRLT_RTP_CD = 'CLIENT REQ/CHO';}
            else
              {SMI_DLAYD_ENRLT_RTP_CD = '';}
         }
      else
         {
            if(String(F4.getFullYear()) != "NaN")
            {
             if(C3.getTime() >= C11.getTime() && temmedyear >= 65)
               {SMI_DLAYD_ENRLT_RTP_CD = 'STATE BUY-IN';}
              else if(temmedmonth == 0 && temmedyear == 65){
                 SMI_DLAYD_ENRLT_RTP_CD = 'STATE BUY-IN';
             }
             else {SMI_DLAYD_ENRLT_RTP_CD = '';}
            }
            else
              {SMI_DLAYD_ENRLT_RTP_CD = '';}
         }


      let N19 = SMI_DLAYD_ENRLT_RTP_CD
      //SMI_ENRLPD_TYP_CD  =IF(F4="",IF(N19<>"S",IF(F1<>"R",IF(F1<>"D",IF(C21="Yes","I",IF(C26="GEP Applies","G",IF(C36="AEP Applies","A",IF(C44="SEP Applies","S","")))),""),"I"),""),IF(C3 <= C11,"I",""))
      var SMI_ENRLPD_TYP_CD;
      if(String(F4.getFullYear()) === 'NaN')
      {
       if (N19 != 'S') //IF(N19<>"S"
          {
             if(F1!= 'R') //IF(F1<>"R",
                {
                if(F1_1!= 'D') //IF(F1<>"D"
                      {
                         if(C21 === 'Yes') //IF(C21="Yes"
                            {SMI_ENRLPD_TYP_CD = 'I';}
                         else
                            {
                               if(C26 === "GEP Applies") //IF(C26="GEP Applies"
                                  {SMI_ENRLPD_TYP_CD = 'G';}
                               else
                                  {
                                     if(C36 === "AEP Applies")
                                     {SMI_ENRLPD_TYP_CD = 'A';}
                                     else
                                     {
                                        if(C44 === "SEP applies")
                                           {SMI_ENRLPD_TYP_CD = 'S';}
                                        else
                                           {SMI_ENRLPD_TYP_CD = '';}
                                     }
                                  }
                            }
                      }
                   else
                      {SMI_ENRLPD_TYP_CD = '';}
                }
             else
                {SMI_ENRLPD_TYP_CD = 'I';}
          }
       else
          {SMI_ENRLPD_TYP_CD = '';}
      }
    else
      {
         if(tempMedicaid.getTime() <= C11.getTime()) ///tempMedicaid = C3 day not 01
         if(temmedmonth == 0 && temmedyear == 65){
            SMI_ENRLPD_TYP_CD = '';
         }
         else if(temmedyear >= 65)
         {SMI_ENRLPD_TYP_CD = 'I';}
         else {SMI_ENRLPD_TYP_CD = '';}
      else
           {SMI_ENRLPD_TYP_CD = '';}
      }
      //SMI_START  //=IF(F1<>"R",IF(C21="Yes",C22,IF(C26="GEP Applies",C28,IF(C36="AEP Applies",C38,IF(AND(C44="SEP applies",C52<>"N/A"),C52,IF(AND(C44="SEP applies",C55<>"N/A"),C55,"N/A"))))),"N/A")
      var SMI_START
      let C22 = new Date(Determine_SMI_Start_with_IEP_Involved);
      let C28 = new Date(Determine_SMI_Start_with_GEP_Involved);
      let C38 = new Date(Determine_SMI_Start_with_AEP_Involved);
      if(F1!= 'R') //IF(F1<>"R",
       {
         if(F1_1!= 'D')
               if(C21 === 'Yes') //IF(C21="Yes"
               {
                  let COMDate = e2eConfig.COMDate;
                  if(F3 == 'G' && COMDate > ((C3.getMonth() + 1) + '-'+ C3.getFullYear())){SMI_START = COMDate.replace('-','/01/');}
                  else{SMI_START = C22;}
                }
               else
               {
                     if(C26 === "GEP Applies") //IF(C26="GEP Applies"
                        {SMI_START = C28;}
                     else
                        {
                           if(C36 === "AEP Applies") //IF(C36="AEP Applies"
                              {SMI_START = C38;}
                           else
                              {
                                 if(C44 === "SEP applies" && (String(C52.getFullYear()) != 'NaN')) //IF(AND(C44="SEP applies",C52<>"N/A")
                                 {SMI_START = C52;}
                                 else
                                 {
                                    if(C44 === "SEP applies" && (String(C55.getFullYear()) != 'NaN'))   //IF(AND(C44="SEP applies",C55<>"N/A")
                                       {SMI_START = C55}
                                    else
                                       {SMI_START = '';}
                                 }
                              }
                        }
               }
       else
        {SMI_START = '';}
       }
      else
         {SMI_START = '';}
      var tempSMI = new Date(SMI_START);
      if(String(tempSMI.getFullYear()) != 'NaN')
        {
         tempSMI.setDate(1);
         //SMI_START = tempSMI.toLocaleDateString();
         var dd_S = String(tempSMI.getDate()).padStart(2, '0');
         var mm_S = String(tempSMI.getMonth() + 1).padStart(2, '0'); //January is 0!
         var yyyy_S = tempSMI.getFullYear();
         SMI_START = mm_S + '/' + dd_S + '/' + yyyy_S;
        }
      else
        {SMI_START = '';}

      //SMPR_BRM   //=IF(F1="",IF(C32<>"N/A",C32,IF(C42<>"N/A",C42,"1.00")),"N/A")
      var SMPR_BRM;
      if(F1 === '' && F1_1 === '' ) //=IF(F1=""
        {
            if(C32 != '') //IF(C32<>"N/A"
               {SMPR_BRM = C32;}
            else
               {
                  if(C42 != '')  //IF(C42<>"N/A"
                     {SMPR_BRM = C42;}
                  else{SMPR_BRM = 1;}
               }
        }
      else
        {SMPR_BRM = 0}
      if(SMPR_BRM != 0){SMPR_BRM = SMPR_BRM.toFixed(2);}
      // HI_DLAYD_ENRLT_RTP_CD
      // SMI_NCVRG_RTP_CD  =IF(AND(F1<>"G",F1<>""),F1,"")
      var SMI_NCVRG_RTP_CD;
      if(F1 != 'R' && F1_1 != "" ) //IF(AND(F1<>"G",F1<>"")
        {SMI_NCVRG_RTP_CD = "DENIED";}
      else if(F1_1 != 'D' && F1 != "") {SMI_NCVRG_RTP_CD = "REFUSAL";}
      else {SMI_NCVRG_RTP_CD = "";}
      //Medicare Eligibility  Variables
      // let temp_Age_62 = new Date(C11);
      // var Attainment_Age_62;
      // //Chg_Age_62 = ((temp_Age_62.getMonth() + 1 ) + '/' + (temp_Age_62.getDate() - 1) + '/' + temp_Age_62.getFullYear());
      // temp_Age_62.setDate(temp_Age_62.getDate() - 1);
      // var dd_62 = String(temp_Age_62.getDate()).padStart(2, '0');
      // var mm_62 = String(temp_Age_62.getMonth() + 1).padStart(2, '0'); //January is 0!
      // var yyyy_62 = temp_Age_62.getFullYear();
      // Attainment_Age_62 = mm_62 + '/' + dd_62 + '/' + yyyy_62;
      //let Age_62 = new Date(this.dateFormat(Chg_Age_62));
     // let Age_62 = new Date(Age_62_Chg.toLocaleDateString())
     let CSA_Annuity = CSA_Annuity_IND;
     let Medicaid;
     if (String(F4.getFullYear()) != "NaN" ){Medicaid = "Y";}
     else{Medicaid = "";}
     let Crime_Type;
     if(F1_1 == 'D'){Crime_Type = "Y";}
     else{Crime_Type = "N"}
     let Payment_Method;let Third_Party;
     if(Medicaid == 'Y') {Payment_Method = 'State Buy In'; Third_Party = HI_START;}
     else if(CSA_Annuity == 'Y' && Medicaid == '' && C11.getFullYear() == C3.getFullYear() && C3.getMonth() <= C11.getMonth()) {Payment_Method = 'CSA Deduction'; Third_Party = SMI_START;}
     else{Payment_Method = "";Third_Party = "";}
     //GHP Data
     let Plan_Type; let Coverage_Start_Date; let Coverage_Stop_Date;
     if(Enrolled_in_GHP== 'Yes'){
        Plan_Type = GHP_Plan_Type;
        let ghpstmn = first_month_of_GHP.getMonth() + 1;
        if (ghpstmn <= 9){Coverage_Start_Date = '0' + ghpstmn + '/' + first_month_of_GHP.getFullYear();}
        else{Coverage_Start_Date =  ghpstmn + '/' + first_month_of_GHP.getFullYear();}
        if(String(last_month_of_GHP.getFullYear())!= 'NaN'){
           let ghpspmn = last_month_of_GHP.getMonth() + 1;
           if (ghpspmn <= 9){Coverage_Stop_Date = '0' + ghpspmn + '/' + last_month_of_GHP.getFullYear();}
           else{Coverage_Stop_Date =  ghpspmn + '/' + last_month_of_GHP.getFullYear();}
        }
        else
        {Coverage_Stop_Date = "Continuing";}
     }
     else{
        Plan_Type = "No information found.";
        Coverage_Start_Date = "";
        Coverage_Stop_Date = "";
     }

      // SMI_EQRLF_STUS_CD
      // SMI_NON_EQRLF_STMDT
      //SMPR_BRM = SMPR_BRM
      // console.log('HI_START: ' + HI_START);
      // console.log('HI_TYPE: ' + HI_TYPE);
      // console.log('SMI_ENRLPD_TYP_CD: ' + SMI_ENRLPD_TYP_CD);
      // console.log('SMI_START: ' + SMI_START);
      // console.log('SMPR_BRM: ' + SMPR_BRM);
      //Calculations
      /*console.log('Determine_Age_65_DOB: ' + Determine_Age_65_DOB);
      console.log('Age_65_attainment_deemed_DOB : ' + Age_65_attainment_deemed_DOB);
      console.log('Determine_First_Eligibility_Date_HI_Dealy: ' + Determine_First_Eligibility_Date_HI_Dealy);
      console.log('Determine_HI_Start: ' + Determine_HI_Start);
      console.log('Determine_HI_Type: ' + Determine_HI_Type);
      console.log(C18 + ' : ' + D18 + ' : ' + E18 + ' : ' + F18 + ' : ' + G18 + ' : ' + H18 + ' : ' + I18);
      console.log(C19 + ' : ' + D19 + ' : ' + E19 + ' : ' + F19 + ' : ' + G19 + ' : ' + H19 + ' : ' + I19);
      console.log(C20 + ' : ' + D20 + ' : ' + E20 + ' : ' + F20 + ' : ' + G20 + ' : ' + H20 + ' : ' + I20);
      console.log('Determine_if_IEP_Applies: ' + Determine_if_IEP_Applies);
      console.log('Determine_SMI_Start_with_IEP_Involved: ' + Determine_SMI_Start_with_IEP_Involved);
      console.log('Determine_if_GEP_without_GHP_Applies: ' + Determine_if_GEP_without_GHP_Applies);
      console.log('Determine_if_GEP_with_GHP_Applies: ' + Determine_if_GEP_with_GHP_Applies);
      console.log('Determine_if_GEP_Applies: ' +Determine_if_GEP_Applies);
      console.log('Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP: ' +Determine_Last_Non_IEP_Enrollment_Period_Month_for_GEP);
      console.log('Determine_SMI_Start_with_GEP_Involved: ' +Determine_SMI_Start_with_GEP_Involved);
      console.log('Determine_Premium_Surcharge_Countable_Months: ' + Determine_Premium_Surcharge_Countable_Months);
      console.log('Determine_exclusion_months_from_GHP: ' + Determine_exclusion_months_from_GHP);
      console.log('Determine_final_premium_surcharge_countable_months: ' + Determine_final_premium_surcharge_countable_months);
      console.log('Determine_Premium_Surcharge_Number_BRM_12Months: ' + Determine_Premium_Surcharge_Number_BRM_12Months);
      console.log('Determine_if_AEP_without_GHP_Applies: ' +Determine_if_AEP_without_GHP_Applies);
      console.log('Determine_if_AEP_with_GHP_Applies: ' +Determine_if_AEP_with_GHP_Applies);
      console.log('Determine_if_AEP_applies: ' +Determine_if_AEP_applies);
      console.log('Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP: ' +Determine_Last_Non_IEP_Enrollment_Period_Month_for_AEP);
      console.log('Determine_SMI_Start_with_AEP_Involved: ' +Determine_SMI_Start_with_AEP_Involved);
      console.log('Determine_Premium_Surcharge_Countable_Months_AEP: ' + Determine_Premium_Surcharge_Countable_Months_AEP);
      console.log('Determine_exclusion_months_from_GHP_AEP: ' + Determine_exclusion_months_from_GHP_AEP);
      console.log('Determine_final_premium_surcharge_countable_months_AEP: ' + Determine_final_premium_surcharge_countable_months_AEP);
      console.log('Determine_Premium_Surcharge_Number_BRM_12Months_AEP: ' + Determine_Premium_Surcharge_Number_BRM_12Months_AEP);
      console.log('Determine_if_SEP_Applies: ' + Determine_if_SEP_Applies);
      console.log('Determine_if_SEP_rules_can_Apply_if_GHP_ended: ' + Determine_if_SEP_rules_can_Apply_if_GHP_ended);
      console.log(C46 + ' : ' + D46 + ' : ' + E46 + ' : ' + F46 + ' : ' + G46 + ' : ' + H46 + ' : ' + I46 + ' : ' + J46 + ' : ' + K46 + ' : ' + L46  + ' : ' + M46);
      console.log(C47 + ' : ' + D47 + ' : ' + E47);
      console.log(C48 + ' : ' + D48 + ' : ' + E48);
      console.log(C49 + ' : ' + D49 + ' : ' + E49);
      console.log(C50 + ' : ' + D50 + ' : ' + E50);
      console.log('Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended: ' + Determine_Mandatory_SMI_Start_with_SEP_Involved_5thMonth_GHPended);
      console.log('Determine_final_SEP_start_month: ' + Determine_final_SEP_start_month);
      console.log('Determine_if_SEP_rules_can_Apply_if_GHP_not_ended: ' + Determine_if_SEP_rules_can_Apply_if_GHP_not_ended);
      console.log('Determine_SEP_Months_if_GHP_not_ended:' + C54 + ' : ' + D54 + ' : ' + E54 + ' : ' + F54);
      console.log('Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended: ' + Check_if_user_chosen_month_is_any_of_SEP_months_with_GHP_not_ended);*/
      return [HI_START,HI_TYPE,SMI_ENRLPD_TYP_CD,SMI_START,SMPR_BRM,SMI_NCVRG_RTP_CD,SMI_DLAYD_ENRLT_RTP_CD,Payment_Method,CSA_Annuity,Medicaid,Crime_Type,Third_Party,Plan_Type,Coverage_Start_Date,Coverage_Stop_Date];
}
}
