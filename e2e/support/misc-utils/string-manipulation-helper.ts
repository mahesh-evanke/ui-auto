export class StringManipulationHelper {

    static replaceLineBreaks(string: string): string {
        return string.replace(/(\r\n|\n|\r)/gm, " ");
    }

    static verifyTwoStringIncluded(longString: string, shortString: string): boolean {
        longString = this.removeSepecial(longString);
        shortString = this.removeSepecial(shortString);
        return longString.includes(shortString);
    }

    static removeSepecial(input: string): string | undefined {
        if (input == undefined) return undefined;
        let regex = /(\r\n|\n|\r|\\n|\\r| )/g;
        let regex2 = /[^a-zA-Z0-9]/g;
        return input.replace(regex, "").replace(regex2, "");
    }

    static createRandomString(length: number): string {
        for (var s = ''; s.length < length; s += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.random() * 62 | 0));
        return s;
    }

}
