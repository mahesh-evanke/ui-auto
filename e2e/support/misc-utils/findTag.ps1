$featureFileFolder = "C:\Users\211468\Desktop\project\Workspace\cce-ui-automation\e2e\features";
$tagNames = "@CCEWe ~@Smoketest", "@NewClaim ~@dev-deploy @Smoketest";

$featureFileReport = [FeatureFileReport]::new($featureFileFolder, $tagNames);
$featureFileReport.GetNum();
class FeatureFileReport {
    [string]$featureFileFolder
    [Array]$tagNames
    FeatureFileReport([string]$folder, [Array]$tags ) {
        $this.featureFileFolder = $folder;
        $this.tagNames = $tags;
    }
    [string] GetNum() {
        $htmlLocation = ([string](Get-Location)) + "\index.html";
        $result = @{}
        $result["filesInfo"] = @();
        $featureFiles = Get-ChildItem -Path $this.featureFileFolder -Recurse -Include *.feature;
        $filesInfo = @();
        $order = 0;
        foreach ($featureFile in $featureFiles) {
            $order++;
            $fileInfo = @{};
            $fileInfo["fileLocation"] = $featureFile.FullName;
            $fileInfo["order"] = $order;
            $fileInfo["features"] = $this.GetFileInfo($fileInfo, $featureFile);
            $filesInfo = $filesInfo + $fileInfo;
        }
        $this.GenerateHtml($filesInfo, $htmlLocation);

        $dd = $filesInfo | ConvertTo-Json -depth 8
         Write-Host $dd
        Write-Host "Open below link in browser for report.";
        return $htmlLocation;
    }
    [void] GenerateHtml($filesInfo, $htmlLocation) {
        New-Item $htmlLocation;
        $htmlContent = $this.GetHtmlContent($filesInfo);
        Set-Content $htmlLocation $htmlContent;
    }
    [string] GetHtmlContent($filesInfo) {
        $script = '<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script> <script> function showInfo(id) { $( ".childTable" ).hide(); $( "#"+id ).show(); }</script> ';
        $style = '<style> .mainTr {cursor: pointer;} .blackBorder { border: 1px solid black; } .greenBorder { border: 1px solid green;} .childTable {display: none } .childTable table {border: 3px solid purple;} body { margin: 0; padding: 2rem; } table { text-align: left; position: relative; border-collapse: collapse; } th, td { padding: 0.25rem; } tr.red th { background: red; color: white; } tr.purple th { background: purple; color: white; }</style>';
        $header = '<!DOCTYPE html> <html>  <head> ' + $script + $style + ' </head> <body>   <table > '
        $healine = $this.CreateMainHealine();
        $fooder = "</tbody> </table> </body></html> ";
        $htmlContent = $healine + "<tbody>";
        foreach ($eachFile in $filesInfo) {
            $methodName = "showInfo('childTable" + $eachFile["order"] + "')"
            $htmlContent = $htmlContent + '<tr class="mainTr"  onclick="' + $methodName + '">';
            $htmlContent = $this.CreateNumColumn($htmlContent, $eachFile["order"]);
            $htmlContent = $this.CreateFileNameColumn($htmlContent, $eachFile);
            $htmlContent = $htmlContent + '<th  class="greenBorder">' + $eachFile["features"]["Name"] + "</th>";
            $htmlContent = $this.CreatefeaturTagColumn($htmlContent, $eachFile);
            $htmlContent = $this.CreateScenariolenColumn($htmlContent, $eachFile);
            $htmlContent = $this.CreateBackgroundColumn($htmlContent, $eachFile);
            $htmlContent = $this.CreateEachScenarioTagColumn($htmlContent, $eachFile);
            $htmlContent = $htmlContent + "</tr>";
            $htmlContent = $htmlContent + '<tr  id="childTable' + $eachFile["order"] + '" class="childTable">';
            $htmlContent = $this.CreateScenarioHeader($htmlContent);
            $htmlContent = $this.CreateScenarioTable( $htmlContent, $eachFile["features"]["Scenario"]);


            $htmlContent = $htmlContent + "</tr>";
        }


        return $header + $htmlContent + $fooder;
    }

