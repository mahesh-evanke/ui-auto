export class TableHelper {
    // webtable
    private static webTable: WebdriverIO.Element;
    //constructor  accepts dropdown as element
    public static async setwebtableElement(webTableElement: WebdriverIO.Element) {
        this.webTable = webTableElement;
    }

    // get the number of rows present
    public static async getRowCount() {
        console.log("Fetching number rows")
        return await this.webTable.$$('<tr />');
    }

    // get the number of columns present
    public static async getColumnCount() {
        return (await this.webTable.$$('<th />')).length;
        // if you donot have header then above will not work
        // use this if no headre is there
        // return this.webTable.all(by.xpath("//tr[0]/td")).count()
    }

    // get the number of rows and columns and return it as Map
    public static async getTableSize() {
        let tr: Number = (await this.webTable.$$('<tr />')).length;
        let th: Number = (await this.webTable.$$('<th />')).length;
        return { tr, th };
    }

    // get row data and return it as list
    public static async rowData(rowNumber: number) {
        //if(rowNumber == 0){
        //    throw new Error("Row number starts from 1");
        //}
        rowNumber = rowNumber + 1;
        //*[@id="insuredstatus"]/div/div[2]/uef-resize-observer/table

        return await $$("//tr[" + rowNumber + "]/td").map((result) => {
            return result.getText();
        });
        //return element(by.xpath("//table[@id='periodinsuredstatus']/tr["+rowNumber+"]/td")).getText();
    }

    // get the column data and return as list
    public static async columnData(columnNumber: number) {
        if (columnNumber == 0) {
            throw new Error("Column number starts from 1");
        }
        columnNumber = columnNumber + 1;
        return await $$("//tr/td[" + columnNumber + "]").map((result) => {
            return result.getText();
        });
    }

    // get all the data from the table
    public static async getAllData() {
        //let output=await this.webTable.all(by.xpath("td")).getText();
        return await $$("<td/>").map((result) => {
            return result.getText();
        });
    }

    // verify presence of the text/data
    public static async presenceOfData(data: string) {
        // verify the data by getting the size of the element matches based on the text/data passed
        return await (this.webTable.$$("//td[normalize-space(text())='" + data + "']")).length.then(function (dataSize: number) {
            if (dataSize > 0) {
                return true;
            }
            else {
                return false
            }
        })
    }
    // get the data from a specific cell
    public static async getCellData(rowNumber: number, columnNumber: number) {
        if (rowNumber == 0) {
            throw new Error("Row number starts from 1");
        }
        rowNumber = rowNumber + 1;
        return await $$("//tr[" + rowNumber + "]/td[" + columnNumber + "]").map((result) => {
            return result.getText();
        });
    }
    // click checkbox with protractor
    public static async clickCheckBox(data: string) {
        await (this.webTable.$("//td[normalize-space(text())='" + data + "']/..//input")).click()
    }
}
