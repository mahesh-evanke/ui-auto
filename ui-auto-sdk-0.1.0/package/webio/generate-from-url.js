#!/usr/bin/env node
/**
 * Generates web feature files and locator JSON from a URL + user context.
 *
 * Flow:
 * 1. User provides URL + context (e.g. "there is email and password")
 * 2. WebdriverIO launches browser, navigates to URL
 * 3. Extracts interactable elements (xpath, id, data-testid, etc.) via browser.execute()
 * 4. LLM uses context + elements to produce logical names and structure
 * 5. Writes feature + locator JSON to e2e/generated/web/
 *
 * Usage:
 *   node webio/generate-from-url.js --url=<URL> [--context="..."] [--domain=web] [--llm=ollama|openai|none]
 *
 * Example:
 *   node webio/generate-from-url.js --url=https://example.com/login --context="email and password"
 *   node webio/generate-from-url.js --url=https://example.com/login --llm=ollama
 *
 * LLM options (default: OLLama):
 *   - OLLama: --llm=ollama, OLLAMA_BASE_URL (default http://localhost:11434/v1), OLLAMA_MODEL (default gpt-oss:20b-cloud)
 *   - OpenAI: --llm=openai, OPENAI_API_KEY
 *   - None: --llm=none (raw extraction, no LLM)
 */

const path = require("path");
const fs = require("fs");
const { remote } = require("webdriverio");
const { writeGeneratedFiles } = require("./generate-locators-and-features.js");
const { ensureLocatorStructure, getGeneratedPaths, validateDomain } = require("./generation-utils.js");
const extractFn = require("./extract-elements-browser.js");

const PROJECT_ROOT = path.resolve(process.env.UI_AUTO_PROJECT_ROOT || process.cwd());

function parseArgs() {
    const args = process.argv.slice(2);
    let url = "";
    let context = "";
    let domain = "web";
    let llm = "";
    for (const arg of args) {
        if (arg.startsWith("--url=")) url = arg.slice(6).trim();
        else if (arg.startsWith("--context=")) context = arg.slice(10).trim();
        else if (arg.startsWith("--domain=")) domain = arg.slice(9).trim();
        else if (arg.startsWith("--llm=")) llm = arg.slice(6).trim().toLowerCase();
    }
    return { url, context, domain, llm };
}

async function startChromeDriver() {
    try {
        const chromedriver = require("chromedriver");
        await chromedriver.start(["--port=9515"], true);
        return () => chromedriver.stop();
    } catch {
        return null;
    }
}

async function extractWithWebdriverIO(url) {
    const stopChromeDriver = await startChromeDriver();

    const browser = await remote({
        capabilities: { browserName: "chrome" },
        hostname: "localhost",
        port: 9515,
        path: "/",
        logLevel: "silent",
    });

    try {
        await browser.url(url);
        await new Promise((r) => setTimeout(r, 1500));
        const result = await browser.execute(extractFn);
        return result;
    } finally {
        await browser.deleteSession();
        if (stopChromeDriver) {
            try {
                stopChromeDriver();
            } catch {}
        }
    }
}

function getLLMConfig(llmArg) {
    const ollamaBase = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const ollamaModel = process.env.OLLAMA_MODEL || "gpt-oss:20b-cloud";

    if (llmArg === "none") return null;
    if (llmArg === "openai" && process.env.OPENAI_API_KEY) {
        return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" };
    }
    if (llmArg === "ollama" || llmArg === "" || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
        return { provider: "ollama", baseURL: ollamaBase, model: ollamaModel };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" };
    }
    return null;
}