    [string] CreateScenarioTable($htmlContent, $scenarios) {
        $htmlContent = $htmlContent + '<tbody>'
        foreach ($key in $scenarios.Keys) {
            $htmlContent = $htmlContent + "<tr>";
            $htmlContent = $htmlContent + '<th  class="blackBorder">';
            $htmlContent = $htmlContent + $scenarios.Item($key)['Name'];
            $htmlContent = $htmlContent + "</th>";
            $htmlContent = $htmlContent + '<th  class="blackBorder">';
            $htmlContent = $htmlContent + $scenarios.Item($key)['steps'];
            $htmlContent = $htmlContent + "</th>";
            $htmlContent = $htmlContent + '<th  class="blackBorder">';
            $type = $scenarios.Item($key)['type'];
            if($type -eq "Scenario Outline")
            {
                $type = $type  + " (" +$scenarios.Item($key)['testCases']+")"
            }




            $htmlContent = $htmlContent + $type;
            $htmlContent = $htmlContent + "</th>";
            $htmlContent = $htmlContent + '<th  class="blackBorder">';
            $htmlContent = $htmlContent + $scenarios.Item($key)['Tags']['tags'];
            $htmlContent = $htmlContent + "</th>";
            foreach ($tagName in $this.tagNames) {
                $htmlContent = $htmlContent + '<th  class="blackBorder">';
                $htmlContent = $htmlContent + $scenarios.Item($key)['Tags']['checkTag'][$tagName];
                $htmlContent = $htmlContent + "</th>";
            }
            $htmlContent = $htmlContent + "</tr>";

        }
        $htmlContent = $htmlContent + "</tbody></table></th>"
        return $htmlContent;
    }
    [string] CreateScenarioHeader($htmlContent) {
        $htmlContent = $htmlContent + '<th colspan="7"><table><thead> <tr class="purple"><th  class="blackBorder">Scenario Name</th> <th  class="blackBorder">Step #</th><th  class="blackBorder">Scenario Type<br>(Test Case #)</th> <th  class="greenBorder">Tags</th>';

        foreach ($tagName in $this.tagNames) {
            $htmlContent = $htmlContent + '<th  class="greenBorder"> tag: ' + $tagName + '</th>'
        }
        $htmlContent = $htmlContent + '</tr></thead>'
        return $htmlContent;
    }
    [string] CreateBackgroundColumn($htmlContent, $eachFile) {

        $value = "";
        if ($eachFile['features']["Background"]) {
            $value = "true(" + $eachFile['features']["Background"]["steps"]+")"
        }
        else {
            $value = "false"
        }
        $htmlContent = $htmlContent + '<th  class="greenBorder">' + $value + "</th>";
        return $htmlContent;
    }

    [string]  GetScenariosTagCount($tagName, $feature) {
        $featureTag = $feature['Tags']['checkTag'][$tagName];
        $num = 0;
        foreach ($key in $feature['Scenario'].Keys) {
            if ($feature['Scenario'].Item($key)['Tags']['checkTag'][$tagName]) {
                $num++;
            }
        }

        return $num.ToString() + "," + $featureTag;
    }


    [string] CreateEachScenarioTagColumn($htmlContent, $eachFile) {


        foreach ($tagName in $this.tagNames) {
            $featureTag = $this.GetScenariosTagCount($tagName, $eachFile['features']);

            $htmlContent = $htmlContent + '<th  class="greenBorder">';
            $htmlContent = $htmlContent + $featureTag;
            $htmlContent = $htmlContent + "</th>";

        }

        return $htmlContent;
    }

    [string] CreateScenariolenColumn($htmlContent, $eachFile) {
        $m = $eachFile["features"]["Scenario"].Count
        $scenlen = $m;
        $htmlContent = $htmlContent + '<th  class="greenBorder">';
        $htmlContent = $htmlContent + $scenlen;
        $htmlContent = $htmlContent + "</th>";
        return $htmlContent;
    }
    [string] CreatefeaturTagColumn($htmlContent, $eachFile) {
        $htmlContent = $htmlContent + '<th  class="greenBorder">';
        if ($eachFile) {
            $htmlContent = $htmlContent + ($eachFile["features"]['Tags']['tags'] -join ' ');
        }
        $htmlContent = $htmlContent + "</th>";
        return $htmlContent;
    }

