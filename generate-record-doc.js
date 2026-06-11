'use strict';
/**
 * Generates npm-run-record-documentation.docx
 * Documents the `npm run record` Config-Panel Recorder.
 * Matches the style of the existing pw-documentation.docx sections 8 & 9.
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, Header, Footer, PageBreak, LevelFormat, UnderlineType,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ── Colour palette (matches pw-documentation) ────────────────────────────────
const BRAND    = '2E75B6';
const DARK     = '1F3864';
const ACCENT   = '0070C0';
const LIGHT_BG = 'DEEAF1';
const CODE_BG  = 'F2F2F2';
const WHITE    = 'FFFFFF';
const TEXT     = '2C2C2C';
const GRAY     = '595959';
const GREEN    = '375623';
const GREEN_BG = 'E2EFDA';
const AMBER    = '7F6000';
const AMBER_BG = 'FFF2CC';

const border   = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders  = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Typography helpers ────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, size: 36, color: DARK, font: 'Calibri' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND } },
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: 28, color: BRAND, font: 'Calibri' })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: ACCENT, font: 'Calibri' })],
  });
}
function para(runs, spacing = {}) {
  const rs = Array.isArray(runs)
    ? runs
    : [new TextRun({ text: runs, size: 22, color: TEXT, font: 'Calibri' })];
  return new Paragraph({ children: rs, spacing: { before: 60, after: 80, ...spacing } });
}
function bold(text) { return new TextRun({ text, bold: true, size: 22, color: TEXT, font: 'Calibri' }); }
function normal(text) { return new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' }); }
function code(text)  { return new TextRun({ text, font: 'Courier New', size: 20, color: '952900', highlight: 'yellow' }); }
function colored(text, color) { return new TextRun({ text, size: 22, color, font: 'Calibri' }); }

function bullet(text, level = 0) {
  const indent = level === 0 ? { left: 720, hanging: 360 } : { left: 1080, hanging: 360 };
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { before: 40, after: 40 },
    indent,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' })],
  });
}
function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    spacing: { before: 40, after: 40 },
    indent: { left: 720, hanging: 360 },
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' })],
  });
}
function blankLine() {
  return new Paragraph({ children: [new TextRun({ text: '', size: 22 })], spacing: { before: 0, after: 0 } });
}
function codeBlock(lines) {
  return lines.map(line =>
    new Paragraph({
      children: [new TextRun({ text: line, font: 'Courier New', size: 18, color: '1F497D' })],
      spacing: { before: 0, after: 0 },
      indent: { left: 360 },
      shading: { fill: 'F0F4F8', type: ShadingType.CLEAR },
      border: {
        top:    { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left:   { style: BorderStyle.SINGLE, size: 12, color: BRAND },
        right:  { style: BorderStyle.NONE },
      },
    })
  );
}
function infoBox(lines, fill = LIGHT_BG, textColor = DARK) {
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BRAND };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        width: { size: 9360, type: WidthType.DXA },
        children: lines.map(l =>
          new Paragraph({
            children: Array.isArray(l)
              ? l
              : [new TextRun({ text: l, size: 21, color: textColor, font: 'Calibri' })],
            spacing: { before: 40, after: 40 },
          })
        ),
      })],
    })],
  });
}
function twoColTable(rows, col1Width = 2800, col2Width = 6560) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [col1Width, col2Width],
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders,
            shading: {
              fill: ri === 0 ? BRAND : ci === 0 ? LIGHT_BG : WHITE,
              type: ShadingType.CLEAR,
            },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            width: { size: ci === 0 ? col1Width : col2Width, type: WidthType.DXA },
            children: [new Paragraph({
              children: Array.isArray(cell)
                ? cell
                : [new TextRun({
                    text: String(cell),
                    size: 20,
                    bold: ri === 0,
                    color: ri === 0 ? WHITE : ci === 0 ? DARK : TEXT,
                    font: 'Calibri',
                  })],
              spacing: { before: 40, after: 40 },
            })],
          })
        ),
      })
    ),
  });
}
function threeColTable(rows, w1 = 2200, w2 = 2800, w3 = 4360) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [w1, w2, w3],
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) =>
          new TableCell({
            borders,
            shading: {
              fill: ri === 0 ? DARK : ci === 0 ? LIGHT_BG : WHITE,
              type: ShadingType.CLEAR,
            },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            width: { size: [w1, w2, w3][ci], type: WidthType.DXA },
            children: [new Paragraph({
              children: Array.isArray(cell)
                ? cell
                : [new TextRun({
                    text: String(cell),
                    size: 20,
                    bold: ri === 0,
                    color: ri === 0 ? WHITE : ci === 0 ? DARK : TEXT,
                    font: 'Calibri',
                  })],
              spacing: { before: 40, after: 40 },
            })],
          })
        ),
      })
    ),
  });
}

// ── Document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ],
      },
      {
        reference: 'numbers',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: TEXT } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: DARK },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: BRAND },
        paragraph: { spacing: { before: 260, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: ACCENT },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'npm run record — Config-Panel Recorder', size: 18, color: GRAY, font: 'Calibri' }),
              new TextRun({ text: '\t', size: 18 }),
              new TextRun({ text: 'Internal Technical Documentation', size: 18, color: GRAY, font: 'Calibri', italics: true }),
            ],
            tabStops: [{ type: 'right', position: 9360 }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Page ', size: 18, color: GRAY, font: 'Calibri' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GRAY, font: 'Calibri' }),
              new TextRun({ text: ' of ', size: 18, color: GRAY, font: 'Calibri' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: GRAY, font: 'Calibri' }),
              new TextRun({ text: '\tPlaywright Cucumber Framework', size: 18, color: GRAY, font: 'Calibri', italics: true }),
            ],
            tabStops: [{ type: 'right', position: 9360 }],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BRAND } },
          })],
        }),
      },
      children: [

        // ── COVER ──────────────────────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 1440, after: 120 },
          children: [new TextRun({ text: 'npm run record', bold: true, size: 72, color: BRAND, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: 'Config-Panel Recorder', bold: true, size: 40, color: DARK, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          spacing: { before: 0, after: 400 },
          children: [new TextRun({ text: 'Technical Documentation', size: 28, color: GRAY, font: 'Calibri', italics: true })],
          alignment: AlignmentType.CENTER,
        }),
        blankLine(),
        infoBox([
          [bold('What it does: '), normal('Launches a browser with a floating config panel. You set a file name, choose a capture mode, add URL filters, then record — no toolbar injection needed.')],
          [bold('Output: '), normal('.feature file + .yaml locator file, auto-saved to e2e/features/generated/ and e2e/locators/generated/')],
          [bold('Run command: '), code('npm run record')],
          [bold('Run tests: '), code('npm run test:web'), normal('  |  '), code('npm run test:api'), normal('  |  '), code('npm run test:e2e')],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── TABLE OF CONTENTS (manual) ─────────────────────────────────────────
        h1('Contents'),
        twoColTable([
          ['Section', 'Topic'],
          ['1', 'What is npm run record?'],
          ['2', 'Starting the Recorder'],
          ['3', 'Config Panel — Field Reference'],
          ['4', 'Capture Modes in Detail'],
          ['5', 'Review Panel'],
          ['6', 'URL Variable Substitution'],
          ['7', 'Running Tests'],
          ['8', 'Terminal Output & Reports'],
          ['9', 'Quick Reference Card'],
        ], 1200, 8160),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 1: WHAT IS npm run record ─────────────────────────────────
        h1('1. What is npm run record?'),
        para([
          code('npm run record'),
          normal(' launches a Chromium browser with a floating '),
          bold('Config Panel'),
          normal(' overlay. Unlike '),
          code('npm run pw'),
          normal(' (which injects a toolbar into every page), the config panel appears only once at startup. You configure the recording session before you begin, then perform actions normally in the browser.'),
        ]),
        blankLine(),
        para('The recorder supports three distinct capture modes:'),
        blankLine(),
        threeColTable([
          ['Mode', 'How it captures', 'Output files'],
          ['UI (Codegen)', 'Playwright Inspector — records clicks, fills, navigations', '.feature + .yaml'],
          ['API (Network)', 'Intercepts HTTP requests/responses via page.on()', '.feature (API steps)'],
          ['UI+API (Combined)', 'Playwright Inspector for UI actions + network interception for API calls', '.feature + .yaml'],
        ], 1800, 3960, 3600),
        blankLine(),
        para([
          normal('After recording, a '),
          bold('Review Panel'),
          normal(' shows a live preview of the generated '),
          code('.feature'),
          normal(' and '),
          code('.yaml'),
          normal(' files before saving. You can edit them in the panel if needed.'),
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 2: STARTING ────────────────────────────────────────────────
        h1('2. Starting the Recorder'),
        numbered('Open a terminal in the project root.'),
        numbered([code('npm run record'), normal(' — this launches a Chromium browser window.')]),
        numbered('The Config Panel appears in the top-right corner of the browser.'),
        numbered('Fill in the fields (see Section 3) and click ▶ Start Recording.'),
        numbered('Navigate to your application URL and perform the test actions.'),
        numbered('Click ⏹ Stop Recording when done.'),
        numbered('Review the generated files in the Review Panel (see Section 5).'),
        numbered('Click 💾 Save Files to write them to disk.'),
        blankLine(),
        infoBox([
          [bold('Note: '), normal('The browser does not navigate to any URL automatically. After clicking Start, type or paste your application URL into the address bar and press Enter.')],
        ], AMBER_BG, AMBER),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 3: CONFIG PANEL ────────────────────────────────────────────
        h1('3. Config Panel — Field Reference'),
        para('The Config Panel is a floating overlay visible only when the browser first opens. It contains the following fields:'),
        blankLine(),

        h2('3.1 File Name'),
        para([
          normal('Enter the base name for the output files (without extension). For example, entering '),
          code('login'),
          normal(' produces:'),
        ]),
        bullet([code('e2e/features/generated/web/login.feature')]),
        bullet([code('e2e/locators/generated/web/login.yaml')]),
        blankLine(),
        infoBox([
          [bold('Tip: '), normal('Use lowercase, hyphen-separated names that describe the user journey — e.g., "user-login", "checkout-flow", "add-service". The name appears as the Feature title in the generated file.')],
        ], GREEN_BG, GREEN),
        blankLine(),

        h2('3.2 Capture Mode'),
        para('Select one of three capture modes before starting the recording:'),
        blankLine(),
        twoColTable([
          ['Mode', 'Description'],
          ['🎭 UI (Codegen)', 'Uses Playwright Inspector. Records every click, fill, navigation and checkbox interaction. Best locator quality. Generates both .feature and .yaml.'],
          ['🌐 API (Network)', 'Captures HTTP requests and responses via Playwright\'s page.on() events. No UI interactions recorded. Generates .feature with API steps only (no .yaml).'],
          ['⚡ UI+API (Combined)', 'Simultaneously records UI actions (via Playwright Inspector) and network calls (via page.on()). Generates both .feature and .yaml with both UI and API steps.'],
        ], 2400, 6960),
        blankLine(),
        para([
          normal('The selected mode is shown highlighted in the panel. Click a different mode button at any time '),
          bold('before'),
          normal(' clicking Start Recording to switch.'),
        ]),
        blankLine(),

        h2('3.3 URL Filters (API & UI+API modes only)'),
        para([
          normal('URL filters restrict which network requests are captured. Only requests whose URL '),
          bold('contains'),
          normal(' at least one of the filter strings are recorded.'),
        ]),
        blankLine(),
        ...codeBlock([
          'Examples:',
          '  /api/            → captures all requests with /api/ in the URL',
          '  api.example.com  → captures requests to that domain only',
          '  /v1/users        → captures only the users endpoint',
        ]),
        blankLine(),
        numbered('Type a filter string into the filter input box.'),
        numbered('Press Enter (or click + Add) to add it as a chip.'),
        numbered('Add as many filters as needed. Each chip acts as an OR condition.'),
        numbered('Click × on a chip to remove it.'),
        blankLine(),
        infoBox([
          [bold('Note: '), normal('If no URL filters are set, ALL network requests are captured. Add at least one filter to keep the output focused on your application\'s API.')],
        ], AMBER_BG, AMBER),
        blankLine(),

        h2('3.4 Exclude Patterns (API & UI+API modes only)'),
        para([
          normal('Exclude patterns remove unwanted requests even after the URL filter matches. A request is excluded if its URL '),
          bold('contains'),
          normal(' any of the exclude strings.'),
        ]),
        blankLine(),
        ...codeBlock([
          'Common excludes:',
          '  .png   .jpg   .svg   .css   .js  → static assets',
          '  /health   /metrics              → internal health-check endpoints',
          '  analytics   tracking            → third-party analytics calls',
        ]),
        blankLine(),
        para('Use the same chip input pattern as URL filters: type → Enter → chip appears.'),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 4: CAPTURE MODES ───────────────────────────────────────────
        h1('4. Capture Modes in Detail'),

        // 4.1 UI MODE
        h2('4.1 UI Mode — Playwright Codegen'),
        para([
          normal('UI mode is powered by '),
          bold('Playwright Inspector'),
          normal(' (the same engine behind '),
          code('npx playwright codegen'),
          normal('). Every interaction you make in the browser is translated into a Playwright action and mapped to a Gherkin step.'),
        ]),
        blankLine(),

        h3('How It Works'),
        numbered('Click ▶ Start Recording in the config panel.'),
        numbered('Playwright Inspector launches internally and begins listening for browser events.'),
        numbered('Every click, fill, navigation, and selection is captured as a raw Playwright action.'),
        numbered('When you click ⏹ Stop, the raw actions are converted to Gherkin steps using the step library.'),
        numbered('Locator XPath expressions are extracted and placed in the .yaml file.'),
        blankLine(),

        h3('Generated .feature (UI Mode)'),
        ...codeBlock([
          'Feature: login',
          '',
          '  Scenario: login',
          '    Given User navigates to "https://app.example.com/login" URL',
          '    When User enters "john@example.com" text in "Email" textbox',
          '    When User enters "Test@123" text in "Password" textbox',
          '    When User clicks on "Login" button',
          '    Then User verifies "Dashboard" text is present',
        ]),
        blankLine(),

        h3('Generated .yaml (UI Mode)'),
        ...codeBlock([
          'login:',
          '  Email: //*[@id="email"]',
          '  Password: //*[@id="password"]',
          '  Login: //button[normalize-space()="Login"]',
        ]),
        blankLine(),

        h3('Locator Quality'),
        para('Playwright Inspector generates locators in this priority order:'),
        numbered([bold('Role-based: '), normal('getByRole("button", { name: "Login" }) — most stable')]),
        numbered([bold('Placeholder: '), normal('getByPlaceholder("Enter email") — good for inputs')]),
        numbered([bold('Text: '), normal('getByText("Submit") — used when no better attribute is available')]),
        numbered([bold('Test ID: '), normal('getByTestId("login-btn") — used when data-testid is present')]),
        numbered([bold('CSS/XPath: '), normal('Fallback only when no semantic locator is found')]),
        blankLine(),
        infoBox([
          [bold('Use Case: '), normal('UI Mode is the best choice for testing user-facing workflows — login flows, form submissions, navigation, and any scenario where you interact with visible elements.')],
        ], GREEN_BG, GREEN),
        blankLine(),

        // 4.2 API MODE
        h2('4.2 API Mode — Network Capture'),
        para([
          normal('API mode intercepts '),
          bold('HTTP requests and responses'),
          normal(' as you navigate the application. No UI interactions are recorded — only the network traffic. It uses Playwright\'s '),
          code('page.on(\'request\')'),
          normal(' and '),
          code('page.on(\'response\')'),
          normal(' events internally.'),
        ]),
        blankLine(),

        h3('How It Works'),
        numbered('Click ▶ Start Recording.'),
        numbered('Browse your application. Every HTTP request matching your URL filters is captured.'),
        numbered('Request method, URL, headers, and body are recorded.'),
        numbered('Response status code, headers, and body are recorded.'),
        numbered('Click ⏹ Stop when done.'),
        numbered('The converter maps each captured request to a Gherkin API step.'),
        blankLine(),

        h3('Generated .feature (API Mode)'),
        ...codeBlock([
          'Feature: services-api',
          '',
          '  Scenario: services-api',
          '    Given User makes a "GET" request to "${service}/list"',
          '    Then the response status code is "200"',
          '    And the response body contains "serviceName"',
          '',
          '    Given User makes a "POST" request to "${login}"',
          '    And the request body is:',
          '      """',
          '      { "email": "john@example.com", "password": "Test@123" }',
          '      """',
          '    Then the response status code is "200"',
        ]),
        blankLine(),
        para([
          normal('Note the '),
          code('${login}'),
          normal(' and '),
          code('${service}'),
          normal(' tokens. See Section 6 for how URL variable substitution works.'),
        ]),
        blankLine(),

        h3('What is Captured per Request'),
        twoColTable([
          ['Field', 'Detail'],
          ['Method', 'GET, POST, PUT, DELETE, PATCH'],
          ['URL', 'Full URL — base URL extracted and aliased if matched in api.yaml'],
          ['Request Body', 'JSON body (for POST / PUT / PATCH)'],
          ['Response Status', 'HTTP status code (200, 201, 400, 404, etc.)'],
          ['Response Body', 'JSON body (up to 4 KB, truncated if larger)'],
        ]),
        blankLine(),
        infoBox([
          [bold('Use Case: '), normal('API Mode is ideal for documenting and testing REST API behaviour — verifying status codes, response structures, and end-to-end API flows.')],
        ], GREEN_BG, GREEN),
        blankLine(),

        // 4.3 UI+API MODE
        h2('4.3 UI+API Mode — Combined Recording'),
        para([
          normal('UI+API mode runs '),
          bold('both capture streams simultaneously'),
          normal(': Playwright Inspector records UI interactions and the network listener captures API calls. Both are merged into a single '),
          code('.feature'),
          normal(' file.'),
        ]),
        blankLine(),

        h3('How It Works'),
        numbered('Playwright Inspector starts (same as UI mode).'),
        numbered([code('page.on(\'request\')'), normal(' listener starts (same as API mode).')]),
        numbered('You browse the application and perform actions.'),
        numbered('UI events and API calls are captured in parallel into separate queues.'),
        numbered('On Stop, both queues are merged chronologically and converted to Gherkin.'),
        numbered('The .feature contains both UI steps and API assertions interleaved.'),
        numbered('The .yaml contains locators for all UI elements found.'),
        blankLine(),

        h3('Example Merged .feature (UI+API Mode)'),
        ...codeBlock([
          'Feature: login-with-api',
          '',
          '  Scenario: login-with-api',
          '    Given User navigates to "${login}" URL',
          '    When User enters "john@example.com" text in "Email" textbox',
          '    When User enters "Test@123" text in "Password" textbox',
          '    When User clicks on "Login" button',
          '    Given User makes a "POST" request to "${login}"',
          '    Then the response status code is "200"',
          '    Then User verifies "Dashboard" text is present',
        ]),
        blankLine(),
        infoBox([
          [bold('Use Case: '), normal('UI+API Mode is best when you need to verify both the visible behaviour AND the underlying API contract in a single test — for example, submitting a form and confirming the API returned 200.')],
        ], GREEN_BG, GREEN),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 5: REVIEW PANEL ────────────────────────────────────────────
        h1('5. Review Panel'),
        para([
          normal('After clicking ⏹ Stop Recording, the Config Panel transitions to the '),
          bold('Review Panel'),
          normal('. The Review Panel shows a live preview of the files that will be saved.'),
        ]),
        blankLine(),

        h2('5.1 Review Panel Layout'),
        twoColTable([
          ['Area', 'Description'],
          ['File name (read-only)', 'The name you entered in the Config Panel. Shown as a reminder.'],
          ['Mode badge', 'Shows the capture mode used (UI / API / UI+API) as a coloured chip.'],
          ['.feature preview', 'Editable text area showing the full Gherkin feature file content. You can make manual edits before saving.'],
          ['.yaml preview', 'Editable text area showing the YAML locator file (visible only in UI and UI+API modes).'],
          ['💾 Save Files button', 'Writes both files to disk at the correct path and closes the panel.'],
          ['↩ Re-record button', 'Discards the current result and returns to the Config Panel to record again.'],
        ]),
        blankLine(),

        h2('5.2 Editing Before Saving'),
        para('Both text areas are editable. Common edits before saving:'),
        bullet([bold('Rename a locator key: '), normal('In the .yaml area, change a generic name like "Button_1" to "SubmitOrder".')]),
        bullet([bold('Add a missing step: '), normal('Paste an additional Gherkin step into the .feature area.')]),
        bullet([bold('Fix a URL token: '), normal('Replace a hardcoded URL with a ${aliasName} token (see Section 6).')]),
        bullet([bold('Remove a captured noise step: '), normal('Delete any step generated from an accidental click.')]),
        blankLine(),

        h2('5.3 Saved File Locations'),
        twoColTable([
          ['File type', 'Saved path'],
          ['.feature', 'e2e/features/generated/web/<name>.feature  (or /api/ for API-only mode)'],
          ['.yaml', 'e2e/locators/generated/web/<name>.yaml  (UI and UI+API modes only)'],
        ], 2000, 7360),
        blankLine(),
        infoBox([
          [bold('Note: '), normal('If a file with the same name already exists, it is overwritten. Rename your file before saving if you want to keep the previous version.')],
        ], AMBER_BG, AMBER),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 6: URL VARIABLE SUBSTITUTION ──────────────────────────────
        h1('6. URL Variable Substitution'),
        para([
          normal('URL variable substitution lets you use short '),
          code('${aliasName}'),
          normal(' tokens in feature files instead of full hardcoded URLs. The token is resolved at runtime by reading alias definitions from YAML files under '),
          code('e2e/locators/generated/'),
          normal('.'),
        ]),
        blankLine(),

        h2('6.1 Defining Aliases'),
        para([
          normal('Create or edit '),
          code('e2e/locators/generated/api/api.yaml'),
          normal(' and add a '),
          code('urls:'),
          normal(' section:'),
        ]),
        blankLine(),
        ...codeBlock([
          '# e2e/locators/generated/api/api.yaml',
          'urls:',
          '  login:   https://your-app.vercel.app/auth/login',
          '  service: https://your-app.vercel.app/services',
          '  users:   https://your-app.vercel.app/api/users',
        ]),
        blankLine(),
        para([
          normal('Each key under '),
          code('urls:'),
          normal(' becomes an alias. Keys are case-sensitive.'),
        ]),
        blankLine(),

        h2('6.2 Using Aliases in Feature Files'),
        para([
          normal('Replace any URL (or URL prefix) in a feature file step with '),
          code('${aliasName}'),
          normal(':'),
        ]),
        blankLine(),
        ...codeBlock([
          '# Without alias (fragile — breaks if the domain changes)',
          '    Given User navigates to "https://your-app.vercel.app/auth/login" URL',
          '',
          '# With alias (stable — change the URL once in api.yaml)',
          '    Given User navigates to "${login}" URL',
          '',
          '# Alias as a base URL prefix',
          '    Given User makes a "GET" request to "${service}/list"',
        ]),
        blankLine(),

        h2('6.3 How Resolution Works'),
        para('At runtime, before the step definition executes:'),
        numbered([code('resolveApiUrl(url)'), normal(' is called with the raw string from the feature file.')]),
        numbered([normal('All YAML files under '), code('e2e/locators/generated/'), normal(' are scanned recursively for a '), code('urls:'), normal(' section.')]),
        numbered([normal('Each '), code('${name}'), normal(' token is replaced with the matching URL value from the alias map.')]),
        numbered('Consecutive slashes in the resolved URL are de-duplicated (e.g. https://app.com//path → https://app.com/path).'),
        numbered('The resolved URL is passed to the Playwright action.'),
        blankLine(),

        h3('Alias Resolution Flow'),
        ...codeBlock([
          'Feature step:  "${service}/list"',
          '     │',
          '     ▼  resolveApiUrl("${service}/list")',
          '     │',
          '     ▼  Scan e2e/locators/generated/**/*.yaml',
          '     │  Found: service → https://your-app.vercel.app/services',
          '     │',
          '     ▼  Replace token: "https://your-app.vercel.app/services/list"',
          '     │',
          '     ▼  De-duplicate slashes (none here)',
          '     │',
          '     ▼  Playwright executes request to resolved URL  ✅',
        ]),
        blankLine(),

        h3('Alias Not Found Behaviour'),
        twoColTable([
          ['Situation', 'Behaviour'],
          ['Token matches an alias', 'Token is replaced with the full URL.'],
          ['Token does not match any alias', 'Token is left as-is (e.g. "${unknown}" remains literal). The step will fail at runtime with a URL error.'],
          ['No ${...} tokens in the URL', 'URL is returned unchanged. No alias lookup performed.'],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 7: RUNNING TESTS ───────────────────────────────────────────
        h1('7. Running Tests'),
        para('Once .feature and .yaml files are saved, run the tests using the built-in runner scripts:'),
        blankLine(),

        h2('7.1 Run Commands'),
        twoColTable([
          ['Command', 'What it runs'],
          ['npm run test:web', 'All .feature files under e2e/features/generated/web/'],
          ['npm run test:api', 'All .feature files under e2e/features/generated/api/'],
          ['npm run test:e2e', 'All .feature files under e2e/features/generated/endtoend/'],
          ['npm run test', 'All .feature files across all categories'],
        ]),
        blankLine(),
        para('Run a specific file by passing its name:'),
        blankLine(),
        ...codeBlock([
          '# Run just the login feature',
          'node e2e/support/scripts/run.js login',
          '',
          '# Run all api features',
          'node e2e/support/scripts/run.js api',
          '',
          '# Run with a tag filter',
          'node e2e/support/scripts/run.js login --tags @smoke',
        ]),
        blankLine(),

        h2('7.2 File Resolution Logic'),
        para('The run script resolves your argument in this order:'),
        numbered([bold('Exact file path: '), normal('If the argument is a valid .feature file path, it runs that file directly.')]),
        numbered([bold('Category name: '), normal('"web", "api", or "endtoend" runs all features in that category.')]),
        numbered([bold('File name without extension: '), normal('"login" matches any file named login.feature anywhere under e2e/features/')]),
        numbered([bold('Substring match: '), normal('"log" matches login.feature, logout.feature, etc.')]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 8: TERMINAL OUTPUT & REPORTS ──────────────────────────────
        h1('8. Terminal Output & Reports'),
        para([
          normal('The run script uses a custom Cucumber formatter ('),
          code('terminal-formatter.js'),
          normal(') that prints readable, colour-coded output to the terminal as tests execute.'),
        ]),
        blankLine(),

        h2('8.1 Terminal Output Format'),
        ...codeBlock([
          'Running 2 feature file(s):',
          '  - e2e/features/generated/web/login.feature',
          '  - e2e/features/generated/api/services-api.feature',
          '',
          'Scenario: login',
          '  ✓ Given User navigates to "https://app.example.com/login" URL',
          '  ✓ When User enters "john@example.com" text in "Email" textbox',
          '  ✓ When User clicks on "Login" button',
          '  ✓ Then User verifies "Dashboard" text is present',
          '  PASSED',
          '',
          'Scenario: services-api',
          '  ✓ Given User makes a "GET" request to "${service}/list"',
          '  ✗ Then the response status code is "200"',
          '    AssertionError: expected 401 to equal 200',
          '    at Object.<anonymous> (e2e/stepdefinitions/api.steps.ts:42:5)',
          '  FAILED',
          '',
          '────────────────────────────────────────────────',
          'Test Summary',
          '  ✓ 1 passed',
          '  ✗ 1 failed',
          '  Total: 2 scenario(s)',
          '',
          'Failed scenarios:',
          '  ✗ services-api',
          '    AssertionError: expected 401 to equal 200',
        ]),
        blankLine(),

        h2('8.2 Step Status Symbols'),
        twoColTable([
          ['Symbol', 'Meaning'],
          ['✓  (green)', 'Step passed'],
          ['✗  (red)', 'Step failed — error message and stack trace shown below'],
          ['-  (yellow)', 'Step skipped (due to a preceding step failure)'],
          ['?  (yellow)', 'Step has no matching step definition'],
        ], 2000, 7360),
        blankLine(),

        h2('8.3 HTML Report'),
        para([
          normal('An HTML report is saved at '),
          code('reports/integrationTests/cucumber-report.html'),
          normal(' after every run. Open it in a browser for a visual breakdown with screenshots (if configured) and step timing.'),
        ]),
        blankLine(),

        h2('8.4 Configuring the Report Folder'),
        para([
          normal('Edit '),
          code('e2e/config/config.yaml'),
          normal(' to change the report output location or enable parallel runs:'),
        ]),
        blankLine(),
        ...codeBlock([
          '# e2e/config/config.yaml',
          'run:',
          '  reportFolder: ./reports/integrationTests   # HTML report destination',
          '  maxInstances: 1                            # parallel workers (1 = serial)',
          '  tags: ""                                   # optional tag filter (@smoke, @regression)',
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 9: QUICK REFERENCE CARD ───────────────────────────────────
        h1('9. Quick Reference Card'),
        blankLine(),
        infoBox([
          [bold('Step 1: '), normal('Run  npm run record  in the terminal')],
          [bold('Step 2: '), normal('In the Config Panel — enter a file name and select a capture mode')],
          [bold('Step 3: '), normal('(API & UI+API) Add URL filter chips to limit captured network calls')],
          [bold('Step 4: '), normal('Click  ▶ Start Recording')],
          [bold('Step 5: '), normal('Navigate to your application URL and perform the test actions')],
          [bold('Step 6: '), normal('Click  ⏹ Stop Recording')],
          [bold('Step 7: '), normal('Review the .feature and .yaml previews — edit if needed')],
          [bold('Step 8: '), normal('Click  💾 Save Files')],
          [bold('Step 9: '), normal('Run tests:  npm run test:web  /  test:api  /  test:e2e')],
        ], GREEN_BG, GREEN),
        blankLine(),

        h2('Mode Selection Guide'),
        twoColTable([
          ['I want to…', 'Use mode'],
          ['Test a login form or any UI interactions', 'UI (Codegen)'],
          ['Verify an API endpoint returns the right status/body', 'API (Network)'],
          ['Test a form submission AND verify the API call it triggers', 'UI+API (Combined)'],
        ]),
        blankLine(),

        h2('Troubleshooting'),
        twoColTable([
          ['Problem', 'Solution'],
          ['Config Panel not visible', 'Scroll to the top-right corner of the browser. Resize the window if needed.'],
          ['No steps recorded (UI mode)', 'Ensure you clicked ▶ Start before performing actions. Stop and re-record.'],
          ['No API calls captured', 'Check that URL filters match your request URLs. Remove all filters to capture everything, then refine.'],
          ['${aliasName} not resolving', 'Verify the key exists under urls: in api.yaml. Keys are case-sensitive.'],
          ['Step definition not found', 'Check e2e/stepdefinitions/ — the step text must match an existing regex pattern exactly.'],
          ['HTML report not opening', 'Check the reportFolder path in e2e/config/config.yaml. Ensure the folder exists after the run.'],
        ]),
        blankLine(),

      ],
    },
  ],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, 'npm-run-record-documentation.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('✅ Document saved:', outPath);
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
