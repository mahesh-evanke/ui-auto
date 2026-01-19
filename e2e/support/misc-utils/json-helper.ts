import * as fs from 'fs';
import * as path from 'path';

export class JsonHelper {
    filepath_Success: string;
    // @ts-ignore
    public getAllFiles(fileName: string, dirPath: string): string {
        // @ts-ignore
        fs.readdirSync(dirPath).forEach( function(file: string): string  {
            const filepath = path.join(dirPath , file);
            const stat =  fs.lstatSync(filepath);
            if ( stat.isDirectory()) {
                this.getAllFiles(fileName, filepath);
            } else {
                if ((file.localeCompare(fileName)) === 0 ) {
                    this.filepath_Success = path.join(dirPath, file);
                }
            }
        });
        return this.filepath_Success;
    }

   static getElement(fileName: string, elementStr: string): string {
        const jsonData = require(fileName);
        return jsonData[elementStr];
    }

    static getPage(fileName: string, pageStr: string): string {
        const jsonData = require(fileName);
        return jsonData[pageStr];
    }
}
