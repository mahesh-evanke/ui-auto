'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, Header, Footer, PageBreak, LevelFormat, UnderlineType,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ── Helpers ────────────────────────────────────────────────────────────────────

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

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

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
  const rs = Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 22, color: TEXT, font: 'Calibri' })];
  return new Paragraph({ children: rs, spacing: { before: 60, after: 80, ...spacing } });
}

function bold(text) { return new TextRun({ text, bold: true, size: 22, color: TEXT, font: 'Calibri' }); }
function normal(text) { return new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' }); }
function code(text) { return new TextRun({ text, font: 'Courier New', size: 20, color: '952900', highlight: 'yellow' }); }
function colored(text, color) { return new TextRun({ text, size: 22, color, font: 'Calibri' }); }

function bullet(text, level = 0) {
  const indent = level === 0 ? { left: 720, hanging: 360 } : { left: 1080, hanging: 360 };
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { before: 40, after: 40 },
    indent,
    children: Array.isArray(text) ? text : [new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' })],
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    spacing: { before: 40, after: 40 },
    indent: { left: 720, hanging: 360 },
    children: Array.isArray(text) ? text : [new TextRun({ text, size: 22, color: TEXT, font: 'Calibri' })],
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
        top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.SINGLE, size: 12, color: BRAND },
        right: { style: BorderStyle.NONE },
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
            children: Array.isArray(l) ? l : [new TextRun({ text: l, size: 21, color: textColor, font: 'Calibri' })],
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
              fill: ri === 0 ? DARK : (ci === 0 ? LIGHT_BG : WHITE),
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

// ── Document ───────────────────────────────────────────────────────────────────

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
              new TextRun({ text: 'npm run pw — Playwright Custom Recorder', size: 18, color: GRAY, font: 'Calibri' }),
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
          children: [new TextRun({ text: 'npm run pw', bold: true, size: 72, color: BRAND, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: 'Playwright Custom Recorder', bold: true, size: 40, color: DARK, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          spacing: { before: 0, after: 600 },
          children: [new TextRun({ text: 'Complete Feature Reference & How It Works', size: 26, color: GRAY, font: 'Calibri', italics: true })],
          alignment: AlignmentType.CENTER,
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND } },
        }),
        blankLine(),
        infoBox([
          [bold('Project: '), normal('playwright-cucumber-framework')],
          [bold('Command: '), code('npm run pw')],
          [bold('Entry point: '), code('ts-node e2e/support/recorder.ts')],
          [bold('Purpose: '), normal('Custom browser recorder — captures UI actions, API calls, or both and generates .feature + .yaml files automatically.')],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 1: OVERVIEW ────────────────────────────────────────────────
        h1('1. Overview'),
        para([
          normal('The '),
          code('npm run pw'),
          normal(' command launches a custom Playwright-powered recorder that opens a real Chromium browser with a floating toolbar injected into every page. Unlike '),
          code('playwright codegen'),
          normal(', this recorder is fully custom-built and operates in three capture modes: UI events, API network calls, or both simultaneously.'),
        ]),
        blankLine(),
        para([
          normal('The recorder is implemented in '),
          code('e2e/support/recorder.ts'),
          normal(' and uses Playwright\'s browser automation APIs — not the codegen inspector — to give full control over what is captured, how it is displayed, and how it is converted into Gherkin feature files.'),
        ]),
        blankLine(),

        h2('1.1 High-Level Flow'),
        blankLine(),
        ...codeBlock([
          'npm run pw',
          '     │',
          '     ▼',
          ' Chromium browser opens',
          '     │',
          '     ▼',
          ' Floating toolbar injected on every page',
          '  ┌─────────────────────────────────────────────────────┐',
          '  │  [filename]  [UI ▼]  [▶/⏸]  [⚡ Generate]           │',
          '  │              [Inspector]                             │',
          '  └─────────────────────────────────────────────────────┘',
          '     │',
          '     ▼',
          ' User navigates, clicks, fills forms',
          '     │',
          '     ▼',
          ' Injected JS marks elements with data-pw-rec-id',
          ' Playwright resolves best locator (getByRole → getByLabel → XPath)',
          '     │',
          '     ▼',
          ' User clicks ⚡ Generate',
          '     │',
          '     ▼',
          ' .feature file  →  e2e/features/generated/<category>/',
          ' .yaml locators →  e2e/locators/generated/<category>/',
        ]),
        blankLine(),

        h2('1.2 Technology Stack'),
        blankLine(),
        twoColTable([
          ['Component', 'Technology Used'],
          ['Browser launcher', 'Playwright chromium.launch()'],
          ['Recording script', 'Injected JavaScript via addInitScript()'],
          ['Selector resolution', 'Playwright page.locator() API'],
          ['API capture', 'Playwright page.on("request"/"response")'],
          ['Feature generation', 'Custom converter.ts pipeline'],
          ['Locator files', 'YAML format — [strategy, expression] tuples'],
          ['DOM Mode generation', 'Zero LLM — live DOM scanning'],
          ['Run & Auto-Fix', 'cucumber-js + DOM or LLM fix loop'],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 2: STARTING THE RECORDER ──────────────────────────────────
        h1('2. Starting the Recorder'),
        para([bold('Command:')]),
        blankLine(),
        ...codeBlock(['npm run pw']),
        blankLine(),
        para([
          normal('This executes: '),
          code('ts-node e2e/support/recorder.ts'),
          normal('. TypeScript is compiled on-the-fly using '),
          code('ts-node'),
          normal('. No pre-compilation step is required.'),
        ]),
        blankLine(),
        para('When the command runs:'),
        numbered('A new Chromium browser window opens.'),
        numbered('The custom floating toolbar is injected into every page you navigate to.'),
        numbered('You can immediately navigate to any URL in the browser\'s address bar.'),
        numbered('All toolbar controls are ready to use from the first page load.'),
        blankLine(),
        infoBox([
          [bold('Note: '), normal('The browser starts at the system default page. Navigate to your application URL directly in the address bar.')],
        ], AMBER_BG, AMBER),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 3: FLOATING TOOLBAR ────────────────────────────────────────
        h1('3. The Floating Toolbar'),
        para([
          normal('The floating toolbar is injected as a fixed-position overlay on every page you visit during the session. It is draggable, minimizable, and does not interfere with the application under test.'),
        ]),
        blankLine(),

        h2('3.1 Toolbar Layout'),
        blankLine(),
        ...codeBlock([
          '┌────────────────────────────────────────────────────────────┐',
          '│  ⋮⋮  Drag handle                                     [−]  │',
          '│  ─────────────────────────────────────────────────────     │',
          '│  [  filename input  ]  [UI ▼]  [▶ Start]  [⚡ Generate]   │',
          '│                                [Inspector]                  │',
          '└────────────────────────────────────────────────────────────┘',
        ]),
        blankLine(),

        h2('3.2 Toolbar Controls'),
        blankLine(),
        twoColTable([
          ['Control', 'Description'],
          ['File Name Input', 'Text field to set the output file name. Default: "recordedflow". The name is sanitized (spaces and special characters removed). Used as the base name for .feature and .yaml output files.'],
          ['Capture Mode (UI / API / UI+API)', 'Dropdown to select what to capture. See Section 4 for full details on each mode.'],
          ['Start / Stop Button (▶ / ⏸)', 'Green ▶ starts recording. Red ⏸ (pause bars) stops recording. Clicking Start with reset enabled clears all previously captured actions. The recording state persists across page navigations.'],
          ['⚡ Generate Button', 'Converts all captured actions into a .feature file and .yaml locator files. Saves them to disk immediately. The Inspector panel opens automatically showing the result.'],
          ['Inspector Button', 'Opens the Inspector side panel with three tabs: Feature file, Captured APIs, and Captured Objects.'],
          ['Minimize Button (−)', 'Collapses the toolbar body to save screen space. Click + to expand again.'],
          ['Drag Handle (⋮⋮)', 'Click and drag to reposition the toolbar anywhere on the screen.'],
        ], 2200, 7160),
        blankLine(),

        h2('3.3 API URL Filters Row'),
        para([
          normal('When '),
          code('API'),
          normal(' or '),
          code('UI+API'),
          normal(' mode is selected, an additional row appears below the toolbar:'),
        ]),
        blankLine(),
        ...codeBlock([
          '  Capture URLs:',
          '  [Name (e.g. api1)] [https://api.example.com]  [+ Add]',
          '  ┌─────────────────────────────────────────────────────┐',
          '  │  api1   https://api.example.com/v2     [×]          │',
          '  │  auth   https://auth.example.com/token  [×]         │',
          '  └─────────────────────────────────────────────────────┘',
        ]),
        blankLine(),
        twoColTable([
          ['Field', 'Description'],
          ['Name input', 'A short alias for this URL filter (e.g. "api1", "auth"). Used in the generated feature steps as URL aliases.'],
          ['URL input', 'The base URL to filter. Only network requests whose URL contains this string will be captured.'],
          ['+ Add button', 'Adds the filter to the active list. Duplicate URLs are automatically rejected.'],
          ['× chips', 'Each added filter appears as a chip. Click × to remove it. Changes take effect immediately.'],
        ]),
        blankLine(),
        infoBox([
          [bold('Tip: '), normal('Leave the URL filters empty to capture ALL network requests. Add filters to target specific APIs only (recommended for cleaner output).')],
        ], GREEN_BG, GREEN),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 4: CAPTURE MODES ───────────────────────────────────────────
        h1('4. Capture Modes'),
        para('The recorder supports three capture modes. Select the mode before clicking Start Recording.'),
        blankLine(),

        h2('4.1 UI Mode'),
        para([
          normal('Captures all user interface interactions: clicks, text input, dropdown selections, checkboxes, and radio buttons. This is the default mode and generates both '),
          code('.feature'),
          normal(' and '),
          code('.yaml'),
          normal(' locator files.'),
        ]),
        blankLine(),
        h3('What Gets Captured'),
        twoColTable([
          ['User Action', 'Gherkin Step Generated'],
          ['Click a button', 'When User clicks on "Login" button'],
          ['Click a link', 'When User clicks on "Home" link'],
          ['Type in a text field', 'When User enters "john@email.com" text in "Email" textbox'],
          ['Select a dropdown option', 'When User selects "Option A" from "Category" dropdown'],
          ['Check a checkbox', 'When User checks "Remember me" checkbox'],
          ['Select a radio button', 'When User selects "Male" radio button'],
          ['Navigate to a URL', 'Given User navigates to "https://example.com" URL'],
        ]),
        blankLine(),
        h3('Element Marking & Selector Resolution'),
        para([
          normal('When recording starts, every element the user interacts with receives a unique attribute '),
          code('data-pw-rec-id'),
          normal('. The Node.js side then asks Playwright to resolve the best locator for that element using a 5-priority strategy:'),
        ]),
        blankLine(),
        numbered([bold('getByRole'), normal(' — aria role + accessible name (e.g. button "Login")')]),
        numbered([bold('getByLabel'), normal(' — associated <label> text')]),
        numbered([bold('getByPlaceholder'), normal(' — input placeholder attribute')]),
        numbered([bold('getByText'), normal(' — visible text content')]),
        numbered([bold('XPath fallback'), normal(' — built from id, aria-label, name, placeholder, text')]),
        blankLine(),
        para([
          normal('The resolved locator is stored in the '),
          code('.yaml'),
          normal(' file as a '),
          code('[strategy, expression]'),
          normal(' tuple.'),
        ]),
        blankLine(),

        h2('4.2 API Mode'),
        para([
          normal('Captures all network requests and responses using Playwright\'s native '),
          code('page.on("request")'),
          normal(' and '),
          code('page.on("response")'),
          normal(' events. No JavaScript injection is required. Generates a '),
          code('.feature'),
          normal(' file only (no UI locators).'),
        ]),
        blankLine(),
        h3('What Gets Captured'),
        twoColTable([
          ['Data Captured', 'Details'],
          ['HTTP Method', 'GET, POST, PUT, DELETE, PATCH, etc.'],
          ['URL', 'Full URL with path and query string'],
          ['Request body', 'JSON body parsed into DataTable rows'],
          ['Response status code', 'e.g. 200, 201, 401, 404'],
          ['Response body', 'JSON body parsed into key-value DataTable'],
          ['Timestamp', 'For accurate ordering in UI+API mode'],
        ]),
        blankLine(),
        h3('Security — Header Redaction'),
        para('Sensitive headers are automatically redacted before saving:'),
        bullet([code('Authorization'), normal(' → replaced with '), code('"[REDACTED]"')]),
        bullet([code('Cookie'), normal(' → replaced with '), code('"[REDACTED]"')]),
        blankLine(),
        h3('Generated Gherkin Example'),
        ...codeBlock([
          'Given User sends POST request to "https://api.example.com/login"',
          '  with body:',
          '  | path     | value           |',
          '  | email    | "john@test.com" |',
          '  | password | "Test@123"      |',
          'Then User expects status code 200',
          'And User validates response has fields:',
          '  | path  | value          |',
          '  | token | "eyJhbGci..." |',
        ]),
        blankLine(),

        h2('4.3 UI+API Mode'),
        para([
          normal('Combines both UI event capture and API network capture in a single recording session. Generates a '),
          code('.feature'),
          normal(' file with UI steps and API steps interleaved by timestamp, plus '),
          code('.yaml'),
          normal(' locator files.'),
        ]),
        blankLine(),
        para('Steps from UI actions and API calls are merged into a single scenario ordered by the time they occurred, giving an accurate representation of what happened:'),
        blankLine(),
        ...codeBlock([
          'Scenario: User login flow',
          '  Given User navigates to "https://app.example.com/login" URL',
          '  Given User is on "loginPage" screen',
          '  When User enters "john@test.com" text in "Email" textbox',
          '  When User enters "Test@123" text in "Password" textbox',
          '  When User clicks on "Login" button',
          '  Given User sends POST request to "https://api.example.com/auth"',
          '    with body:',
          '    | path     | value           |',
          '    | email    | "john@test.com" |',
          '  Then User expects status code 200',
          '  Given User navigates to "https://app.example.com/dashboard" URL',
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 5: INSPECTOR PANEL ─────────────────────────────────────────
        h1('5. The Inspector Panel'),
        para([
          normal('Clicking the '),
          bold('Inspector'),
          normal(' button opens a side panel with three tabs. The panel is draggable, resizable, and remains open across the recording session.'),
        ]),
        blankLine(),

        h2('5.1 Feature File Tab'),
        para('The Feature File tab shows the live Gherkin feature content as steps are recorded. It updates in real time with every action.'),
        blankLine(),
        twoColTable([
          ['Feature', 'Description'],
          ['Live preview', 'The generated Gherkin feature file updates automatically after each recorded action.'],
          ['Editable', 'The text area is fully editable. You can manually add, remove, or modify steps before generating.'],
          ['Feature file path override', 'Optionally specify a custom output path for the .feature file instead of the auto-detected path.'],
          ['Locator folder override', 'Optionally specify a custom output folder for the .yaml locator files.'],
          ['Generate File button', 'Saves the current feature text (including any manual edits) to disk along with the locator YAML files.'],
        ]),
        blankLine(),
        infoBox([
          [bold('Dirty flag: '), normal('If you edit the feature text manually, a dirty flag is set. The next click of ⚡ Generate will use your edited version instead of re-generating from scratch.')],
        ], LIGHT_BG, DARK),
        blankLine(),

        h2('5.2 Captured APIs Tab'),
        para([
          normal('Only active when mode is '),
          code('API'),
          normal(' or '),
          code('UI+API'),
          normal('. Shows all captured network requests with filtering and management controls.'),
        ]),
        blankLine(),
        twoColTable([
          ['Control', 'Description'],
          ['Filter by URL input', 'Type any partial URL string to filter the list. Filtering is live (no button needed).'],
          ['Method dropdown', 'Filter by HTTP method: All, GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.'],
          ['Status code input', 'Filter by status code. Supports prefix matching: "4" shows all 4xx responses; "404" shows only 404.'],
          ['API cards', 'Each captured request shows: Method + Status badge, Full URL, Match key (method + normalized URL).'],
          ['Delete button', 'Removes the selected API call from the captured list. It will not appear in the generated feature file.'],
        ]),
        blankLine(),

        h2('5.3 Captured Objects Tab'),
        para('Shows all UI elements that have been captured during the recording session. Each element shows its resolved locator strategy and expression.'),
        blankLine(),
        twoColTable([
          ['Feature', 'Description'],
          ['Element name (editable)', 'The logical name of the element as it will appear in the Gherkin steps. You can rename elements here before generating.'],
          ['Strategy', 'The Playwright locator strategy used: xpath, css, getByRole, getByLabel, etc.'],
          ['Value', 'The actual locator expression used to find the element.'],
          ['Generate YAML button', 'Writes all currently captured objects to the .yaml locator file using the current file name.'],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 6: HOVER TOOLTIP ────────────────────────────────────────────
        h1('6. Element Hover Tooltip'),
        para([
          normal('When recording is active, hovering over any element on the page triggers a tooltip popup showing the resolved Playwright locator before you even click.'),
        ]),
        blankLine(),
        ...codeBlock([
          '┌─────────────────────────────────────────────────┐',
          '│  Login Button                                    │',
          '│  Strategy:  getByRole                           │',
          '│  Locator:   page.getByRole("button", {name:...})│',
          '│  Fallback:  //button[normalize-space(.)="Login"]│',
          '│                                                  │',
          '│  [+ Add to feature]   [+ Add to objects]        │',
          '└─────────────────────────────────────────────────┘',
        ]),
        blankLine(),
        twoColTable([
          ['Tooltip field', 'Description'],
          ['Element name', 'The readable name of the element (from aria-label, label, placeholder, or text content).'],
          ['Strategy', 'The Playwright locator strategy resolved for this element.'],
          ['Locator', 'The full Playwright locator expression.'],
          ['Fallback', 'The XPath fallback expression for non-Playwright environments.'],
          ['+ Add to feature', 'Appends a Gherkin step for this element to the feature editor (marks the editor dirty).'],
          ['+ Add to objects', 'Adds the element to the Captured Objects list and opens the Objects tab.'],
        ]),
        blankLine(),
        infoBox([
          [bold('Note: '), normal('The hover tooltip uses Playwright\'s selector engine to resolve the best possible locator in real time. This means even elements you hover over but do NOT click get a quality locator preview.')],
        ], LIGHT_BG, DARK),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 7: GENERATING OUTPUT ────────────────────────────────────────
        h1('7. Generating Output Files'),
        para([
          normal('Clicking '),
          bold('⚡ Generate'),
          normal(' (or the '),
          bold('Generate File'),
          normal(' button in the Inspector) saves the generated artifacts to disk.'),
        ]),
        blankLine(),

        h2('7.1 Output File Structure'),
        ...codeBlock([
          'e2e/',
          '├── features/',
          '│   └── generated/',
          '│       ├── web/',
          '│       │   └── myflow.feature       ← UI-only feature',
          '│       ├── api/',
          '│       │   └── myapi.feature        ← API-only feature',
          '│       └── endtoend/',
          '│           └── myflow.feature       ← UI+API feature',
          '└── locators/',
          '    └── generated/',
          '        ├── web/',
          '        │   ├── common.yaml          ← shared locators',
          '        │   └── loginPage.yaml       ← per-page locators',
          '        ├── api/',
          '        └── endtoend/',
        ]),
        blankLine(),

        h2('7.2 Category Auto-Detection'),
        para([
          normal('The '),
          bold('category'),
          normal(' ('),
          code('web'),
          normal(', '),
          code('api'),
          normal(', or '),
          code('endtoend'),
          normal(') is automatically determined by analysing the generated feature content:'),
        ]),
        blankLine(),
        threeColTable([
          ['Category', 'Condition', 'Description'],
          ['web', 'Has UI steps only', 'Feature contains click/input/navigate steps but no API steps'],
          ['api', 'Has API steps only', 'Feature contains only "sends GET/POST" and "expects status code" steps'],
          ['endtoend', 'Has both UI and API steps', 'Feature contains interleaved UI actions and API network calls'],
        ], 1600, 2400, 5360),
        blankLine(),

        h2('7.3 YAML Locator File Format'),
        para('Each page gets its own YAML file mapping element names to [strategy, expression] tuples:'),
        blankLine(),
        ...codeBlock([
          '# loginPage.yaml',
          'Email:',
          '  - xpath',
          '  - //input[@placeholder=\'Email\']',
          '',
          'Password:',
          '  - xpath',
          '  - //input[@type=\'password\']',
          '',
          'Login:',
          '  - xpath',
          '  - //button[normalize-space(.)=\'Login\']',
        ]),
        blankLine(),

        h2('7.4 Feature File Format'),
        para('Generated feature files follow the standard Cucumber Gherkin format:'),
        blankLine(),
        ...codeBlock([
          'Feature: Auto Generated Test',
          '',
          '  Scenario: User flow',
          '',
          '    Given User navigates to "https://app.example.com/login" URL',
          '    Given User is on "loginPage" screen',
          '    When User enters "john@test.com" text in "Email" textbox',
          '    When User enters "Test@123" text in "Password" textbox',
          '    When User clicks on "Login" button',
          '    Then User verifies "Welcome" text is present',
        ]),
        blankLine(),

        h2('7.5 Backup System'),
        para([
          normal('When a file already exists at the output path, the recorder automatically creates a '),
          bold('timestamped backup'),
          normal(' before overwriting:'),
        ]),
        blankLine(),
        ...codeBlock([
          'loginPage.feature.bak.2025-06-09T10-30-00-000Z   ← auto backup',
          'loginPage.feature                                 ← new version',
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 8: DOM MODE ─────────────────────────────────────────────────
        h1('8. DOM Mode — Generate Without Recording'),
        para([
          normal('DOM Mode generates a complete feature file and locator YAML from a plain English description — '),
          bold('without requiring any LLM or AI service'),
          normal('. It works by navigating the browser to the real application pages and scanning the live DOM.'),
        ]),
        blankLine(),
        para([
          normal('Access DOM Mode by clicking the '),
          bold('🔍 DOM Mode'),
          normal(' button in the toolbar.'),
        ]),
        blankLine(),

        h2('8.1 How It Works'),
        numbered('You describe your test scenario in plain English (e.g. "go to https://app.com, click Login button, enter email in Email field").'),
        numbered('You provide a file name for the output.'),
        numbered('Click 🔍 Generate.'),
        numbered('The parser converts the description into structured actions (navigate, click, fill, verify, etc.).'),
        numbered('The browser navigates to each URL in the description.'),
        numbered('For each UI action, the live DOM is scanned to find the matching element and generate the best locator.'),
        numbered('The generated .feature and .yaml appear in the text areas. Review them.'),
        numbered('Click 💾 Save to write them to disk.'),
        blankLine(),

        h2('8.2 Supported Plain English Actions'),
        twoColTable([
          ['English Phrase', 'Generated Gherkin Step'],
          ['"go to https://url" or "navigate to https://url"', 'Given User navigates to "https://url" URL'],
          ['"click the Login button" or "click on \'Submit\'"', 'When User clicks on "Login" button'],
          ['"enter \'john@test.com\' in the Email field"', 'When User enters "john@test.com" text in "Email" textbox'],
          ['"select \'Option A\' from the Category dropdown"', 'When User selects "Option A" from "Category" dropdown'],
          ['"check the Remember me checkbox"', 'When User checks "Remember me" checkbox'],
          ['"select the Male radio button"', 'When User selects "Male" radio button'],
          ['"verify \'Welcome\' text is present"', 'Then User verifies "Welcome" text is present'],
          ['"verify data from \'Orders\' table"', 'Then User verifies data from "Orders" table'],
        ]),
        blankLine(),

        h2('8.3 Multi-Page Scenarios'),
        para([
          normal('Use '),
          code('[pageKey]'),
          normal(' markers to define page boundaries. Each page gets its own '),
          code('.yaml'),
          normal(' locator file:'),
        ]),
        blankLine(),
        ...codeBlock([
          '[loginPage] go to https://app.com/login.',
          'Enter "john@test.com" in the Email field.',
          'Enter "Test@123" in the Password field.',
          'Click the Login button.',
          '',
          '[dashboardPage] Verify "Welcome" text is present.',
          'Click the Edit Profile button.',
        ]),
        blankLine(),
        para('This generates:'),
        bullet([code('loginPage.yaml'), normal(' — locators for the login page')]),
        bullet([code('dashboardPage.yaml'), normal(' — locators for the dashboard page')]),
        bullet([normal('A single '), code('.feature'), normal(' file with both pages combined')]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 9: RUN & AUTO-FIX ──────────────────────────────────────────
        h1('9. Run & Auto-Fix Loop'),
        para([
          normal('The Run & Auto-Fix loop runs a feature file with cucumber-js and, if it fails, automatically attempts to fix the locators and retry. Available in the '),
          bold('🔍 DOM Mode'),
          normal(' panel.'),
        ]),
        blankLine(),

        h2('9.1 How to Use'),
        numbered('Open the 🔍 DOM Mode panel (click the DOM Mode button in the toolbar).'),
        numbered('Scroll to the "▶ Run & Auto-Fix any feature file" section.'),
        numbered('Select a feature file from the dropdown (click ⟳ Refresh if needed).'),
        numbered('Set the Max Attempts (3 / 5 / 7 / 10 / Unlimited).'),
        numbered('Click 🔄 Run & Auto-Fix.'),
        numbered('Watch the terminal output area for live results.'),
        blankLine(),

        h2('9.2 DOM Auto-Fix Loop (Zero LLM)'),
        para('The DOM Mode auto-fix loop works without any AI service:'),
        blankLine(),
        ...codeBlock([
          'Iteration 1: Run cucumber-js',
          '     │',
          '     ├─ PASS ──────────────────────────────────────────────► Done ✅',
          '     │',
          '     └─ FAIL',
          '          │',
          '          ▼  Parse error: Element "X" not found in page "Y"',
          '          │',
          '          ▼  Replay steps in live browser tab',
          '          │',
          '          ▼  Scan live DOM for element matching "X"',
          '          │   (by id, placeholder, aria-label, text, label)',
          '          │',
          '          ▼  Found → write corrected XPath to .yaml',
          '          │',
          '          ▼  Retry cucumber-js',
          '          │',
          '     Iteration 2, 3 ... n',
        ]),
        blankLine(),
        h3('Element Matching Algorithm'),
        para('The DOM scanner uses a scoring system to find the right element:'),
        twoColTable([
          ['Score', 'Match Type'],
          ['100', 'Exact match on id, placeholder, aria-label, label, or text'],
          ['55', 'Partial match — element value contains the search term'],
          ['45', 'Partial match — search term contains element value'],
        ]),
        blankLine(),
        h3('Locator Priority Order (DOM Fix)'),
        numbered([code('//*[@id=\'...\']'), normal(' — unique id (highest confidence)')]),
        numbered([code('//input[@placeholder=\'...\']'), normal(' — placeholder text')]),
        numbered([code('//button[normalize-space()=\'...\']'), normal(' — button text')]),
        numbered([code('//label[...]/following-sibling::input'), normal(' — label + sibling input')]),
        numbered([code('//*[@name=\'...\']'), normal(' — name attribute')]),
        numbered([code('//input[@type=\'email|password\']'), normal(' — input type (last resort)')]),
        blankLine(),

        h2('9.3 Max Iterations'),
        twoColTable([
          ['Setting', 'Behaviour'],
          ['3', 'Tries up to 3 fix cycles. Stops after 3rd failure.'],
          ['5 (default)', 'Tries up to 5 fix cycles.'],
          ['7', 'Tries up to 7 fix cycles.'],
          ['10', 'Tries up to 10 fix cycles.'],
          ['Unlimited', 'Tries up to 100 fix cycles (internal safety cap).'],
        ]),
        blankLine(),

        h2('9.4 Upload Your Own Files'),
        para('You can upload your own .feature and .yaml files to run through the auto-fix loop:'),
        numbered('Drag and drop .feature and/or .yaml files onto the drop zone (or click to browse).'),
        numbered('Files appear as chips showing their names.'),
        numbered('Click 🔄 Save & Run Auto-Fix to save the files to the project and immediately start the fix loop.'),
        numbered('The feature file is saved to the correct generated/<category>/ folder based on its content.'),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 10: RECORDING LIFECYCLE ────────────────────────────────────
        h1('10. Recording Lifecycle & State Management'),
        para('Understanding how the recording state is managed helps explain why it works reliably across page navigations.'),
        blankLine(),

        h2('10.1 Cross-Navigation Persistence'),
        para([
          normal('The recorder uses Playwright\'s '),
          code('context.addInitScript()'),
          normal(' to inject the toolbar and event listeners into every page that loads during the session. This means:'),
        ]),
        blankLine(),
        bullet('Clicking a link that navigates to a new URL does NOT stop recording.'),
        bullet('The toolbar re-appears on the new page with the same state.'),
        bullet('All previously captured steps remain in memory on the Node.js side.'),
        bullet([
          normal('The '),
          code('pwRecorderGetRecordingState()'),
          normal(' exposed function lets each new page re-sync with the Node.js recording flag.'),
        ]),
        blankLine(),

        h2('10.2 Exposed Node.js Functions'),
        para([
          normal('The recorder exposes several functions to the browser page via '),
          code('page.exposeFunction()'),
          normal('. These bridge the browser context to the Node.js process:'),
        ]),
        blankLine(),
        twoColTable([
          ['Exposed Function', 'Purpose'],
          ['pwRecorderSetRecording(value, reset)', 'Starts or stops recording. When reset=true, clears all previously captured actions.'],
          ['pwRecorderGetRecordingState()', 'Returns { recording: boolean } so freshly-loaded pages can restore the toolbar state.'],
          ['pwRecorderRequestSync()', 'Re-pushes the accumulated feature preview to the current page after navigation.'],
          ['pwRecorderSetCaptureSelection(mode)', 'Updates the capture mode (UI / API / UI+API) from the toolbar dropdown.'],
          ['pwRecorderSetApiUrlFilters(filters)', 'Updates the active URL filter list when the user adds/removes filters.'],
          ['pwRecorderGenerate(opts)', 'Triggers the converter pipeline and saves .feature + .yaml files.'],
          ['pwRecorderGetCapturedApis()', 'Returns the current list of captured API calls to the APIs tab.'],
          ['pwRecorderDeleteCapturedApi({ index })', 'Removes a specific API call from the captured list.'],
          ['pwRecorderGetCapturedObjects()', 'Returns the list of captured UI elements to the Objects tab.'],
          ['pwRecorderGenerateInspectorYaml(opts)', 'Generates a YAML file from the Objects tab contents.'],
          ['pwRecorderDomScan(opts)', 'Runs the DOM Mode scan (parse description, navigate, find elements).'],
          ['pwRecorderAiGenerateSave(opts)', 'Saves generated feature + YAML content to disk.'],
          ['pwRecorderStartFixLoop(opts)', 'Starts the Run & Auto-Fix loop for a feature file.'],
          ['pwRecorderGetLoopStatus({ loopId })', 'Polls the fix loop progress (done, iterations, log, statusLine).'],
          ['pwRecorderListFeatureFiles()', 'Returns all .feature files in the project for the file picker.'],
          ['pwRecorderSaveUploadedFiles(opts)', 'Saves drag-and-dropped files to the project.'],
        ], 2600, 6760),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 11: OUTPUT FORMATS ──────────────────────────────────────────
        h1('11. Full Output File Reference'),
        blankLine(),

        h2('11.1 Feature File (.feature)'),
        twoColTable([
          ['Property', 'Value'],
          ['Location', 'e2e/features/generated/<category>/<filename>.feature'],
          ['Format', 'Gherkin BDD format (Given/When/Then/And/But)'],
          ['Encoding', 'UTF-8'],
          ['Auto-category', 'web, api, or endtoend — detected from step keywords'],
          ['Backup', 'Previous version saved as .bak.<timestamp> if exists'],
        ]),
        blankLine(),

        h2('11.2 Locator YAML File (.yaml)'),
        twoColTable([
          ['Property', 'Value'],
          ['Location', 'e2e/locators/generated/<category>/<pageKey>.yaml'],
          ['Format', 'YAML — top-level keys are element names, values are [strategy, expression] arrays'],
          ['Strategy values', 'xpath, css, getByRole, getByLabel, getByPlaceholder, getByText'],
          ['Per-page', 'One .yaml file per page key (defined by "User is on X screen" step)'],
          ['Common file', 'common.yaml — for shared locators across multiple pages'],
        ]),
        blankLine(),

        h2('11.3 Pages Registry (pages.yaml)'),
        para([
          normal('Every page is also registered in '),
          code('e2e/locators/pages.yaml'),
          normal(', which maps page keys to their title and label:'),
        ]),
        blankLine(),
        ...codeBlock([
          '# e2e/locators/pages.yaml',
          'loginPage:',
          '  - title: Login Page',
          '  - label: Login Page',
          '',
          'dashboardPage:',
          '  - title: Dashboard',
          '  - label: Dashboard',
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 12: COMPLETE COMMAND REFERENCE ──────────────────────────────
        h1('12. All Available npm Scripts'),
        para('The full list of commands available in this project:'),
        blankLine(),
        twoColTable([
          ['Command', 'Description'],
          ['npm run pw', 'CUSTOM RECORDER — launches the custom recorder with floating toolbar. Full UI/API/UI+API capture.'],
          ['npm run record', 'CODEGEN RECORDER — launches the new config-panel recorder. UI mode uses playwright codegen; API/UI+API use programmatic capture.'],
          ['npm run generate', 'Runs the generate script to create boilerplate files.'],
          ['npm run cucumber', 'Runs all tests with cucumber-js.'],
          ['npm run run', 'Runs all tests.'],
          ['npm run test:all', 'Runs all tests (same as npm run run).'],
          ['npm run test:web', 'Runs only web (UI) feature tests.'],
          ['npm run test:api', 'Runs only API feature tests.'],
          ['npm run test:e2e', 'Runs only end-to-end (UI+API) feature tests.'],
        ]),
        blankLine(),

        h2('12.1 npm run pw vs npm run record'),
        twoColTable([
          ['Aspect', 'npm run pw', 'npm run record'],
          ['Recording engine', 'Custom JS injection', 'Playwright codegen (UI mode)'],
          ['Config location', 'In-browser floating toolbar', 'In-browser config panel (opens first)'],
          ['Locator quality', 'Playwright selector resolution', 'Playwright codegen quality (UI mode)'],
          ['Inspector panel', 'Yes — 3-tab panel', 'No'],
          ['Hover tooltip', 'Yes', 'No'],
          ['DOM Mode', 'Yes — zero LLM generation', 'No'],
          ['Run & Auto-Fix', 'Yes — built in', 'No'],
          ['API URL filters', 'Yes — named chips', 'Yes — unnamed list'],
          ['Best for', 'Advanced recording with full features', 'Quick recording with codegen quality'],
        ]),
        blankLine(),
        new Paragraph({ children: [new PageBreak()] }),

        // ── SECTION 13: QUICK REFERENCE CARD ───────────────────────────────────
        h1('13. Quick Reference Card'),
        blankLine(),
        infoBox([
          [bold('Step 1: '), normal('Run  npm run pw  in your terminal')],
          [bold('Step 2: '), normal('Navigate to your application URL in the browser address bar')],
          [bold('Step 3: '), normal('In the toolbar — type a file name, select mode (UI / API / UI+API)')],
          [bold('Step 4: '), normal('Click ▶ Start Recording')],
          [bold('Step 5: '), normal('Perform your test actions in the browser')],
          [bold('Step 6: '), normal('Click ⏸ Stop  (or click ⚡ Generate directly)')],
          [bold('Step 7: '), normal('Click ⚡ Generate — files are saved automatically')],
          [bold('Step 8: '), normal('Run tests with  npm run test:web  (or test:api / test:e2e)')],
        ], GREEN_BG, GREEN),
        blankLine(),

        h2('Keyboard Tips'),
        twoColTable([
          ['Action', 'How'],
          ['Minimize toolbar', 'Click the − button in the toolbar drag handle'],
          ['Move toolbar', 'Click and drag the grip dots in the top-left of the toolbar'],
          ['Move Inspector panel', 'Click and drag the "Inspector — drag to move" header'],
          ['Resize Inspector panel', 'Drag the bottom-right corner of the Inspector panel'],
          ['Add URL filter (API mode)', 'Type the URL and press Enter (no need to click + Add)'],
          ['Move between name and URL filter fields', 'Press Enter in the Name field to jump to URL field'],
        ]),
        blankLine(),

        h2('Troubleshooting'),
        twoColTable([
          ['Problem', 'Solution'],
          ['Toolbar not visible', 'Scroll to the top-right of the page. It may be behind a fixed header — drag it to a different position.'],
          ['Steps not being captured', 'Ensure recording is active (button shows red ⏸ pause icon). If green ▶ is shown, recording is stopped.'],
          ['Generated feature is empty', 'Check that you clicked ▶ Start before performing actions. The toolbar resets on browser refresh if recording was stopped.'],
          ['API calls not appearing', 'Verify mode is API or UI+API. Check URL filters — if a filter is set, only matching URLs are captured.'],
          ['Wrong locator in YAML', 'Open the Inspector → Captured Objects tab, edit the element name or locator, then click Generate YAML.'],
          ['Auto-fix loop not fixing', 'The error format must contain "Element X not found in page Y". Check the error output. Some failures require manual locator correction.'],
        ]),
        blankLine(),

      ],
    },
  ],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(__dirname, 'npm-run-pw-documentation.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('✅ Document saved:', outPath);
}).catch(err => {
  console.error('❌ Error:', err.message);
});