    [string]  CreateFileNameColumn($htmlContent, $eachFile) {
        $htmlContent = $htmlContent + '<th  class="greenBorder">';
        if ($eachFile) {
            $htmlContent = $htmlContent + $eachFile['fileLocation'].Replace($this.featureFileFolder + "\", "");
        }
        $htmlContent = $htmlContent + "</th>";
        return $htmlContent;
    }

    [string]  CreateNumColumn($htmlContent, $key) {
        $htmlContent = $htmlContent + '<th  class="greenBorder">';
        $htmlContent = $htmlContent + $key;
        $htmlContent = $htmlContent + "</th>";
        return $htmlContent;
    }

    [string] CreateMainHealine() {
        $htmlContent = '<thead> <tr  class="red"><th  class="greenBorder">#</th>  <th  class="greenBorder">File Name</th> <th  class="greenBorder">Feature Name</th> <th  class="greenBorder">File Tags</th> <th  class="greenBorder">Scenario Number</th><th  class="greenBorder">Has Background (Step #)</th>'
        foreach ($tagName in $this.tagNames) {
            $htmlContent = $htmlContent + '<th  class="greenBorder"> tag #: ' + $tagName + '</th>'
        }
        $htmlContent = $htmlContent + '</tr></thead>'
        return $htmlContent;
    }

    [Object] GetLineTags($line) {
        $lineTags = @();
        $words = $line.Split(" ");
        foreach ($word in $words) {
            $charCount = ($word.ToCharArray() | Where-Object { $_ -eq '@' } | Measure-Object).Count
            if ($charCount -gt 0) {
                $wordTags = $this.WordToTags($word);
                $lineTags = $lineTags + $wordTags;
            }
        }
        return $lineTags;
    }
    [Object] WordToTags($word) {
        $wordTags = @();
        $tags = $word.Split("@");
        foreach ($tag in $tags) {
            if ($tag.length -gt 0) {
                $tag = @('@' + $tag);
                $wordTags = $wordTags + $tag;
            }
        }
        return $wordTags;
    }
    [object] GetTags($lines, $lineNum) {
        $tags = @()
        for ($i = $lineNum - 1; $i -ge 0; $i--) {
            $lineValue = [string]$lines[$i].Trim();
            if ($lineValue -eq "" -Or $lineValue.StartsWith("#")) {
                continue;
            }
            if (!$lineValue.StartsWith("@")) {
                break;
            }
            $lineTags = $this.GetLineTags($lines[$i]);
            $tags = $tags + $lineTags;
        }
        $tagInfo = @{};
        $tagInfo["tags"] = $tags;
        $tagInfo["checkTag"] = $this.GetCheckTag($tags);
        return $tagInfo;
    }
    [object] GetCheckTag([object]$featureTags) {
        $tagInfo = @{};
        foreach ($checkTag in $this.tagNames) {
            $tagInfo[$checkTag] = $this.IsTagIncluded($checkTag, $featureTags);
        }
        return $tagInfo;
    }

    [boolean] IsTagIncluded([object]$checkTags, [object]$featureTags) {
        $checkingTags = $checkTags.split(" ");
        $includeChecktags = @();
        foreach ($checkingTag in $checkingTags) {
            if ($checkingTag -eq "") {
                continue;
            }
            if ($checkingTag.StartsWith("~")) {
                $removeCheckTag = $checkingTag.Replace('~', '');
                foreach ($featureTag in $featureTags) {
                    if ($removeCheckTag -eq $featureTag) {
                        return $false;
                    }
                }
            }
            else {
                $includeChecktags = $includeChecktags + @($checkingTag)
            }
        }
        foreach ($includeChecktag in $includeChecktags) {
            $isTaged = $false;
            foreach ($featureTag in $featureTags) {
                if ($featureTag -eq $includeChecktag) {
                    $isTaged = $true;
                }
            }
            if (!$isTaged) {
                return $false;
            }
        }


        return $true;
    }
    [object] GetFileInfo([Object]$fileInfo, $path) {
        $featureInfo = @{};
        $content = Get-Content $path;
        $lines = $content.Split([Environment]::NewLine);
        $senarioNum = 0;
        $type = "Scenario";
        $type = 0;
        for ($lineNum = 0; $lineNum -lt $lines.length; $lineNum++) {
            $lineValue = [string]$lines[$lineNum].Trim();
            if ($lineValue -eq "" -Or $lineValue.StartsWith("#")) {
                continue;
            }
            if ($lineValue.StartsWith("Feature:")) {
                $featureInfo["Name"] = $lineValue.substring("Feature:".length).Trim();
                $featureInfo["Tags"] = $this.GetTags($lines, $lineNum);
                $featureInfo["Scenario"] = @{};
                $senarioNum = 0;
            }
            if ($lineValue.StartsWith("Background:")) {
                $type = "Background";
                $featureInfo[$type] = @{};
                $featureInfo[$type]["Num"] = $senarioNum + 1;
                $featureInfo[$type]["Name"] = $lineValue.substring("Background:".length).Trim();
                $featureInfo[$type]["Tags"] = $this.GetTags($lines, $lineNum);
                $featureInfo[$type]["steps"] = 0;

            }
            if ($lineValue.StartsWith("Scenario:") -Or $lineValue.StartsWith("Scenario Outline:")) {
                $senarioNum++;
                $featureInfo["Scenario"][$senarioNum.ToString()] = @{};
                if ($lineValue.StartsWith("Scenario:")) {
                    $type = "Scenario";
                    $featureInfo["Scenario"][$senarioNum.ToString()]["type"] = "Scenario";
                    $featureInfo["Scenario"][$senarioNum.ToString()]["Name"] = $lineValue.substring("Scenario:".length).Trim();
                }
                else {
                    $type = "ScenarioOutline";
                    $featureInfo["Scenario"][$senarioNum.ToString()]["type"] = "Scenario Outline";
                    $featureInfo["Scenario"][$senarioNum.ToString()]["Name"] = $lineValue.substring("Scenario Outline:".length).Trim();

                }

                $featureInfo["Scenario"][$senarioNum.ToString()]["Num"] = $senarioNum;
                $featureInfo["Scenario"][$senarioNum.ToString()]["Tags"] = $this.GetTags($lines, $lineNum);
                $featureInfo["Scenario"][$senarioNum.ToString()]["steps"] = 0;
            }
            if ($lineValue.StartsWith("Given ") -Or $lineValue.StartsWith("When ") -Or $lineValue.StartsWith("Then ") -Or $lineValue.StartsWith("And ") -Or $lineValue.StartsWith("But ")) {
                if ($type -eq "Background") {
                    $featureInfo[$type]["steps"] = $featureInfo[$type]["steps"] + 1 ;
                }
                else {
                    $featureInfo["Scenario"][$senarioNum.ToString()]["steps"] = $featureInfo["Scenario"][$senarioNum.ToString()]["steps"] + 1 ;
                }

            }
            if ($lineValue.StartsWith("Examples:")) {
                $featureInfo["Scenario"][$senarioNum.ToString()]["testCases"] = $this.GetTestCaseNum($lines, $lineNum);
            }

        }
        return $featureInfo;
    }
    [object] GetTestCaseNum($lines, $lineNum) {
        $testCaseNum = 0
        for ($i = $lineNum + 1; $i -le $lines.length - 1; $i ++ ) {
            $lineValue = [string]$lines[$i].Trim();
            if ($lineValue -eq "" -Or $lineValue.StartsWith("#")) {
                continue;
            }
            if (!$lineValue.StartsWith("|")) {
                break;
            }
            $testCaseNum++;
        }
        return $testCaseNum;
    }
}
