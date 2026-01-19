import {readFileSync} from 'fs';
import {parse} from 'papaparse';

export class DataClass
{

    getData(scenario:string):any
    {
        const file = readFileSync('./e2e/support/testdata/testData.csv', 'utf8');
        const dataArray: string[][] = [];
        const dataArray2: string[][] = [];
        const createCsvWriter = require('csv-writer').createObjectCsvWriter;

        const csvWriter = createCsvWriter
        ({
            path: './e2e/support/testdata/testData.csv',
            Default:true,
            header: [
                {id: 'scenarioID', title: 'scenarioID'},
                {id: 'ssn', title: 'ssn'},
                {id: 'dum1', title: 'dum1'},
                {id: 'dum2', title: 'dum2'},
                {id: 'address', title: 'address'},
                {id: 'country', title: 'country'},
                {id: 'status', title: 'status'}
            ]
        });

        parse(file, {
            header: true,
            complete: function(results)
            {
                var flag:Number = 0;
                for(var i = 0; i < results.data.length; i++ ){
                    var parsedObj: any = results.data[i]
                    if(parsedObj.scenarioID === scenario && parsedObj.status === '' && flag === 0){
                        flag = 1;
                        parsedObj.status = 'used';
                        dataArray.push(parsedObj);
                        dataArray2.push(parsedObj)
                   }
                    else{
                        dataArray2.push(parsedObj);
                    }
                }
                var record = dataArray2
                csvWriter.writeRecords(record).then(function(){ console.log('record is written')});
            }
        })
        return dataArray
    }
}
