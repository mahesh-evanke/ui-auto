

export class PSCHelper {

    public static getHelper(ssn: string, disablity: string = "", address: string = ""): number {
        if (this.isForeignAddress(address)) {
            return 8;
        } else if (this.isDisabled(disablity)) {
            return 7;
        } else {
            const areaCode: number = Number.parseInt(ssn.substring(0, 3));
            switch (true) {
                case this.isInArea(areaCode, 0, 134):
                case areaCode == 729:
                case this.isInArea(areaCode, 805, 808):
                    return 1;
                case this.isInArea(areaCode, 135, 222):
                case this.isInArea(areaCode, 232, 236):
                case this.isInArea(areaCode, 577, 584):
                case this.isInArea(areaCode, 596, 599):
                case this.isInArea(areaCode, 691, 699):
                case this.isInArea(areaCode, 809, 826):
                    return 2;
                case this.isInArea(areaCode, 223, 231):
                case this.isInArea(areaCode, 237, 267):
                case this.isInArea(areaCode, 400, 428):
                case this.isInArea(areaCode, 587, 595):
                case this.isInArea(areaCode, 654, 658):
                case this.isInArea(areaCode, 667, 675):
                case this.isInArea(areaCode, 681, 690):
                case areaCode == 730:
                case this.isInArea(areaCode, 752, 763):
                case this.isInArea(areaCode, 766, 804):
                    return 3;
                case this.isInArea(areaCode, 268, 302):
                case this.isInArea(areaCode, 316, 399):
                case this.isInArea(areaCode, 700, 728):
                case areaCode == 731:
                    return 4;
                case this.isInArea(areaCode, 501, 504):
                case this.isInArea(areaCode, 516, 524):
                case this.isInArea(areaCode, 526, 576):
                case areaCode == 586:
                case this.isInArea(areaCode, 600, 626):
                case this.isInArea(areaCode, 646, 647):
                case this.isInArea(areaCode, 650, 653):
                case areaCode == 680:
                case this.isInArea(areaCode, 733, 751):
                case this.isInArea(areaCode, 764, 765):
                case this.isInArea(areaCode, 827, 867):
                    return 5;
                case this.isInArea(areaCode, 303, 315):
                case this.isInArea(areaCode, 429, 500):
                case this.isInArea(areaCode, 505, 515):
                case areaCode == 525:
                case areaCode == 585:
                case this.isInArea(areaCode, 627, 645):
                case this.isInArea(areaCode, 648, 649):
                case this.isInArea(areaCode, 659, 665):
                case this.isInArea(areaCode, 676, 679):
                case areaCode == 732:
                case this.isInArea(areaCode, 868, 899):
                    return 6;
                default:
                    return 0;
            }
        }
    }

    private static isInArea(checkingNumber: number, lowerEqual: number, upperEqual: number): boolean {
        if (checkingNumber >= lowerEqual && checkingNumber <= upperEqual) {
            return true;
        }

        return false;
    }
    private static isDisabled(disablity: string): boolean {
        return false;
    }

    private static isForeignAddress(address: string): boolean {
        return false;
    }

}
