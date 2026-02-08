import type { ElementLike } from './element-helper';

export class DropDownHelper {
    static selectOptionByVal(locator: ElementLike, optionVal: string) {
        const loc = locator as { $(selector: string): { click(): Promise<void> } };
        loc.$(DropDownHelper.getCssForOptionValue(optionVal)).click();

    }

    static getXPathForOptionValue(optionVal: string) {
        return `//option[normalize-space(.)="${optionVal}"]`;
    }

    static getCssForOptionValue(optionVal: string) {
        return `option[value="${optionVal}"]`;
    }

    static async selectOptionByText(locator: ElementLike, optionVal: string) {
        await (locator as { selectByVisibleText(text: string): Promise<void> }).selectByVisibleText(optionVal);
    }

    static async selectDropdownByNumber(element: ElementLike, index: number) {
        const options = await (element as any).$$('<option />');
        const el = await options[index];
        if (el) await el.click();
    }

    static async selectOption(element: ElementLike, item: string) {
        const el = element as any;
        await el.click();
        const options = await el.$$('<option />');
        let desiredOption: { click(): Promise<void> } | undefined;
        const len = await options.length;
        for (let i = 0; i < len; i++) {
            const option = await options[i];
            const text = await option.getText();
            if (item === text) {
                desiredOption = option;
                break;
            }
        }
        if (desiredOption) await desiredOption.click();
    }
}
