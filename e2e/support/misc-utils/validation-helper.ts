export class ValidationsHelper {
    static get types(){
        return {
            field:  'Field',
            page:  'Page',
            button:  'Button',
            label:  'Label',
            grid:  'Grid',
        };
    }

    static getFieldShouldValueValidation(fieldLabel: string, value: string) {
        return `${this.types.field} ${fieldLabel} should have value as ${value}`;
    }

    static getPageDisplayedValidation(name: string) {
        return `${this.types.page} ${this.getDisplayedValidation(name)}`;
    }

    static getFieldDisplayedValidation(name: string) {
        return `${this.types.field} ${this.getDisplayedValidation(name)}`;
    }

    static getButtonDisplayedValidation(name: string) {
        return `${this.types.button} ${this.getDisplayedValidation(name)}`;
    }

    static getLabelDisplayedValidation(name: string) {
        return `${this.types.label} ${this.getDisplayedValidation(name)}`;
    }

    static getGridDisplayedValidation(name: string) {
        return `${this.types.grid} ${this.getDisplayedValidation(name)}`;
    }

    static getDeletionConfirmationDisplayedValidation(recordText: string) {
        return `Confirmation box for deletion of record which contains ${this.getDisplayedValidation(recordText)}`;
    }

    static getRecordDeletedValidation(recordText: string) {
        return `Record which contains ${recordText} has been deleted`;
    }

    static getDisplayedValidation(name: string) {
        return `${name} should be displayed`;
    }

    static getErrorDisplayedValidation(error: string) {
        return `Error ${error} should be displayed`;
    }
}
