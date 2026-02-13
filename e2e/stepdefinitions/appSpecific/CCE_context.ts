/**
 * CCE/Medicare app-specific context. Populated by CCE steps (GoToPage, etc.).
 * Keeps app-specific state out of generic web_actions_stepdefs.
 */
import { EnrollCalcInput } from './EnrollCalcInput';
import { PageVariables } from '../../support/misc-utils/PageVariables';
import { ScenarioContext } from '../../support/misc-utils/ScenarioContext';

export const enrollCalc = new EnrollCalcInput();
export const pageVariables = new PageVariables();
export let enrollCalcOutput: any;

export function setEnrollCalcOutput(val: any) {
    enrollCalcOutput = val;
}

export function syncDobToScenarioContext() {
    const dob = enrollCalc.dob;
    ScenarioContext.setDob(typeof dob === 'string' ? new Date(dob) : dob);
}
    
export function resetEnrollCalc() {
    enrollCalc.dob = undefined;
    enrollCalc.filingDate = undefined;
    enrollCalc.firstMonthInsured = undefined;
}
    