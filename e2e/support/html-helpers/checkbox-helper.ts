import { Constants } from '../misc-utils/constants';
import { ElementHelper } from './element-helper';
import { WaitHelper } from './wait-helper';

export class CheckboxHelper {
    static async markCheckbox(elementt: WebdriverIO.Element, markChecked: boolean) {
        let attempts = 0;
        while (attempts++ < Constants.MAX_RETRY_ATTEMPTS) {
            const isSelected = await elementt.isSelected();
            if ((isSelected && !markChecked) || (!isSelected && markChecked)) {
                const clickable = await ElementHelper.getClickableTargetForRadioOrCheckbox(elementt);
                await WaitHelper.getInstance().waitForElementToBeClickable(clickable);
                return clickable.click();
            }
        }
        return;
    }

    static async markCheckboxWithWaitDisplay(elementt: WebdriverIO.Element, markChecked: boolean) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(elementt);
        let attempts = 0;
        while (attempts++ < Constants.MAX_RETRY_ATTEMPTS) {
            const isSelected = await elementt.isSelected();
            if ((isSelected && !markChecked) || (!isSelected && markChecked)) {
                const clickable = await ElementHelper.getClickableTargetForRadioOrCheckbox(elementt);
                await WaitHelper.getInstance().waitForElementToBeClickable(clickable);
                await clickable.click();
                return;
            }
        }
        return;
    }
}
