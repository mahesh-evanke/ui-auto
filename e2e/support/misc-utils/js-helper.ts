export class JsHelper {
    static trimArray(arr: string[]) {
        for (let index = 0; index < arr.length; index++) {
            arr[index] =
                arr[index]
                    .replace(/^\s\s*/, '')
                    .replace(/\s\s*$/, '');
        }
        return arr;
    }
}
