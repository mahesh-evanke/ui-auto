#!/usr/bin/env node
/**
 * Reads exported screens JSON and generates features + locators into e2e/generated/<domain>/.
 * Structure: e2e/generated/<domain>/features/ and e2e/generated/<domain>/locators/pages/.
 *
 * Usage: node generate-locators-and-features.js [--domain=web] <path-to-screens.json>
 *   --domain=web|api|db|end-to-end|mobile  (default: web)
 * Or pipe JSON: node generate-locators-and-features.js
 */

const fs = require("fs");
const path = require("path");
const {
    validateDomain,
    getGeneratedPaths,
    ensureDir,
    ensureLocatorStructure,
    updatePagesJson: updatePagesJsonUtil,
} = require("./generation-utils.js");

function generateScreenJson(screen) {
    const out = {};
    (screen.elements || []).forEach((el) => {
        const logicalName = (el.logicalName || "").trim();
        const selType = (el.selectorType || "").trim();
        const selVal = (el.selectorValue || "").trim();
        if (!logicalName || !selType || !selVal) return;
        out[logicalName] = [selType, selVal];
    });
    return out;
}

function safeFileName(name) {
    const base = String(name || "Screen")
        .replace(/[\\\/:\*\?"<>\|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[\. ]+$/g, "");
    return base || "Screen";
}

/**
 * Parse requestBody (string or object) and return rows for Gherkin table: [{ path, value }].
 * Value is formatted for api.steps: strings in double quotes, numbers/booleans unquoted.
 */
function requestBodyToTableRows(requestBody) {
    if (requestBody == null) return [];
    let obj = requestBody;
    if (typeof requestBody === "string") {
        const s = requestBody.trim();
        if (!s) return [];
        try {
            obj = JSON.parse(s);
        } catch (e) {
            return [];
        }
    }
    if (typeof obj !== "object" || obj === null) return [];
    const rows = [];
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
        const path = keys[i];
        const v = obj[path];
        let valueCell;
        if (typeof v === "string") valueCell = '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        else if (typeof v === "number") valueCell = String(v);
        else if (typeof v === "boolean") valueCell = v ? "true" : "false";
        else if (v !== null && typeof v === "object") valueCell = '"' + JSON.stringify(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        else valueCell = '""';
        rows.push({ path, value: valueCell });
    }
    return rows;
}

/**
 * @param {object} screen - screen payload
 * @param {string} [pageNameForLocator] - page name used to load locator JSON (e.g. "generated/radio/Screen" so framework finds pages/generated/radio/Screen.json)
 */
function generateFeatureLines(screen, pageNameForLocator) {
    const screenId = screen.screenId || "Screen";
    const pageUrl = screen.page || "";
    const pageName = (pageNameForLocator != null && pageNameForLocator !== "") ? pageNameForLocator : screenId;
    const lines = [
        `Feature: ${screenId}`,
        "",
        "  @smoke",
        "  Scenario: Interact with captured elements",
        `    Given User navigates to "${(pageUrl || "").replace(/"/g, '\\"')}" URL`,
        `    And User is on "${(pageName || "").replace(/"/g, '\\"')}" screen`
    ];

    function esc(s) { return (s == null ? "" : String(s)).replace(/"/g, '\\"'); }

    // Use LLM-generated scenarioSteps when present (from user prompt, e.g. "verify Name and DOB in web table").
    if (screen.scenarioSteps && Array.isArray(screen.scenarioSteps) && screen.scenarioSteps.length > 0) {
        screen.scenarioSteps.forEach((s) => {
            const kw = (s.keyword || "When").trim();
            const stepText = (s.step || "").trim();
            if (!stepText) return;
            const prefix = kw === "And" ? "And " : kw + " ";
            lines.push(`    ${prefix}${stepText}`);
            if (s.dataTable && Array.isArray(s.dataTable) && s.dataTable.length > 0) {
                s.dataTable.forEach((row) => {
                    const cells = (row || []).map((c) => String(c ?? "").replace(/\|/g, "\\|").trim());
                    lines.push(`      | ${cells.join(" | ")} |`);
                });
            }
        });
        return lines.join("\n") + "\n";
    }

    (screen.elements || []).forEach((el) => {
        const logicalName = (el.logicalName || "").trim() || "Element";
        const objectType = (el.objectType || "").toLowerCase();
        // Recorder stores captured values as `inputValue` (newer), older exports may use `value`.
        const valueRaw = (el && (el.inputValue != null ? el.inputValue : el.value));
        const value = (valueRaw != null && valueRaw !== "") ? String(valueRaw).trim() : "";
        if (objectType === "textbox") {
            lines.push(`    And enters "default_value" text in "${esc(logicalName)}" textbox`);
        } else if (objectType === "button") {
            lines.push(`    When clicks on "${esc(logicalName)}" button`);
        } else if (objectType === "link") {
            lines.push(`    When clicks on "${esc(logicalName)}" link`);
        } else if (objectType === "checkbox") {
            lines.push(`    Given select "${esc(logicalName)}" Checkbox`);
        } else if (objectType === "radio") {
            lines.push(`    When clicks on "${esc(logicalName)}" Radio button`);
        } else if (objectType === "dropdown") {
            const optionVal = value || "option1";
            lines.push(`    When selects "${esc(optionVal)}" from "${esc(logicalName)}" Drop-down list`);
        } else if (objectType === "other") {
            const textToVerify = value || logicalName;
            if (textToVerify) {
                lines.push(`    When verify "${esc(textToVerify)}" text is present on the screen`);
            }
        }
    });

    // Optional: web table selection recorded by the automation recorder.
    // We reuse the existing step definition:
    //   When verify data from "{name}" web table
    //     | ... |
    if (screen && screen.selectedTable && screen.selectedTable.name && Array.isArray(screen.selectedTable.data)) {
        const t = screen.selectedTable;
        const name = String(t.name).replace(/"/g, '\\"');
        const data = t.data;
        if (data.length > 0 && Array.isArray(data[0])) {
            lines.push(``);
            lines.push(`    When verify data from "${name}" web table`);
            data.forEach((row) => {
                const cells = (row || []).map((c) => String(c ?? "").replace(/\|/g, "\\|").trim());
                lines.push(`      | ${cells.join(" | ")} |`);
            });
        }
    }

    return lines.join("\n") + "\n";
}

/**
 * Generates locator JSON from UI actions for one page.
 *
 * Important: The feature generator emits steps like:
 *   When clicks on "<Logical Name>" button
 * So the locator JSON keys should match the same logical names to keep the system easy to reason about.
 *
 * Note: We intentionally do NOT emit multiple keys for one element (e.g. no "EmailAddress" alias).
 * The key should match the Gherkin text (logicalName) to keep generated JSON clean and predictable.
 * @param {Array} uiActions - [{ logicalName, selectorType, selectorValue }]
 * @returns {Object} e.g. { "emailField": ["css", "#email"], "loginButton": ["xpath", "//button"] }
 */
function generateLocatorJson(uiActions) {
    const out = {};
    (uiActions || []).forEach((a) => {
        const name = String(a.logicalName || "Element").replace(/\s+/g, " ").trim() || "Element";
        const selType = (a.selectorType || "css").toLowerCase();
        const val = (a.selectorValue || "").trim();
        if (!val) return;

        // Keep the selector type as-is so consumers can use id/name/data-testid/etc.
        const locatorTuple = [selType, val];

        // Primary key matches the Gherkin logical name exactly (whitespace normalized).
        out[name] = locatorTuple;
    });
    return out;
}

/**
 * Emit grouped UI step lines for a subset of uiActions (same grouping: textboxes, checkboxes, radio, dropdown, button, link).
 * @param {Array} uiActions - list of action objects
 * @param {Function} esc - escape function
 * @returns {string[]} Gherkin lines (without leading spaces; caller adds "    ")
 */
function emitGroupedUiLines(uiActions, esc) {
    const lines = [];
    const textboxByKey = {};
    const textboxOrder = [];
    const buttonByKey = {};
    const buttonOrder = [];
    const linkByKey = {};
    const linkOrder = [];
    const checkboxByKey = {};
    const checkboxOrder = [];
    const radioByKey = {};
    const radioOrder = [];
    const dropdownByKey = {};
    const dropdownOrder = [];
    (uiActions || []).forEach((a) => {
        const key = (a.logicalName || "") + "|" + (a.selectorValue || "");
        const objType = (a.objectType || "").toLowerCase();
        const val = (a.inputValue != null && String(a.inputValue).trim() !== "") ? esc(String(a.inputValue).trim()) : "";
        const name = a.logicalName || "Element";
        if (objType === "textbox") {
            if (!textboxByKey[key]) textboxOrder.push(key);
            textboxByKey[key] = { logicalName: name, value: val || "12345" };
        } else if (objType === "button") {
            if (!buttonByKey[key]) buttonOrder.push(key);
            buttonByKey[key] = name;
        } else if (objType === "link") {
            if (!linkByKey[key]) linkOrder.push(key);
            linkByKey[key] = name;
        } else if (objType === "checkbox") {
            if (!checkboxByKey[key]) checkboxOrder.push(key);
            checkboxByKey[key] = name;
        } else if (objType === "radio") {
            if (!radioByKey[key]) radioOrder.push(key);
            radioByKey[key] = name;
        } else if (objType === "dropdown") {
            if (!dropdownByKey[key]) dropdownOrder.push(key);
            dropdownByKey[key] = { logicalName: name, value: val || "option1" };
        } else {
            if (!buttonByKey[key]) buttonOrder.push(key);
            buttonByKey[key] = name;
        }
    });
    textboxOrder.forEach((k) => {
        const o = textboxByKey[k];
        lines.push(`And enters "${o.value}" text in "${esc(o.logicalName)}" textbox`);
    });
    checkboxOrder.forEach((k) => {
        lines.push(`And select "${esc(checkboxByKey[k])}" Checkbox`);
    });
    radioOrder.forEach((k) => {
        lines.push(`When clicks on "${esc(radioByKey[k])}" Radio button`);
    });
    dropdownOrder.forEach((k) => {
        const o = dropdownByKey[k];
        lines.push(`When selects "${esc(o.value)}" from "${esc(o.logicalName)}" Drop-down list`);
    });
    buttonOrder.forEach((k) => {
        lines.push(`When clicks on "${esc(buttonByKey[k])}" button`);
    });
    linkOrder.forEach((k) => {
        lines.push(`When clicks on "${esc(linkByKey[k])}" link`);
    });
    return lines;
}

/**
 * Emit UI step lines preserving original action order.
 * This is critical when actions depend on prior UI state (e.g., click opens a modal before selecting a dropdown inside it).
 * @param {Array} uiActions
 * @param {Function} esc
 * @returns {string[]}
 */
function emitUiLinesInOrder(uiActions, esc) {
    const lines = [];
    (uiActions || []).forEach((a) => {
        const objType = (a.objectType || "").toLowerCase();
        const name = a.logicalName || "Element";
        const nameEsc = esc(name);
        const rawVal = (a.inputValue != null && String(a.inputValue).trim() !== "") ? String(a.inputValue).trim() : "";
        const valEsc = esc(rawVal);

        if (objType === "textbox") {
            lines.push(`And enters "${valEsc || "12345"}" text in "${nameEsc}" textbox`);
        } else if (objType === "checkbox") {
            lines.push(`And select "${nameEsc}" Checkbox`);
        } else if (objType === "radio") {
            lines.push(`When clicks on "${nameEsc}" Radio button`);
        } else if (objType === "dropdown") {
            lines.push(`When selects "${valEsc || "option1"}" from "${nameEsc}" Drop-down list`);
        } else if (objType === "link") {
            lines.push(`When clicks on "${nameEsc}" link`);
        } else {
            // default to button/click behavior (matches legacy generator fallback)
            lines.push(`When clicks on "${nameEsc}" button`);
        }
    });
    return lines;
}

/**
 * Build Web UI + API feature content using existing step definitions.
 * When timestamps are present, emits UI and API steps in chronological order (sequence as on website).
 * - UI: web_actions_stepdefs (navigate, screen, textbox, checkbox, radio, dropdown, button, link)
 * - API: api.steps (User sends METHOD request / User expects status code)
 * @param {Object} step - { stepName, uiActions, apis, page?, screenId? } (actions/apis may have timestamp)
 * @param {boolean} expandedUi - if true, emit full UI steps; if false, emit Given user performs "<stepName>"
 * @param {string} [pageKey] - key used in pages.json (e.g. "generated/misha"); when set, "User is on ... screen" uses this so feature matches pages.json
 */
function generateWebuiApiFeatureContent(step, expandedUi, pageKey) {
    const esc = (s) => (s == null ? "" : String(s)).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const stepName = step.stepName || "Step";
    const screenRef = pageKey || step.screenId;
    const lines = [
        "# Web UI + API — TRUE E2E",
        "Feature: Web UI + API Integration",
        "",
        "  @webui-api @smoke",
        `  Scenario: ${esc(stepName)}`,
        ""
    ];
    const uiActions = (step.uiActions || []).filter((a) => a.selected !== false);
    const apis = (step.apis || []).filter((e) => e.selected !== false);
    const hasTimestamps = uiActions.some((a) => a.timestamp) && apis.some((e) => e.timestamp);

    if (!expandedUi || (uiActions.length === 0 && apis.length === 0)) {
        lines.push(`    Given user performs "${esc(stepName)}"`);
        if (apis.length > 0) {
            const methodWithBody = ["POST", "PUT", "PATCH"];
            apis.forEach((e) => {
                const method = (e.method || "GET").toUpperCase();
                const url = (e.url || "").trim() || "http://localhost/";
                const status = e.responseStatus != null ? e.responseStatus : 200;
                const hasBody = methodWithBody.indexOf(method) >= 0 && e.requestBody != null;
                const bodyRows = hasBody ? requestBodyToTableRows(e.requestBody) : [];
                if (bodyRows.length > 0) {
                    lines.push(`    Given User sends ${method} request to "${esc(url)}" with body:`);
                    lines.push("      | path  | value |");
                    bodyRows.forEach((r) => lines.push(`      | ${r.path} | ${r.value} |`));
                } else {
                    lines.push(`    Given User sends ${method} request to "${esc(url)}"`);
                }
                lines.push(`    Then User expects status code ${status}`);
                lines.push("");
            });
        }
        return lines.join("\n").replace(/\n\n\n/g, "\n\n") + "\n";
    }

    if (hasTimestamps) {
        // Merge UI and API by timestamp and emit in sequence order.
        const events = [];
        uiActions.forEach((a) => events.push({ type: "ui", timestamp: a.timestamp || "", payload: a }));
        apis.forEach((e) => events.push({ type: "api", timestamp: e.timestamp || "", payload: e }));
        events.sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp)));

        let firstUiBlock = true;
        for (let i = 0; i < events.length; i++) {
            if (events[i].type === "ui") {
                const uiSegment = [];
                while (i < events.length && events[i].type === "ui") {
                    uiSegment.push(events[i].payload);
                    i++;
                }
                i--;
                if (uiSegment.length > 0) {
                    if (firstUiBlock) {
                        if (step.page) lines.push(`    Given User navigates to "${esc(step.page)}" URL`);
                        if (screenRef) lines.push(`    And User is on "${esc(screenRef)}" screen`);
                        firstUiBlock = false;
                    }
                    // In timestamp mode we must preserve order (grouping can reorder dependent actions).
                    emitUiLinesInOrder(uiSegment, esc).forEach((l) => lines.push("    " + l));
                }
            } else {
                if (firstUiBlock) {
                    if (step.page) lines.push(`    Given User navigates to "${esc(step.page)}" URL`);
                    if (screenRef) lines.push(`    And User is on "${esc(screenRef)}" screen`);
                    firstUiBlock = false;
                }
                const e = events[i].payload;
                const method = (e.method || "GET").toUpperCase();
                const url = (e.url || "").trim() || "http://localhost/";
                const status = e.responseStatus != null ? e.responseStatus : 200;
                const methodWithBody = ["POST", "PUT", "PATCH"];
                const hasBody = methodWithBody.indexOf(method) >= 0 && e.requestBody != null;
                const bodyRows = hasBody ? requestBodyToTableRows(e.requestBody) : [];
                if (bodyRows.length > 0) {
                    lines.push(`    Given User sends ${method} request to "${esc(url)}" with body:`);
                    lines.push("      | path  | value |");
                    bodyRows.forEach((r) => lines.push(`      | ${r.path} | ${r.value} |`));
                } else {
                    lines.push(`    Given User sends ${method} request to "${esc(url)}"`);
                }
                lines.push(`    Then User expects status code ${status}`);
                lines.push("");
            }
        }
    } else {
        // Legacy: no timestamps — emit all UI then all API.
        if (step.page) lines.push(`    Given User navigates to "${esc(step.page)}" URL`);
        if (screenRef) lines.push(`    And User is on "${esc(screenRef)}" screen`);
        emitGroupedUiLines(uiActions, esc).forEach((l) => lines.push("    " + l));
        const methodWithBody = ["POST", "PUT", "PATCH"];
        apis.forEach((e) => {
            const method = (e.method || "GET").toUpperCase();
            const url = (e.url || "").trim() || "http://localhost/";
            const status = e.responseStatus != null ? e.responseStatus : 200;
            const hasBody = methodWithBody.indexOf(method) >= 0 && e.requestBody != null;
            const bodyRows = hasBody ? requestBodyToTableRows(e.requestBody) : [];
            if (bodyRows.length > 0) {
                lines.push(`    Given User sends ${method} request to "${esc(url)}" with body:`);
                lines.push("      | path  | value |");
                bodyRows.forEach((r) => lines.push(`      | ${r.path} | ${r.value} |`));
            } else {
                lines.push(`    Given User sends ${method} request to "${esc(url)}"`);
            }
            lines.push(`    Then User expects status code ${status}`);
            lines.push("");
        });
    }

    if (apis.length === 0 && (!hasTimestamps || lines.filter((l) => l.includes("User sends")).length === 0)) {
        lines.push("    When backend APIs are captured");
        lines.push("    Then validate the following APIs:");
        lines.push("      | Method | URL | Status |");
        lines.push("      | GET | / | 200 |");
    }
    return lines.join("\n").replace(/\n\n\n/g, "\n\n") + "\n";
}

/**
 * Inserts/updates a single entry in e2e/web/locators/pages.json (or webui-api). Does not create a new file;
 * only updates the existing pages.json with key "generated/<screenName>" and value
 * [{ "title": "...", "label": "..." }] so the framework can resolve page metadata.
 * Locator selectors stay in locators/pages/generated/<screenName>.json.
 * @param {string} ROOT_PAGES_JSON - path to e2e/locators/pages.json
 * @param {string} pageKey - e.g. "generated/Screen" (user screen name under generated/)
 * @param {string} title - document.title or screen title
 * @param {string[]} labels - visible text / logical names (first used as label)
 */
function updatePagesJson(ROOT_PAGES_JSON, pageKey, title, labels) {
    let root = {};
    try {
        if (fs.existsSync(ROOT_PAGES_JSON)) root = JSON.parse(fs.readFileSync(ROOT_PAGES_JSON, "utf8"));
    } catch (e) {}
    if (typeof root !== "object" || root === null) root = {};
    const label = (Array.isArray(labels) && labels.length > 0) ? labels[0] : (title || pageKey);
    const entry = [{ title: title || pageKey, label: String(label) }];
    root[pageKey] = entry;
    fs.writeFileSync(ROOT_PAGES_JSON, JSON.stringify(root, null, 2), "utf8");
}

/**
 * Writes Web UI + API generated files into e2e/generated/end-to-end/:
 * - Feature: e2e/generated/end-to-end/features/<stepName>.feature
 * - Locators: e2e/generated/end-to-end/locators/pages/<screenName>.json (selector JSON only)
 * - Page metadata: insert into e2e/generated/end-to-end/locators/pages.json (key "generated/<screenName>", value [{ title, label }])
 * @param {Object} payload - { mode: "webui-api", steps: [{ stepName, screenId, uiActions, apis, title, labels }] }
 * @returns {{ ok: boolean, message: string, paths?: string[] }}
 */
function writeWebuiApiGeneratedFiles(payload) {
    const domain = "end-to-end";
    try {
        ensureLocatorStructure(domain);
        const p = getGeneratedPaths(domain);

        const steps = (payload && payload.steps) || [];
        if (!steps.length) return { ok: false, message: "No steps to generate." };

        const paths = [];
        const pagesUpdated = {};
        const generatedPagesDir = path.join(p.pagesDir, "generated");
        ensureDir(generatedPagesDir);
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepName = step.stepName || step.name || "Step" + (i + 1);
            const safeStepName = safeFileName(stepName);
            const title = step.title || step.screenId || stepName;
            const labels = step.labels || (step.uiActions || []).map((a) => a.logicalName || "").filter(Boolean);
            const pageKey = "generated/" + safeStepName;

            const featureContent = generateWebuiApiFeatureContent(step, true, pageKey);
            const featurePath = path.join(p.featuresDir, safeStepName + ".feature");
            fs.writeFileSync(featurePath, featureContent, "utf8");
            paths.push(featurePath);

            const locatorObj = generateLocatorJson(step.uiActions || []);
            const locatorPath = path.join(generatedPagesDir, safeStepName + ".json");
            let existingLocator = {};
            try {
                if (fs.existsSync(locatorPath)) existingLocator = JSON.parse(fs.readFileSync(locatorPath, "utf8"));
            } catch (e) {}
            const merged = { ...existingLocator, ...locatorObj };
            fs.writeFileSync(locatorPath, JSON.stringify(merged, null, 2), "utf8");
            paths.push(locatorPath);

            if (!pagesUpdated[pageKey]) {
                updatePagesJsonUtil(p.pagesJsonPath, pageKey, title, labels);
                pagesUpdated[pageKey] = true;
            }
        }
        paths.push(p.pagesJsonPath);
        return { ok: true, message: "Web UI + API files generated.", paths };
    } catch (e) {
        return { ok: false, message: (e && e.message) ? String(e.message) : String(e) };
    }
}

/**
 * Writes generated files for recording mode into e2e/generated/<domain>/.
 * Called from cli.js via page.exposeFunction when user clicks Generate Feature File in recording mode.
 * If payload.mode === "webui-api", delegates to writeWebuiApiGeneratedFiles.
 * @param {Object} payload - { screens: Array, folder?: string, domain?: string } or { mode: "webui-api", steps: Array }
 * @returns {{ ok: boolean, message: string, paths?: string[] }}
 */
function writeGeneratedFiles(payload) {
    if (payload && payload.mode === "webui-api") return writeWebuiApiGeneratedFiles(payload);

    const domain = (payload && payload.domain) ? validateDomain(payload.domain) : "web";
    try {
        ensureLocatorStructure(domain);
        const p = getGeneratedPaths(domain);

        const screens = (payload && payload.screens) || [];
        const folder = (payload && payload.folder && String(payload.folder).trim()) || "";
        if (!screens.length) return { ok: false, message: "No screens to generate." };

        const folderDir = folder ? path.join(p.pagesDir, folder) : p.pagesDir;
        const featureDir = folder ? path.join(p.featuresDir, folder) : p.featuresDir;
        ensureDir(folderDir);
        ensureDir(featureDir);

        const paths = [];
        let rootPages = {};
        try {
            if (fs.existsSync(p.pagesJsonPath)) rootPages = JSON.parse(fs.readFileSync(p.pagesJsonPath, "utf8"));
        } catch (e) {}
        if (typeof rootPages !== "object" || rootPages === null) rootPages = {};

        for (const screen of screens) {
            const screenId = screen.screenId || "Screen";
            const safeId = safeFileName(screenId);
            const title = screen.title || screenId;
            const label = screen.label || screenId;
            const pageNameForLocator = folder === "generated" ? "generated/" + safeId : (folder ? "generated/" + folder + "/" + safeId : "generated/" + safeId);

            const screenJson = generateScreenJson(screen);
            const screenPath = path.join(folderDir, safeId + ".json");
            fs.writeFileSync(screenPath, JSON.stringify(screenJson, null, 2), "utf8");
            paths.push(screenPath);

            const featureContent = generateFeatureLines(screen, pageNameForLocator);
            const featurePath = path.join(featureDir, safeId + ".feature");
            fs.writeFileSync(featurePath, featureContent, "utf8");
            paths.push(featurePath);

            rootPages[pageNameForLocator] = [{ title, label }];
        }

        fs.writeFileSync(p.pagesJsonPath, JSON.stringify(rootPages, null, 2), "utf8");
        paths.push(p.pagesJsonPath);

        return { ok: true, message: "Files generated successfully.", paths };
    } catch (e) {
        return { ok: false, message: (e && e.message) ? String(e.message) : String(e) };
    }
}

function parseDomainFromArgv() {
    const argv = process.argv.slice(2);
    for (const arg of argv) {
        if (arg.startsWith("--domain=")) {
            return arg.slice("--domain=".length).trim();
        }
    }
    return "web";
}

function main() {
    let domain = "web";
    try {
        domain = validateDomain(parseDomainFromArgv());
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }

    ensureLocatorStructure(domain);
    const p = getGeneratedPaths(domain);

    const argv = process.argv.slice(2).filter((a) => !a.startsWith("--domain="));
    const inputPath = argv[0];

    let raw;
    if (inputPath) {
        const abs = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
        if (!fs.existsSync(abs)) {
            console.error("File not found:", abs);
            process.exit(1);
        }
        raw = fs.readFileSync(abs, "utf8");
    } else {
        raw = fs.readFileSync(0, "utf8");
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error("Invalid JSON:", e.message);
        process.exit(1);
    }

    const screens = (data && data.screens) || (Array.isArray(data) ? data : [data]);
    if (!screens.length) {
        console.error("No screens in JSON");
        process.exit(1);
    }

    let rootPages = {};
    try {
        if (fs.existsSync(p.pagesJsonPath)) {
            rootPages = JSON.parse(fs.readFileSync(p.pagesJsonPath, "utf8"));
        }
    } catch (e) {}
    if (typeof rootPages !== "object" || rootPages === null) rootPages = {};

    for (const screen of screens) {
        const screenId = screen.screenId || "Screen";
        const safeId = safeFileName(screenId);
        const title = screen.title || screenId;
        const label = screen.label || screenId;
        const pageKey = "generated/" + safeId;

        const screenJson = generateScreenJson(screen);
        const pagesPagePath = path.join(p.pagesDir, safeId + ".json");
        fs.writeFileSync(pagesPagePath, JSON.stringify(screenJson, null, 2), "utf8");
        console.log("Wrote:", pagesPagePath);

        rootPages[pageKey] = [{ title, label }];

        const featureContent = generateFeatureLines(screen, pageKey);
        const featurePath = path.join(p.featuresDir, safeId + ".feature");
        fs.writeFileSync(featurePath, featureContent, "utf8");
        console.log("Wrote:", featurePath);
    }

    fs.writeFileSync(p.pagesJsonPath, JSON.stringify(rootPages, null, 2), "utf8");
    console.log("Updated:", p.pagesJsonPath);
    console.log("\nSummary:");
    console.log(`- Processed ${screens.length} screen(s) into e2e/generated/${domain}/`);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        writeGeneratedFiles,
        writeWebuiApiGeneratedFiles,
        generateScreenJson,
        generateFeatureLines,
        generateLocatorJson,
        generateWebuiApiFeatureContent,
        safeFileName,
    };
}
if (require.main === module) main();