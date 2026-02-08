import type { ElementLike } from './element-helper';
import { Constants } from '../misc-utils/constants';
import { WaitHelper } from './wait-helper';

export class CheckboxHelper {
    static async markCheckbox(elementt: ElementLike, markChecked: boolean) {
        //await WaitHelper.getInstance().waitForElementToBeClickable(elementt);
        let attempts = 0;
        while (attempts++ < Constants.MAX_RETRY_ATTEMPTS) {
            const isSelected = await elementt.isSelected();
            if ((isSelected && !markChecked) || (!isSelected && markChecked)) {
                return await elementt.$('./..').click();
            }
        }
        return;
    }

    static async markCheckboxWithWaitDisplay(elementt: ElementLike, markChecked: boolean) {
        await WaitHelper.getInstance().waitForElementToBeDisplayed(elementt);
        let attempts = 0
        while (attempts++ < Constants.MAX_RETRY_ATTEMPTS) {
            const isSelected = await elementt.isSelected();
            if ((isSelected && !markChecked) || (!isSelected && markChecked)) {
                let clickElem = await elementt.$('./..');
                await WaitHelper.getInstance().waitForElementToBeClickable(clickElem);
                await clickElem.click();
            }
        }
        return;
    }
}
