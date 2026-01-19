
export class DropDownHelper {
    static selectOptionByVal(locator: WebdriverIO.Element, optionVal: string) {

        locator.$(this.getCssForOptionValue(optionVal)).click();

    }

    static getXPathForOptionValue(optionVal: string) {
        return `//option[normalize-space(.)="${optionVal}"]`;
    }

    static getCssForOptionValue(optionVal: string) {
        return `option[value="${optionVal}"]`;
    }

    static async selectOptionByText(locator: WebdriverIO.Element, optionVal: string) {
        await locator.selectByVisibleText(optionVal);
    }

    static selectDropdownByNumber(element: WebdriverIO.Element, index: number) {

        element.$('<option />')
            .then(function (options) {
                options[index].click();
            });
    }

    static selectOption(element: WebdriverIO.Element, item: string) {
        var desiredOption;
        element.click();
        element.$$('<option />')
            .then(function findMatchingOption(options) {
                options.forEach(function (option) {
                    option.getText().then(function doesOptionMatch(text) {
                        if (item === text) {
                            desiredOption = option;
                            return true;
                        }
                    });
                });
            })
            .then(function clickOption() {
                if (desiredOption) {
                    desiredOption.click();
                }
            });
    }
}
