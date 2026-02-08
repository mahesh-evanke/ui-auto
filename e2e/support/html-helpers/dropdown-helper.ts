import type { ElementLike } from './element-helper';

export class DropDownHelper {
    static selectOptionByVal(locator: ElementLike, optionVal: string) {

        locator.$(this.getCssForOptionValue(optionVal)).click();

    }

    static getXPathForOptionValue(optionVal: string) {
        return `//option[normalize-space(.)="${optionVal}"]`;
    }

    static getCssForOptionValue(optionVal: string) {
        return `option[value="${optionVal}"]`;
    }

    static async selectOptionByText(locator: ElementLike, optionVal: string) {
        await locator.selectByVisibleText(optionVal);
    }

    static selectDropdownByNumber(element: ElementLike, index: number) {

        element.$('<option />')
            .then(function (options) {
                options[index].click();
            });
    }

    static selectOption(element: ElementLike, item: string) {
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