async function callLLM(rawData, context, llmConfig) {
    if (!llmConfig) return null;

    let client;
    try {
        client = require("openai");
    } catch {
        return null;
    }

    const opts = llmConfig.provider === "ollama"
        ? { baseURL: llmConfig.baseURL, apiKey: "ollama" }
        : { apiKey: llmConfig.apiKey };
    const openai = new client.OpenAI(opts);

    const systemPrompt = `You are an assistant that generates test automation artifacts.
Given extracted DOM elements from a web page and optional user context, output a JSON object.

Output structure:
{
  "screenId": "Page name (e.g. Login Page)",
  "page": "<URL>",
  "title": "<document title>",
  "label": "<page label>",
  "elements": [
    {
      "logicalName": "Human-friendly name matching user context",
      "selectorType": "xpath" | "css",
      "selectorValue": "<selector string>",
      "objectType": "textbox" | "button" | "link" | "checkbox" | "radio" | "dropdown" | "other"
    }
  ],
  "scenarioSteps": [OPTIONAL - use when user context describes specific Gherkin steps to generate]
}

SCENARIO STEPS: When the user's prompt clearly describes a Gherkin scenario, emit "scenarioSteps" with the exact steps.
Each entry: { "keyword": "Given"|"When"|"Then"|"And", "step": "<step text with params>", "dataTable": [[...rows]] (optional) }

Supported Gherkin steps (use these EXACT formats):
- Given User is on "{screenName}" screen
- Given enters "{txtInput}" text in "{elementName}" textbox
- When User clicks on "{btnName}" button
- When clicks on "{objName}" button
- When clicks on "{objName}" link
- When clicks on "{objName}" Radio button
- Given select "{objName}" Checkbox
- When selects "{optionVal}" text from "{objName}" Drop-down list
- When Verify field "{fieldName}" text is "{expectedText}"
- When verify "{txtName}" text is present on the screen
- When verify data from "{objName}" web table  [REQUIRES dataTable with columns like S.No, Name, DOB and expected row(s)]

For web table verification: if user says "verify Name and DOB for S.No 1 in the web table", use:
  { "keyword": "When", "step": "verify data from \\"<table logical name>\\" web table", "dataTable": [["S.No","Name","DOB"],["1","<expected_name>","<expected_dob>"]] }

Rules:
- logicalName must match user context when provided.
- Keep selectorType and selectorValue from raw extraction; do not invent selectors.
- objectType: input/textarea -> textbox, button/submit -> button, a with href -> link, select -> dropdown, input[type=checkbox] -> checkbox, input[type=radio] -> radio.
- If user context describes a specific verification (e.g. web table, field text), include scenarioSteps with the correct Gherkin.
- Output ONLY valid JSON, no markdown or extra text.`;

    const userPrompt = `User context/prompt: ${context || "No specific context given."}

Raw extracted elements:
${JSON.stringify(rawData, null, 2)}

Return the JSON object. If the user's prompt describes specific Gherkin steps (e.g. "verify Name and DOB in web table"), include scenarioSteps with the exact step format. Otherwise improve logical names for elements.`;

    try {
        const resp = await openai.chat.completions.create({
            model: llmConfig.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.2,
        });
        const content = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
        if (!content) return null;
        const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
        return JSON.parse(cleaned);
    } catch (err) {
        console.warn("LLM call failed:", err.message || String(err));
        return null;
    }
}

function rawToScreen(raw) {
    if (!raw || !raw.elements) return null;
    return {
        screenId: raw.title || raw.label || "Screen",
        page: raw.page || "",
        title: raw.title || "Screen",
        label: raw.label || raw.title || "Screen",
        elements: raw.elements.map((e) => ({
            logicalName: (e.logicalName || "Element").trim(),
            selectorType: (e.selectorType || "css").toLowerCase(),
            selectorValue: (e.selectorValue || "").trim(),
            objectType: (e.objectType || "button").toLowerCase(),
        })),
    };
}

/**
 * Generate from already-extracted DOM (e.g. from current page in webio recorder).
 * No WebdriverIO or second browser — uses rawData from the current page.
 * @param {Object} opts - { rawData, context?, domain?, llm? }
 * @returns {Promise<{ok: boolean, message: string, paths?: string[]}>}
 */
