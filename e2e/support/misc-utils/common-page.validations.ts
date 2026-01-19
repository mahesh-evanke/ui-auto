export class CommonPageValidations {
    static readonly dataSortedInAscendingOrder = `data should be sorted in ascending order`;
    static readonly dataSortedInDescendingOrder = `data should be sorted in descending order`;
    static readonly shouldBeGreaterThan = `number should be greater than`;
    static readonly shouldBeVisible = `should be visible`;
    static readonly shouldBeClickable = `should be clickable`;
    static readonly shouldBeEqualTo = `string should be equal to`;

    static numberShouldBeGreaterThan(number: number) {
        return `${this.shouldBeGreaterThan} ${number}`;
    }

    static stringShouldBeEqualTo(text: string) {
        return `${this.shouldBeEqualTo} ${text}`;
    }
}
