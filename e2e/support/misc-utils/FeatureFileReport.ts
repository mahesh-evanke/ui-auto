const glob = require("glob")
const fs = require('fs');
const { parseFeatureFile } = require("./gherkin-parser");

export class FeatureFileReport {
    private addIncludedFile(fileContent: string, tagName: string, fileName: string, includedFile: string[]) {
        if (fileContent.includes(tagName)) {
            includedFile.push(fileName);
        }
        return includedFile;
    }

    private addTagcount(eachLine: string, result: any[]) {
        let eachWorlds = eachLine.split(/[ \t]/)
        eachWorlds.forEach(eachWorld => {
            eachWorld = eachWorld.trim();
            if (eachWorld.startsWith('@')) {
                if (eachWorld in result) {
                    result[eachWorld] = result[eachWorld] + 1;
                } else {
                    result[eachWorld] = 1;
                }
            }
        });
        return result;
    }
    private eachFile(filePath: string, result: {}, tagNames: string[], fileNum: number) {

        result["fileInfo"][fileNum] = {};
        result["fileInfo"][fileNum]['filePath'] = filePath;
        result["fileInfo"][fileNum]['scenario'] = {};
        const parsed = parseFeatureFile(filePath);
        result["fileInfo"][fileNum]['feature'] = (parsed.featureName || '').trim();
        result["fileInfo"][fileNum]['tags'] = ''
        let fileTag = [];
        if (parsed.featureTags && parsed.featureTags.length > 0) {
            parsed.featureTags.forEach((t: string) => fileTag.push(t));
            result["fileInfo"][fileNum]['tags'] = fileTag.join(' ');
            result["fileInfo"][fileNum]['getTagCount'] = this.getTagCount(tagNames, result["fileInfo"][fileNum]['tags']);
        }
        let scenarioNum = 0;
        parsed.scenarios.forEach((eachScenario: any) => {
            scenarioNum++;
            result["fileInfo"][fileNum]['scenario'][scenarioNum] = {};
            result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioName'] = eachScenario['name'];
            result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioTotalStep'] = eachScenario['stepCount'];
            let tags = [];
            if (eachScenario['tags']) {
                eachScenario['tags'].forEach((t: string) => { tags.push(t) });
                result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioTag'] = tags.join(' ');
                result["fileInfo"][fileNum]['scenario'][scenarioNum]['getTagCount'] = this.getTagCount(tagNames, result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioTag']);
            }
        });


        return result;
    }
    private eachFile2(filePath: string, result: {}, tagNames: string[], fileNum: number) {

        result["fileInfo"][fileNum] = {};
        result["fileInfo"][fileNum]['filePath'] = filePath;
        result["fileInfo"][fileNum]['scenario'] = {};
        let fileContent = fs.readFileSync(filePath, 'utf8');
        //result["includedFile"] = this.addIncludedFile(fileContent, tagName, filePath, result["includedFile"])

        let content = fileContent.split(/\t|\n|\t\n/);
        let scenarioNum = 0;
        let steps = 0;
        content.forEach(eachLine => {
            eachLine = eachLine.trim();
            if (eachLine.startsWith("#")) {
                return;
            }
            if (eachLine.startsWith("@")) {
                scenarioNum += 1;
                result["fileInfo"][fileNum]['scenario'][scenarioNum] = {};
                result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioTag'] = eachLine;
                result["fileInfo"][fileNum]['scenario'][scenarioNum]['getTagCount'] = this.getTagCount(tagNames, eachLine);
            }
            if (eachLine.toLowerCase().startsWith("scenario")) {
                result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioName'] = eachLine;
                steps = 0;

            }
            if (eachLine.toLowerCase().startsWith("feature")) {
                result["fileInfo"][fileNum]['feature'] = eachLine;
            }
            if (this.isStep(eachLine)) {
                steps += 1;
                if (result["fileInfo"][fileNum] && result["fileInfo"][fileNum]['scenario'][scenarioNum]) {
                    result["fileInfo"][fileNum]['scenario'][scenarioNum]['scenarioTotalStep'] = steps;
                }
            }
        });
        return result;
    }
    private isTagIncluded(checkTag: string, fileTag: string): boolean {
        let fileTags = fileTag.split(" ");
        let checkTags = checkTag.split(" ");
        let includeChecktag: any = [];
        let isInclude = true;
        checkTags.forEach(eachCheckTag => {
            if (eachCheckTag.trim().startsWith("~")) {
                let removeCheckTag = eachCheckTag.replace('~', '');
                fileTags.forEach(eachFileTag => {
                    if (eachFileTag.trim() == removeCheckTag.trim()) {
                        isInclude = false;
                    }
                });

            } else {
                includeChecktag.push(eachCheckTag);
            }
        });

        includeChecktag.forEach(checkTag => {
            checkTag = checkTag.trim();
            let isTaged = false;
            fileTags.forEach(eachFileTag => {
                if (eachFileTag.trim() == checkTag.trim()) {
                    isTaged = true;
                }
            });
            if (!isTaged) {
                isInclude = false;
            }
        });

        return isInclude;
    }
    private getTagCount(tagNames: string[], eachLine: string): {} {

        let tagNameCondition = {};
        tagNames.forEach(tagName => {
            let isTagIncluded = this.isTagIncluded(tagName, eachLine);
            tagNameCondition[tagName] = isTagIncluded;

        });

        return tagNameCondition;
    }
    private isStep(eachLine: string): boolean {
        if (eachLine.toLowerCase().startsWith("but ") || eachLine.toLowerCase().startsWith("and ") || eachLine.toLowerCase().startsWith("then ") || eachLine.toLowerCase().startsWith("when ") || eachLine.toLowerCase().startsWith("given ")) {
            return true;

        } else {
            return false;
        }
    }
    private generateHtml(result): string {
        const htmlPath = 'index.html';
        let fileExists = fs.existsSync(htmlPath);
        if (fileExists) {
            fs.unlinkSync(htmlPath);
        }
        let htmlContent = this.generateHtmlData(result);
        fs.writeFileSync(htmlPath, htmlContent);
        return htmlPath;

    }

    private getScenariosTagCount(scenarios, tagNames) {
        let tagCount = {};
        tagNames.forEach(tagName => {
            tagCount[tagName] = 0;
        });
        for (const [key, value] of Object.entries(scenarios)) {
            tagNames.forEach(tagName => {
                if (value && value['getTagCount'] && value['getTagCount'][tagName]) {
                    let counts = scenarios[key]['getTagCount'][tagName];
                    if (counts === true) {
                        tagCount[tagName] = tagCount[tagName] + 1;
                    }
                }
            });
        }
        return tagCount;
    }
    private createNumColumn(htmlContent, key) {
        htmlContent = htmlContent + '<th  class="greenBorder">';
        htmlContent = htmlContent + key;
        htmlContent = htmlContent + "</th>";
        return htmlContent;
    }
    private createFileNameColumn(htmlContent, eachFile, location) {
        htmlContent = htmlContent + '<th  class="greenBorder">';
        if (eachFile) {
            htmlContent = htmlContent + eachFile['filePath'].replace(location + "/", "");
        }
        htmlContent = htmlContent + "</th>";
        return htmlContent;
    }
    private createfeaturTagColumn(htmlContent, eachFile): string {
        htmlContent = htmlContent + '<th  class="greenBorder">';
        if (eachFile) {
            htmlContent = htmlContent + eachFile['tags'];
        }
        htmlContent = htmlContent + "</th>";
        return htmlContent;
    }
    private createScenariolenColumn(htmlContent, eachFile): string {
        let scenlen = Object.keys(eachFile["scenario"]).length;
        htmlContent = htmlContent + '<th  class="greenBorder">';
        htmlContent = htmlContent + scenlen;
        htmlContent = htmlContent + "</th>";
        return htmlContent;
    }
    private createFeatureNameColumn(htmlContent, eachFile): string {
        htmlContent = htmlContent + '<th  class="greenBorder">' + eachFile["feature"] + "</th>";
        return htmlContent;
    }
    private createEachScenarioTagColumn(htmlContent, eachFile, tagNames): string {
        let scenariosCount = this.getScenariosTagCount(eachFile['scenario'], tagNames);
        for (const [key1, value2] of Object.entries(scenariosCount)) {
            let value = value2 + ", " + eachFile['getTagCount'][key1];
            htmlContent = htmlContent + '<th  class="greenBorder">';
            htmlContent = htmlContent + value;
            htmlContent = htmlContent + "</th>";
        }
        return htmlContent;
    }
    private createScenarioHeader(htmlContent, tagNames): string {
        htmlContent = htmlContent + '<th colspan="7"><table><thead> <tr class="purple"><th  class="blackBorder">Scenario Name</th> <th  class="blackBorder">Step #</th> <th  class="greenBorder">Tags</th>'
        tagNames.forEach(tagName => {
            htmlContent = htmlContent + '<th  class="greenBorder"> tag: ' + tagName + '</th>'
        });
        htmlContent = htmlContent + '</tr></thead>'
        return htmlContent;
    }

    private createScenarioTable(htmlContent, scenarios): string {
        htmlContent = htmlContent + '<tbody>'


        for (const [key, scenario] of Object.entries(scenarios)) {
            if (!scenario) continue;
            htmlContent = htmlContent + "<tr>";

            htmlContent = htmlContent + '<th  class="blackBorder">';
            htmlContent = htmlContent + scenario['scenarioName'];
            htmlContent = htmlContent + "</th>";
            htmlContent = htmlContent + '<th  class="blackBorder">';
            htmlContent = htmlContent + scenario['scenarioTotalStep'];
            htmlContent = htmlContent + "</th>";
            htmlContent = htmlContent + '<th  class="blackBorder">';
            htmlContent = htmlContent + scenario['scenarioTag'];
            htmlContent = htmlContent + "</th>";

            for (const [key1, value2] of Object.entries(scenario['getTagCount'])) {
                htmlContent = htmlContent + '<th  class="blackBorder">';
                htmlContent = htmlContent + value2;
                htmlContent = htmlContent + "</th>";
            }

            htmlContent = htmlContent + "</tr>";
        }

        htmlContent = htmlContent + "</tbody></table></th>"
        return htmlContent;
    }
    private createMainTheader(tagNames): string {
        let htmlContent = '<thead> <tr  class="red"><th  class="greenBorder">#</th>  <th  class="greenBorder">File Name</th> <th  class="greenBorder">Feature Name</th> <th  class="greenBorder">File Tags</th> <th  class="greenBorder">Scenario Number</th>'
        tagNames.forEach(tagName => {
            htmlContent = htmlContent + '<th  class="greenBorder"> tag: ' + tagName + ' #</th>'
        });
        htmlContent = htmlContent + '</tr></thead>'
        return htmlContent;
    }
    private generateHtmlData(result): string {
        let tagNames = result['tagNames'];
        let script = '<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script> <script> function showInfo(id) { $( ".childTable" ).hide(); $( "#"+id ).show(); }</script> ';
        let style = '<style> .mainTr {cursor: pointer;} .blackBorder { border: 1px solid black; } .greenBorder { border: 1px solid green;} .childTable {display: none } .childTable table {border: 3px solid purple;} body { margin: 0; padding: 2rem; } table { text-align: left; position: relative; border-collapse: collapse; } th, td { padding: 0.25rem; } tr.red th { background: red; color: white; } tr.purple th { background: purple; color: white; }</style>';
        let header = '<!DOCTYPE html> <html>  <head> ' + script + style + ' </head> <body>   <table > \n'
        let healine = this.createMainTheader(tagNames)
        let fooder = "</tbody> </table> </body></html> ";
        let htmlContent = healine + "\n<tbody>";

        let location = result['location'];

        for (const [key, eachFile] of Object.entries(result["fileInfo"])) {
            htmlContent = htmlContent + '<tr class="mainTr"  onclick="showInfo(\'childTable' + key + '\')">';
            htmlContent = this.createNumColumn(htmlContent, key.toString());
            htmlContent = this.createFileNameColumn(htmlContent, eachFile, location);
            htmlContent = htmlContent + '<th  class="greenBorder">' + eachFile["feature"] + "</th>";
            htmlContent = this.createfeaturTagColumn(htmlContent, eachFile);
            htmlContent = this.createScenariolenColumn(htmlContent, eachFile);
            htmlContent = this.createEachScenarioTagColumn(htmlContent, eachFile, tagNames);
            htmlContent = htmlContent + "</tr>";
            htmlContent = htmlContent + '<tr  id="childTable' + key + '" class="childTable">';
            htmlContent = this.createScenarioHeader(htmlContent, tagNames);
            htmlContent = this.createScenarioTable(htmlContent, eachFile["scenario"]);

            htmlContent = htmlContent + "</tr>";
        }
        return header + htmlContent + fooder;
    }

    public async checkReport(featureFileFolder, tagNames) {
        let result = {};
        result["includedFile"] = [];
        result["tagCount"] = {};
        result["fileInfo"] = {};
        result["tagNames"] = tagNames;
        result["location"] = featureFileFolder;

        let files = glob.sync(featureFileFolder + '/**/*.feature');
        let fileNum = 0;
        files.forEach(eachFile => {
            fileNum += 1;
            result = this.eachFile(eachFile, result, tagNames, fileNum);
        });
        result = this.removeNoscenario(result);
        let path = this.generateHtml(result);
        console.log("Open below link in browser for report.");
        console.log(process.cwd() + "\\" + path);
        //const myJSON = JSON.stringify(result);
        // console.log(myJSON);
    }
    private removeNoscenario(result) {
        for (const [key, value] of Object.entries(result["fileInfo"])) {
            let scenario = result["fileInfo"][key.toString()]['scenario'];

            for (const [key1, value2] of Object.entries(scenario)) {
                if (!scenario[key1.toString()]['scenarioName']) {
                    delete result["fileInfo"][key.toString()]['scenario'][key1.toString()]
                }
            }
        }
        return result;
    }
}


const featureFileReport = new FeatureFileReport();
const featureFileFolder: string = 'e2e/web/features';
const tagNames = ["@CCEWe ~@Smoketest", "@NewClaim ~@dev-deploy @Smoketest"]
featureFileReport.checkReport(featureFileFolder, tagNames);
