/**
 * Optional scenario context for app-specific data (e.g. DOB for date placeholders).
 * Apps can set these; generic steps use defaults when not set.
 */
export class ScenarioContext {
    private static _dob: Date | null = null;

    static setDob(dob: Date | null) {
        this._dob = dob;
    }

    static getDob(): Date | null {
        return this._dob;
    }

    static reset() {
        this._dob = null;
    }
}
