import { readFileSync } from 'fs';
import { parse } from 'papaparse';
const spawn = require('child_process').spawnSync;
import * as path from 'path';
import * as  fs from 'fs';
const e2eConfig = require('js-yaml').load(fs.readFileSync('e2e/config/config.yaml', 'utf8'));

export class CSVReader {
    static getData(scenario: string, purgeInd = 'Y'): any {
        const file = readFileSync(e2eConfig.testDataDir + e2eConfig.appName + "_TestData.csv", 'utf8');
        var regionNames, database;
        if (e2eConfig.environment.toUpperCase() == "VAL")
            database = e2eConfig.valDB;
        else
            database = e2eConfig.devDB;
        if (e2eConfig.region.toUpperCase() == "PROD")
            regionNames = e2eConfig.databases;
        else
            regionNames = e2eConfig.databasesftr;
        let results = parse(file, {
            header: true
        });
        for (var i = 0; i < results.data.length; i++) {
            var parsedObj: any = results.data[i]
            if (parsedObj.Test_Data_Criteria === scenario && parsedObj.Used === 'N') {
                if (parsedObj.Purge === 'Y' && purgeInd == 'Y') {
                    //console.log(browser.params.execEnv);

                    let dirPath = path.resolve('e2e/support/misc-utils/CCEDelete.vbs');
                    let vbsProc = spawn('cscript.exe', [dirPath, database, regionNames, parsedObj.SSN, parsedObj.Medicare_Purge]);
                    if (vbsProc.stderr.toString() != "")
                        console.log(`stderr: ${vbsProc.stderr.toString()}`);
                    //console.log(`stdout: ${vbsProc.stdout.toString()}`);
                    if (vbsProc.status != 0)
                        console.log(`status: ${vbsProc.status}`);
                }
                return parsedObj.SSN;
            }
        }
    }
    static getDataWithSSN(ssn: string) {
        const file = readFileSync('./e2e/support/testData/TestData.csv', 'utf8');
        let results = parse(file, {
            header: true
        });
        for (var i = 0; i < results.data.length; i++) {
            var parsedObj: any = results.data[i]
            if (parsedObj.SSN === ssn && parsedObj.Used === 'N') {
                if (parsedObj.Purge === 'Y') {
                    //console.log(browser.params.execEnv);
                    let dirPath = path.resolve('e2e/support/testData/CCEDelete.vbs');
                    let vbsProc = spawn('cscript.exe', [dirPath, global.environment, parsedObj.SSN, parsedObj.Medicare_Purge, global.region]);
                    if (vbsProc.stderr.toString() != "")
                        console.log(`stderr: ${vbsProc.stderr.toString()}`);
                    console.log(`stdout: ${vbsProc.stdout.toString()}`);
                    if (vbsProc.status != 0)
                        console.log(`status: ${vbsProc.status}`);
                }
                return parsedObj.SSN;
            }
        }
    }
}