async function runGenerateFromCurrentPage(opts) {
    const rawData = opts && opts.rawData;
    const context = (opts && opts.context) ? String(opts.context).trim() : "";
    const domain = (opts && opts.domain) ? String(opts.domain).trim() : "web";
    const llm = (opts && opts.llm) ? String(opts.llm).trim().toLowerCase() : "";

    if (!rawData || !rawData.elements || !Array.isArray(rawData.elements)) {
        return { ok: false, message: "No elements extracted. Ensure the page has interactable elements." };
    }

    try {
        validateDomain(domain);
    } catch (e) {
        return { ok: false, message: e.message || "Invalid domain." };
    }

    const llmConfig = getLLMConfig(llm);

    let screen = null;
    if (llmConfig) {
        screen = await callLLM(rawData, context, llmConfig);
    }
    if (!screen) {
        screen = rawToScreen(rawData);
    }

    if (!screen || !screen.elements || screen.elements.length === 0) {
        return { ok: false, message: "No elements to generate." };
    }

    ensureLocatorStructure(domain);
    const payload = {
        screens: [screen],
        domain,
        folder: "generated",
    };

    const result = writeGeneratedFiles(payload);
    if (!result.ok) {
        return { ok: false, message: result.message };
    }

    const relPaths = result.paths && result.paths.length
        ? result.paths.map((p) => path.relative(PROJECT_ROOT, p))
        : [];
    return { ok: true, message: result.message, paths: relPaths };
}

/**
 * Programmatic entry point for GUI or CLI. Opens WebdriverIO, navigates to URL, extracts, generates.
 * @param {Object} opts - { url, context?, domain?, llm? }
 * @returns {Promise<{ok: boolean, message: string, paths?: string[]}>}
 */
async function runGenerateFromUrl(opts) {
    const url = (opts && opts.url) ? String(opts.url).trim() : "";
    const context = (opts && opts.context) ? String(opts.context).trim() : "";
    const domain = (opts && opts.domain) ? String(opts.domain).trim() : "web";
    const llm = (opts && opts.llm) ? String(opts.llm).trim().toLowerCase() : "";

    if (!url) {
        return { ok: false, message: "URL is required." };
    }

    try {
        validateDomain(domain);
    } catch (e) {
        return { ok: false, message: e.message || "Invalid domain." };
    }

    const llmConfig = getLLMConfig(llm);

    let rawData;
    try {
        rawData = await extractWithWebdriverIO(url);
    } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes("Chrome version") || msg.includes("ChromeDriver")) {
            return { ok: false, message: "Chrome/ChromeDriver version mismatch. Update Chrome or run: npm install chromedriver@<version>" };
        }
        return { ok: false, message: "Failed to extract elements: " + msg };
    }

    if (!rawData || !rawData.elements || rawData.elements.length === 0) {
        return { ok: false, message: "No interactable elements found on the page." };
    }

    let screen = null;
    if (llmConfig) {
        screen = await callLLM(rawData, context, llmConfig);
    }
    if (!screen) {
        screen = rawToScreen(rawData);
    }

    if (!screen || !screen.elements || screen.elements.length === 0) {
        return { ok: false, message: "No elements to generate." };
    }

    ensureLocatorStructure(domain);
    const payload = {
        screens: [screen],
        domain,
        folder: "generated",
    };

    const result = writeGeneratedFiles(payload);
    if (!result.ok) {
        return { ok: false, message: result.message };
    }

    const relPaths = result.paths && result.paths.length
        ? result.paths.map((p) => path.relative(PROJECT_ROOT, p))
        : [];
    return { ok: true, message: result.message, paths: relPaths };
}

async function main() {
    const { url, context, domain, llm } = parseArgs();

    if (!url) {
        console.error("Usage: node webio/generate-from-url.js --url=<URL> [--context=\"...\"] [--domain=web]");
        console.error("Example: node webio/generate-from-url.js --url=https://example.com/login --context=\"email and password\"");
        process.exit(1);
    }

    const llmConfig = getLLMConfig(llm);
    console.log("Navigating to:", url);
    if (context) console.log("Context:", context);
    if (llmConfig) console.log("LLM:", llmConfig.provider, llmConfig.model);

    const result = await runGenerateFromUrl({ url, context, domain, llm });

    if (!result.ok) {
        console.error(result.message);
        process.exit(1);
    }

    console.log(result.message);
    if (result.paths && result.paths.length) {
        console.log("Created:");
        result.paths.forEach((p) => console.log("  -", p));
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { runGenerateFromUrl, runGenerateFromCurrentPage };
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
