/**
 * Dropdown helper: works with native <select> and custom dropdowns (ul/li, role="listbox", etc.)
 * so the same step "selects X from Y Drop-down list" works across different websites.
 */

const DEFAULT_OPTION_WAIT_MS = 1500;

/** Escape a string for use inside XPath single-quoted string (double single quotes). */
function escapeXPathString(s: string): string {
    return (s ?? '').replace(/'/g, "''");
}

/**
 * Select an option by visible text from a native HTML <select>.
 * Tries selectByVisibleText first; if that fails, tries selectByAttribute('value', optionVal).
 */
async function selectNativeSelect(element: WebdriverIO.Element, optionVal: string): Promise<void> {
    const tagName = await element.getTagName();
    if ((tagName || '').toLowerCase() !== 'select') {
        throw new Error(`DropdownHelper: expected <select> but got <${tagName}>`);
    }
    try {
        await element.selectByVisibleText(optionVal);
        return;
    } catch {
        // Fallback: match by value (e.g. option value="north" when text is "North")
        try {
            await element.selectByAttribute('value', optionVal);
            return;
        } catch {
            // Last resort: try visible text with normalized whitespace (some sites use &nbsp; etc.)
            const opts = await element.$$('option');
            for (const opt of opts) {
                const text = (await opt.getText() || '').trim();
                if (text === optionVal || text.includes(optionVal)) {
                    await opt.click();
                    return;
                }
            }
        }
    }
    throw new Error(`DropdownHelper: could not select option "${optionVal}" in native select`);
}

/**
 * Find and click an option (by visible text) inside a list container: ul, ol, or [role="listbox"].
 * Used when the locator points to the options container (e.g. "Option List" = ul).
 */
async function selectFromListContainer(element: WebdriverIO.Element, optionVal: string, timeoutMs: number): Promise<void> {
    const escaped = escapeXPathString(optionVal);
    const xpath = `.//*[self::li or self::option or @role="option"][normalize-space(.)='${escaped}' or contains(normalize-space(.), '${escaped}')]`;
    const option = await element.$(xpath);
    await option.waitForDisplayed({ timeout: timeoutMs, reverse: false });
    await option.click();
}

/**
 * Open a custom dropdown (click trigger) then find and click the option in the page.
 * Used when the locator points to the trigger (button/div); options appear in overlay/sibling.
 */
async function selectFromCustomDropdownTrigger(element: WebdriverIO.Element, optionVal: string, timeoutMs: number): Promise<void> {
    await element.waitForDisplayed({ timeout: timeoutMs });
    await element.click();
    await browser.pause(500);
    const escaped = escapeXPathString(optionVal);
    const xpath = `//*[self::li or self::option or @role="option"][normalize-space(.)='${escaped}' or contains(normalize-space(.), '${escaped}')]`;
    const option = await browser.$(xpath);
    await option.waitForDisplayed({ timeout: timeoutMs, reverse: false });
    await option.click();
}

/**
 * Checks whether a native <select> contains an option with the given visible text,
 * without selecting it.
 */
async function nativeSelectHasOption(element: WebdriverIO.Element, optionVal: string): Promise<boolean> {
    const opts = await element.$$('option');
    for (const opt of opts) {
        const text = (await opt.getText() || '').trim();
        if (text === optionVal || text.includes(optionVal)) return true;
    }
    return false;
}

/** Checks a list container (ul/ol/[role=listbox]) for a matching option, without clicking it. */
async function listContainerHasOption(element: WebdriverIO.Element, optionVal: string, timeoutMs: number): Promise<boolean> {
    const escaped = escapeXPathString(optionVal);
    const xpath = `.//*[self::li or self::option or @role="option"][normalize-space(.)='${escaped}' or contains(normalize-space(.), '${escaped}')]`;
    const option = element.$(xpath);
    return await option.waitForDisplayed({ timeout: timeoutMs, reverse: false }).then(() => true).catch(() => false);
}

/** Opens a custom dropdown trigger, checks for a matching option, then closes it back up. */
async function customDropdownTriggerHasOption(element: WebdriverIO.Element, optionVal: string, timeoutMs: number): Promise<boolean> {
    await element.waitForDisplayed({ timeout: timeoutMs });
    await element.click();
    await browser.pause(500);
    const escaped = escapeXPathString(optionVal);
    const xpath = `//*[self::li or self::option or @role="option"][normalize-space(.)='${escaped}' or contains(normalize-space(.), '${escaped}')]`;
    const option = browser.$(xpath);
    const found = await option.waitForDisplayed({ timeout: timeoutMs, reverse: false }).then(() => true).catch(() => false);
    // Close the panel back up without selecting anything.
    await browser.keys('Escape').catch(() => {});
    return found;
}

export class DropDownHelper {
    static selectOptionByVal(locator: WebdriverIO.Element, optionVal: string): void {
        locator.$(this.getCssForOptionValue(optionVal)).click();
    }

    static getXPathForOptionValue(optionVal: string): string {
        return `//option[normalize-space(.)="${optionVal}"]`;
    }

    static getCssForOptionValue(optionVal: string): string {
        return `option[value="${optionVal}"]`;
    }

    /**
     * Select option by visible text. Works for:
     * - Native <select>: uses selectByVisibleText (with value fallback).
     * - Options container (ul, ol, [role="listbox"]): finds child by text and clicks.
     * - Custom trigger (div/button): clicks to open, then finds and clicks option in page.
     */
    static async selectOptionByText(
        locator: WebdriverIO.Element,
        optionVal: string,
        optionWaitTimeoutMs: number = DEFAULT_OPTION_WAIT_MS
    ): Promise<void> {
        await locator.waitForDisplayed({ timeout: optionWaitTimeoutMs, reverse: false });
        const tagName = (await locator.getTagName() || '').toLowerCase();
        const role = (await locator.getAttribute('role') || '').toLowerCase();

        if (tagName === 'select') {
            await selectNativeSelect(locator, optionVal);
            return;
        }

        if (tagName === 'ul' || tagName === 'ol' || role === 'listbox') {
            await selectFromListContainer(locator, optionVal, optionWaitTimeoutMs);
            return;
        }

        await selectFromCustomDropdownTrigger(locator, optionVal, optionWaitTimeoutMs);
    }

    /**
     * Checks whether the dropdown contains an option with the given visible text,
     * WITHOUT selecting it. Mirrors selectOptionByText's native/list/custom-trigger
     * branching; custom dropdowns get opened to check, then closed back via Escape.
     */
    static async hasOption(
        locator: WebdriverIO.Element,
        optionVal: string,
        optionWaitTimeoutMs: number = DEFAULT_OPTION_WAIT_MS
    ): Promise<boolean> {
        await locator.waitForDisplayed({ timeout: optionWaitTimeoutMs, reverse: false });
        const tagName = (await locator.getTagName() || '').toLowerCase();
        const role = (await locator.getAttribute('role') || '').toLowerCase();

        if (tagName === 'select') {
            return await nativeSelectHasOption(locator, optionVal);
        }

        if (tagName === 'ul' || tagName === 'ol' || role === 'listbox') {
            return await listContainerHasOption(locator, optionVal, optionWaitTimeoutMs);
        }

        return await customDropdownTriggerHasOption(locator, optionVal, optionWaitTimeoutMs);
    }

    static async selectDropdownByNumber(element: WebdriverIO.Element, index: number): Promise<void> {
        const options = await element.$$('<option />');
        if (options[index]) await options[index].click();
    }

    static async selectOption(element: WebdriverIO.Element, item: string): Promise<void> {
        await element.click();
        const options = await element.$$('<option />');
        for (const option of options) {
            const text = await option.getText();
            if (text === item) {
                await option.click();
                return;
            }
        }
    }
}
