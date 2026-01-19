# UI WebdriverIO Automation Framework

## Prerequisites
Ensure that you have the following technologies installed locally:
* Node
* VSCode

## Installation
1. Run `npm install` or `npm i`on terminal after cloning the repository to your local directory.
2. unzip chromedriver.zip on root folder to node_modules folder. this step is needed only if npm could not download chromedriver(`npm i chromedriver` step fails), so we have to manually download. 
3. If need to update webdriver version, download from online and replace to node_modules\chromedriver\lib\chromedriver\chromedriver.exe

## Run Automation
1. update e2e\config\config.yaml based on preference.
2. Run `npm run wdio` on terminal to run automation.


## Report
After finish run, open html file inside e2e\report
