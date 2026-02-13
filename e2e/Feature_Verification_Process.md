# Feature File Generation — Text & Web Table Verification Process

This document maps **user selection** (text vs web table) to **Gherkin statements** and **TypeScript step definitions** in `e2e/stepdefinitions/web_actions_stepdefs.ts`, and describes how “verify text is correct” is implemented in each case.

---

## 1. User selects **TEXT** (verify text is correct)

When the user selects **text** as the verification target, use one of the following depending on what you need to verify.

| # | Gherkin statement | Step def (file: line) | What it verifies |
|---|-------------------|------------------------|-------------------|
| 1 | `When Verify field {string} text is {string}` | `web_actions_stepdefs.ts` ~31 | **Field text equals expected.** Resolves element by **field name** (locator), gets its text, normalizes (remove special chars), and asserts actual === expected. Use when verifying a **named field** (e.g. label, heading, result field). |
| 2 | `When verify {string} text is present on the screen` | `web_actions_stepdefs.ts` ~362 | **Text snippet is visible.** Waits for and finds any element whose text **contains** the given string (e.g. `<CURRENT_DATE>` replaced with today). Asserts element is displayed. Use when you only need to check that some **text appears** on the page. |
| 3 | `When verify {string} text is present in {string} popup window` | `web_actions_stepdefs.ts` ~1186 | Same as above but **inside a specific popup** (by popup object name). |
| 4 | `When verify {string} text is present in popup window` | `web_actions_stepdefs.ts` ~1198 | Same as “present on screen” but checks **alert/popup text** (no specific popup object). |

**Parameters:**

- **Text (field/snippet):**  
  - For **“Verify field X text is Y”**: first `{string}` = field/element name (from locators), second = expected text.  
  - For **“verify X text is present…”**: single `{string}` = the text (or substring) that must appear; supports `<CURRENT_DATE>`.

**Verification behavior:**  
- “Verify field … text is …” → **exact match** after normalizing (special chars removed).  
- “verify … text is present…” → **containment** (text is visible on screen or in popup).  
So for “user selects text” and “verify text is correct”: use **#1** when you have a specific field and exact value; use **#2–4** when you only need to confirm that a text snippet is present.

---

## 2. User selects **WEB TABLE** (verify table data is correct)

When the user selects **web table** as the verification target, use one of the following. All expect a **table identifier** (e.g. element `id`) and a **Gherkin DataTable** with expected headers and rows.

| # | Gherkin statement | Step def (file: line) | What it verifies |
|---|-------------------|------------------------|-------------------|
| 1 | `When verify data from {string} web table` | `web_actions_stepdefs.ts` ~396 | **Generic table:** table with `id={string}`. Verifies column headers (first row of DataTable) match `th`; then each data row matches corresponding `tr/td`. Supports `<CURRENT_DATE>` and `<CURRENT_DATE+15>` in expected cells. |
| 2 | `When verify information from {string} webtable` | `web_actions_stepdefs.ts` ~554 | **Column-keyed table:** same idea (headers + rows by `id`). Compares by matching header text to DataTable columns, then each row’s cells to expected row. No date placeholders. |
| 3 | `When verify data from {string} webtable` | `web_actions_stepdefs.ts` ~966 | **App-specific table:** table by `id` with CCE/enrollment placeholders (e.g. `<HI_TYPE>`, `<CURRENT_DATE>`, `<SMI_Start_Date>`, etc.). Replaces placeholders then asserts headers and each row. |
| 4 | `Then verify data from {string} webtable dates` | `web_actions_stepdefs.ts` ~928 | **Date-only table:** for table `periodinsuredstatus`; replaces date formula in DataTable then verifies one data row’s dates. |

**Parameters:**

- **Table:** `{string}` = DOM `id` of the table container (e.g. `"myTableId"`).  
- **Expected data:** Gherkin **DataTable**: first row = column headers; following rows = expected cell values.

**Verification behavior:**  
- **#1 & #2:** Headers must match; each body row’s cell text must match expected row (exact or after placeholder replacement).  
- **#3:** Same, plus app-specific placeholders resolved before compare.  
- **#4:** Focused on date row comparison after resolving date formula.  
So for “user selects web table” and “verify text/data is correct”: pick **#1** for a generic table with optional date placeholders; **#2** for a simple header+row match; **#3** when using CCE/enrollment placeholders; **#4** for the dates-only table.

---

## 3. Quick decision guide

| User selection | Goal | Recommended Gherkin |
|----------------|------|----------------------|
| **Text** | Exact value of a **named field** | `When Verify field "<fieldName>" text is "<expectedText>"` |
| **Text** | A **text snippet** is visible on the page | `When verify "<textSnippet>" text is present on the screen` |
| **Text** | Text is visible **in a popup** | `When verify "<textSnippet>" text is present in "<popupObj>" popup window` or `... in popup window` |
| **Web table** | Generic table (headers + rows, optional dates) | `When verify data from "<tableId>" web table` + DataTable |
| **Web table** | Simple table (headers + rows) | `When verify information from "<tableId>" webtable` + DataTable |
| **Web table** | Table with CCE/enrollment placeholders | `When verify data from "<tableId>" webtable` + DataTable |
| **Web table** | Dates row in periodinsuredstatus | `Then verify data from "periodinsuredstatus" webtable dates` + DataTable |

---

## 4. Reference: CSV and step def alignment

The file `e2e/Gherkin_Statements_Process.xlsx.csv` lists the same Gherkin statements and points to `web_actions_stepdefs.ts`. For **text** and **web table** verification, the mapping is:

- **Text:** Rows in CSV for “Verify field … text is …” and “verify … text is present …” → same step defs as in Section 1.  
- **Web table:** Rows for “verify data from … web table”, “verify information from … webtable”, “verify data from … webtable”, “verify data from … webtable dates” → same step defs as in Section 2.

When generating feature files from this process, use the **exact** Gherkin text (including “web table” vs “webtable”) so Cucumber matches the correct step definition.
