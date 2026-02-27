(() => {
  if (!window.__WEBIO__) {
    window.__WEBIO__ = {};
  }

  const STORAGE_KEY = "__WEBIO_COLLECTED_SCREENS__";
  const ns = window.__WEBIO__;

  if (!ns.screens) {
    ns.screens = [];
  }

  function loadStoredScreens() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredScreens(screens) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(screens));
    } catch (e) {
    }
  }

  function getPageTitle() {
    try {
      return (document && document.title && document.title.trim && document.title.trim()) || "";
    } catch (e) {
      return "";
    }
  }

  function getPageLabel() {
    try {
      const h = document.querySelector("main h1, main h2, h1, h2");
      if (h && h.textContent) return h.textContent.trim();
    } catch (e) {
      return "";
    }
    return "";
  }

  function xpathLiteral(str) {
    const s = String(str == null ? "" : str);
    if (s.indexOf('"') === -1) return '"' + s + '"';
    if (s.indexOf("'") === -1) return "'" + s + "'";
    const parts = s.split('"');
    return "concat(" + parts.map((p) => '"' + p + '"').join(', \'"\', ') + ")";
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const attr = (n) => {
      try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
    };

    // Prefer stable attribute-based XPaths over absolute DOM paths.
    const id = el.id ? String(el.id).trim() : "";
    if (id) return "//*[@id=" + xpathLiteral(id) + "]";

    const dataTestId = attr("data-testid");
    if (dataTestId && String(dataTestId).trim()) return "//*[@data-testid=" + xpathLiteral(String(dataTestId).trim()) + "]";

    const name = attr("name");
    if (name && String(name).trim()) return "//*[@name=" + xpathLiteral(String(name).trim()) + "]";

    const aria = attr("aria-label");
    if (aria && String(aria).trim()) return "//*[@aria-label=" + xpathLiteral(String(aria).trim()) + "]";

    const placeholder = attr("placeholder");
    const tag = (el.tagName || "").toLowerCase();
    if ((tag === "input" || tag === "textarea") && placeholder && String(placeholder).trim()) {
      return "//" + tag + "[@placeholder=" + xpathLiteral(String(placeholder).trim()) + "]";
    }

    const text = String((el.innerText || el.textContent || "")).trim().replace(/\s+/g, " ");
    if ((tag === "button" || tag === "a") && text && text.length <= 80) {
      return "//" + tag + "[normalize-space(.)=" + xpathLiteral(text) + "]";
    }

    // Fallback: absolute (brittle) XPath.
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + "[" + index + "]");
      node = node.parentNode;
    }
    return "/html/" + parts.join("/");
  }

  function getCssSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    const attr = (n) => {
      try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
    };

    const id = el.id ? String(el.id).trim() : "";
    if (id) return "#" + id.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");

    const dataTestId = attr("data-testid");
    if (dataTestId && String(dataTestId).trim()) return '[data-testid="' + String(dataTestId).trim().replace(/"/g, '\\"') + '"]';

    const name = attr("name");
    if (name && String(name).trim()) return '[name="' + String(name).trim().replace(/"/g, '\\"') + '"]';

    const aria = attr("aria-label");
    if (aria && String(aria).trim()) return '[aria-label="' + String(aria).trim().replace(/"/g, '\\"') + '"]';

    // Fallback: tag + classes chain (can still be brittle).
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let selector = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) selector += "." + Array.from(node.classList).join(".");
      path.unshift(selector);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function getLogicalName(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.getAttribute && el.getAttribute("aria-label")) {
      return el.getAttribute("aria-label").trim();
    }
    if (el.getAttribute && el.getAttribute("placeholder")) {
      return el.getAttribute("placeholder").trim();
    }
    if (el.innerText && el.innerText.trim()) {
      return el.innerText.trim();
    }
    return el.tagName ? el.tagName.toLowerCase() : "";
  }

  function getObjectType(el) {
    if (!el || el.nodeType !== 1) return "Button";
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const typeAttr = (el.getAttribute && el.getAttribute("type")) ? String(el.getAttribute("type")).toLowerCase() : "";
    if (tag === "input") {
      if (typeAttr === "button" || typeAttr === "submit") return "Button";
      return "Textbox";
    }
    if (tag === "textarea") return "Textbox";
    if (tag === "a") return "Link";
    if (tag === "button") return "Button";
    return "Button";
  }

  function captureElement(target) {
    if (!target) return;
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (!el || !document.documentElement.contains(el)) return;

    const page = window.location.href || "";
    const title = getPageTitle();
    const label = getPageLabel();
    const screenId = title || page;

    const logicalName = getLogicalName(el);
    const objectType = getObjectType(el);
    const xpath = getXPath(el);
    const css = getCssSelector(el);

    const record = {
      screenId,
      page,
      title,
      label,
      capturedAt: new Date().toISOString(),
      logicalName,
      objectType,
      selectorType: "xpath",
      selectorValue: xpath,
      css,
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      name: (el.getAttribute && el.getAttribute("name")) || ""
    };

    ns.screens.push(record);

    const stored = loadStoredScreens();
    stored.push(record);
    saveStoredScreens(stored);
  }

  if (!ns.__initializedContextMenuCapture) {
    ns.__initializedContextMenuCapture = true;
    document.addEventListener(
      "contextmenu",
      function (e) {
        try {
          captureElement(e.target);
        } catch (err) {
        }
      },
      true
    );
  }
})();

/**
 * Network capture: intercept XHR and Fetch, store API requests in __WEBIO__.networkLog.
 * Log format: { id, url, method, headers, requestBody, responseStatus, responseBody, timestamp }.
 * Raw logs are never exposed in UI; only safe summaries (method, URL, status) are shown.
 */
(function () {
  if (!window.__WEBIO__) window.__WEBIO__ = {};
  var ns = window.__WEBIO__;
  if (!ns.networkLog) ns.networkLog = [];
  var idCounter = 1;

  function safeParseJson(str) {
    if (str == null || str === "") return null;
    try {
      if (typeof str === "string") return JSON.parse(str);
      return str;
    } catch (e) {
      return str;
    }
  }

  function captureRequest(url, method, headers, requestBody, responseStatus, responseBody, timestamp) {
    var entry = {
      id: "nw_" + idCounter++,
      url: url || "",
      method: (method || "GET").toUpperCase(),
      headers: headers || {},
      requestBody: requestBody,
      responseStatus: responseStatus,
      responseBody: responseBody,
      timestamp: timestamp || new Date().toISOString()
    };
    ns.networkLog.push(entry);
  }

  function headersToObject(headerList) {
    if (!headerList) return {};
    var o = {};
    if (headerList.forEach) {
      headerList.forEach(function (v, k) { o[k] = v; });
    } else if (typeof headerList.entries === "function") {
      var it = headerList.entries();
      var next;
      while ((next = it.next()) && !next.done) {
        o[next.value[0]] = next.value[1];
      }
    }
    return o;
  }

  if (!window.__WEBIO_NETWORK_CAPTURE_INIT__) {
    window.__WEBIO_NETWORK_CAPTURE_INIT__ = true;

    var XHR = window.XMLHttpRequest;
    if (XHR) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;
      var origSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function (method, url) {
        this._webio_method = method;
        this._webio_url = url;
        this._webio_headers = {};
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (name, value) {
        if (!this._webio_headers) this._webio_headers = {};
        this._webio_headers[name] = value;
        return origSetRequestHeader ? origSetRequestHeader.apply(this, arguments) : undefined;
      };
      XHR.prototype.send = function (body) {
        var self = this;
        var url = self._webio_url || "";
        var method = (self._webio_method || "GET").toUpperCase();
        var reqHeaders = self._webio_headers || {};
        var startTs = new Date().toISOString();
        var reqBody = null;
        if (body != null && body !== "") {
          reqBody = typeof body === "string" ? safeParseJson(body) : body;
          if (reqBody === body && typeof body === "string") reqBody = body;
        }
        self.addEventListener("load", function () {
          var status = self.status;
          var respBody = null;
          try {
            var text = self.responseText;
            if (text) respBody = safeParseJson(text);
            if (respBody === null && text) respBody = text;
          } catch (e) {}
          captureRequest(url, method, reqHeaders, reqBody, status, respBody, startTs);
        });
        self.addEventListener("error", function () {
          captureRequest(url, method, reqHeaders, reqBody, 0, null, startTs);
        });
        return origSend.apply(this, arguments);
      };
    }

    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        init = init || {};
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var method = (init.method || "GET").toUpperCase();
        var reqHeaders = headersToObject(init.headers);
        var reqBody = null;
        if (init.body != null) {
          if (typeof init.body === "string") reqBody = safeParseJson(init.body);
          else reqBody = init.body;
          if (reqBody === init.body && typeof init.body === "string") reqBody = init.body;
        }
        var startTs = new Date().toISOString();
        return origFetch.apply(this, arguments).then(function (res) {
          var status = res.status;
          res.clone().text().then(function (text) {
            var respBody = null;
            if (text) respBody = safeParseJson(text);
            if (respBody === null && text) respBody = text;
            captureRequest(url, method, reqHeaders, reqBody, status, respBody, startTs);
          }).catch(function () {
            captureRequest(url, method, reqHeaders, reqBody, status, null, startTs);
          });
          return res;
        }).catch(function (err) {
          captureRequest(url, method, reqHeaders, reqBody, 0, null, startTs);
          throw err;
        });
      };
    }
  }
})();

(() => {
  if (!window.__WEBIO__) {
    window.__WEBIO__ = {};
  }

  const STORAGE_KEY = "__WEBIO_COLLECTED_SCREENS__";
  const ns = window.__WEBIO__;

  if (!ns.screens) {
    ns.screens = [];
  }

  function loadStoredScreens() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredScreens(screens) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(screens));
    } catch (e) {
      // ignore storage failures; capture must not break the page
    }
  }

  function getPageTitle() {
    try {
      return (document && document.title && document.title.trim && document.title.trim()) || "";
    } catch (e) {
      return "";
    }
  }

  function getPageLabel() {
    try {
      const h = document.querySelector("main h1, main h2, h1, h2");
      if (h && h.textContent) return h.textContent.trim();
    } catch (e) {
      return "";
    }
    return "";
  }

  // Reuse same stable selector strategy in the panel script (duplicate definitions kept in-file by design).
  function xpathLiteral(str) {
    const s = String(str == null ? "" : str);
    if (s.indexOf('"') === -1) return '"' + s + '"';
    if (s.indexOf("'") === -1) return "'" + s + "'";
    const parts = s.split('"');
    return "concat(" + parts.map((p) => '"' + p + '"').join(', \'"\', ') + ")";
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const attr = (n) => {
      try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
    };

    const id = el.id ? String(el.id).trim() : "";
    if (id) return "//*[@id=" + xpathLiteral(id) + "]";
    const dataTestId = attr("data-testid");
    if (dataTestId && String(dataTestId).trim()) return "//*[@data-testid=" + xpathLiteral(String(dataTestId).trim()) + "]";
    const name = attr("name");
    if (name && String(name).trim()) return "//*[@name=" + xpathLiteral(String(name).trim()) + "]";
    const aria = attr("aria-label");
    if (aria && String(aria).trim()) return "//*[@aria-label=" + xpathLiteral(String(aria).trim()) + "]";

    const placeholder = attr("placeholder");
    const tag = (el.tagName || "").toLowerCase();
    if ((tag === "input" || tag === "textarea") && placeholder && String(placeholder).trim()) {
      return "//" + tag + "[@placeholder=" + xpathLiteral(String(placeholder).trim()) + "]";
    }
    const text = String((el.innerText || el.textContent || "")).trim().replace(/\s+/g, " ");
    if ((tag === "button" || tag === "a") && text && text.length <= 80) {
      return "//" + tag + "[normalize-space(.)=" + xpathLiteral(text) + "]";
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + "[" + index + "]");
      node = node.parentNode;
    }
    return "/html/" + parts.join("/");
  }

  function getCssSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    const attr = (n) => {
      try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
    };

    const id = el.id ? String(el.id).trim() : "";
    if (id) return "#" + id.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
    const dataTestId = attr("data-testid");
    if (dataTestId && String(dataTestId).trim()) return '[data-testid="' + String(dataTestId).trim().replace(/"/g, '\\"') + '"]';
    const name = attr("name");
    if (name && String(name).trim()) return '[name="' + String(name).trim().replace(/"/g, '\\"') + '"]';
    const aria = attr("aria-label");
    if (aria && String(aria).trim()) return '[aria-label="' + String(aria).trim().replace(/"/g, '\\"') + '"]';

    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let selector = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) selector += "." + Array.from(node.classList).join(".");
      path.unshift(selector);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function getLogicalName(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.getAttribute && el.getAttribute("aria-label")) {
      return el.getAttribute("aria-label").trim();
    }
    if (el.getAttribute && el.getAttribute("placeholder")) {
      return el.getAttribute("placeholder").trim();
    }
    if (el.innerText && el.innerText.trim()) {
      return el.innerText.trim();
    }
    return el.tagName ? el.tagName.toLowerCase() : "";
  }

  function getObjectType(el) {
    if (!el || el.nodeType !== 1) return "Button";
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const typeAttr = (el.getAttribute && el.getAttribute("type")) ? String(el.getAttribute("type")).toLowerCase() : "";
    if (tag === "input") {
      if (typeAttr === "button" || typeAttr === "submit") return "Button";
      return "Textbox";
    }
    if (tag === "textarea") return "Textbox";
    if (tag === "a") return "Link";
    if (tag === "button") return "Button";
    return "Button";
  }

  function captureElement(target) {
    if (!target) return;
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (!el || !document.documentElement.contains(el)) return;

    const page = window.location.href || "";
    const title = getPageTitle();
    const label = getPageLabel();
    const screenId = title || page;

    const logicalName = getLogicalName(el);
    const objectType = getObjectType(el);
    const xpath = getXPath(el);
    const css = getCssSelector(el);

    const record = {
      screenId,
      page,
      title,
      label,
      capturedAt: new Date().toISOString(),
      logicalName,
      objectType,
      selectorType: "xpath",
      selectorValue: xpath,
      css,
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      name: (el.getAttribute && el.getAttribute("name")) || ""
    };

    ns.screens.push(record);

    const stored = loadStoredScreens();
    stored.push(record);
    saveStoredScreens(stored);
  }

  if (!ns.__initializedContextMenuCapture) {
    ns.__initializedContextMenuCapture = true;
    document.addEventListener(
      "contextmenu",
      function (e) {
        try {
          captureElement(e.target);
        } catch (err) {
          // ignore capture errors
        }
      },
      true
    );
  }
})();

/**
 * Injected locator-collector script: right-click any element to capture
 * selector details; store per screen ID; persist across page navigations;
 * export current screen or all screens as JSON for Gherkin feature generation.
 */
(() => {
    const STORAGE_KEY = "webio_collected_screens";
    const PANEL_SETTINGS_KEY = "webio_panel_settings";
    const pageUrl = window.location.href;
    const defaultScreenIdForPage = (function () {
        if (typeof window.__WEBIO_SCREEN_ID__ !== "undefined" && window.__WEBIO_SCREEN_ID__) return window.__WEBIO_SCREEN_ID__;
        var t = document.title && document.title.trim();
        if (t) return t;
        try {
            var p = new URL(pageUrl).pathname.replace(/\//g, "_").slice(1);
            if (p) return p;
        } catch (e) {}
        return "Screen";
    })();

    function getPageTitle() {
        return (document && document.title && document.title.trim && document.title.trim()) || "";
    }
    function getPageLabelFallback() {
        try {
            var heading = document.querySelector("main h1, main h2, h1, h2");
            if (heading && heading.textContent) return heading.textContent.trim();
        } catch (e) {}
        return getPageTitle() || defaultScreenIdForPage;
    }
    
    function loadScreens() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }
    function loadPanelSettings() {
        try {
            var raw = localStorage.getItem(PANEL_SETTINGS_KEY);
            if (!raw) return { lastScreenId: null, parentPath: "generated" };
            var o = JSON.parse(raw);
            return {
                lastScreenId: (o && typeof o.lastScreenId === "string" && o.lastScreenId.trim()) ? o.lastScreenId.trim() : null,
                parentPath: (o && typeof o.parentPath === "string" && o.parentPath.trim()) ? o.parentPath.trim() : "generated"
            };
        } catch (e) {
            return { lastScreenId: null, parentPath: "generated" };
        }
    }
    function savePanelSettings(settings) {
        try {
            localStorage.setItem(PANEL_SETTINGS_KEY, JSON.stringify({
                lastScreenId: settings.lastScreenId != null ? String(settings.lastScreenId).trim() : null,
                parentPath: (settings.parentPath != null && String(settings.parentPath).trim()) ? String(settings.parentPath).trim() : "generated"
            }));
            return true;
        } catch (e) {
            return false;
        }
    }
    /**
     * Persist collected screens to localStorage.
     * Returns true on success; false on failure (quota, blocked storage, serialization error, etc.).
     * We intentionally do not throw because this runs inside the page and should not break UX.
     */
    function saveScreens(screens) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(screens));
            return true;
        } catch (e) {
            try {
                window.__WEBIO_LAST_SAVE_ERROR__ = (e && e.message) ? String(e.message) : String(e);
                // Avoid noisy logs; one warning helps debugging when saves "randomly" fail.
                console.warn("[webio] Failed to save locators to localStorage:", e);
            } catch (_) {}
            return false;
        }
    }

    var collectedScreens = loadScreens();
    var panelSettings = loadPanelSettings();
    var currentScreenId = (panelSettings.lastScreenId && panelSettings.lastScreenId.length) ? panelSettings.lastScreenId : defaultScreenIdForPage;
    var persistedParentPath = panelSettings.parentPath || "generated";
    if (!collectedScreens[currentScreenId]) {
        collectedScreens[currentScreenId] = {
            screenId: currentScreenId,
            page: pageUrl,
            title: getPageTitle(),
            label: getPageLabelFallback(),
            elements: []
        };
        saveScreens(collectedScreens);
    } else {
        collectedScreens[currentScreenId].page = pageUrl;
        collectedScreens[currentScreenId].title = getPageTitle();
        collectedScreens[currentScreenId].label = getPageLabelFallback();
        saveScreens(collectedScreens);
    }

    function getCurrentScreen() {
        if (!collectedScreens[currentScreenId]) {
            collectedScreens[currentScreenId] = {
                screenId: currentScreenId,
                page: pageUrl,
                title: getPageTitle(),
                label: getPageLabelFallback(),
                elements: []
            };
        }
        return collectedScreens[currentScreenId];
    }
    function persistScreens() {
        return saveScreens(collectedScreens);
    }
    function persistScreensOrAlert(contextLabel) {
        var ok = persistScreens();
        if (!ok) {
            var msg = "Save failed (storage blocked or full). Try clearing site storage or reducing saved elements.";
            try {
                if (window.__WEBIO_LAST_SAVE_ERROR__) msg += "\n\nDetails: " + window.__WEBIO_LAST_SAVE_ERROR__;
            } catch (e) {}
            // Using alert because this is a tool panel; failure must be obvious.
            alert("[webio] " + (contextLabel ? contextLabel + ": " : "") + msg);
        }
        return ok;
    }

    window.collectedScreens = collectedScreens;
    window.webioCurrentScreenId = function () { return currentScreenId; };

    var isRecording = false;
    window.webioIsRecording = function () { return isRecording; };

    var recordedScreens = {};
    window.webioRecordedScreens = function () { return recordedScreens; };

    // Flat action log for recording mode (used by Web UI + API step grouping).
    // Each entry includes selector + action so we can generate UI steps automatically.
    var recordedActionsLog = [];
    window.webioRecordedActionsLog = function () { return recordedActionsLog; };

    var apiMethodFilter = "";
    var apiUrlKeyword = "";
    var apiStatusFilter = "";
    var selectedApiIds = {};
    var webioActiveTab = "webui";

    // Web UI + API tab: steps with captured APIs per step
    var webuiApiSteps = [];
    var webuiApiStepCaptureStartIndex = null;
    var webuiApiStepActionsStartIndex = null;
    var webuiApiStepCaptureName = "";
    var webuiApiUseTableFormat = true;

    function getLogicalName(el) {
        var label = getControlLabel(el);
        if (label) return label.trim();
        if (el.getAttribute && el.getAttribute("aria-label")) return (el.getAttribute("aria-label") || "").trim();
        if (el.getAttribute && el.getAttribute("placeholder")) return (el.getAttribute("placeholder") || "").trim();
        if (el.innerText && el.innerText.trim()) return el.innerText.trim().slice(0, 100);
        if (el.value != null && typeof el.value === "string") return el.value.trim().slice(0, 100);
        return (el.tagName || "").toLowerCase() || "Element";
    }

    function isRecordableElement(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = (el.tagName || "").toLowerCase();
        var root = getControlRoot(el);
        var checkEl = root || el;
        var typeAttr = (checkEl.getAttribute && checkEl.getAttribute("type")) ? String(checkEl.getAttribute("type")).toLowerCase() : "";
        if (tag === "button" || tag === "a") return true;
        if (tag === "input") {
            if (typeAttr === "hidden") return false;
            return ["text", "password", "search", "email", "checkbox", "radio", "submit", "button", ""].indexOf(typeAttr) >= 0;
        }
        if (tag === "textarea" || tag === "select") return true;
        if (tag === "label" && checkEl.querySelector && checkEl.querySelector("input[type=radio], input[type=checkbox]")) return true;
        if (root && (isMuiControlClass(checkEl, "MuiRadio-root") || isMuiControlClass(checkEl, "MuiCheckbox-root") || isMuiControlClass(checkEl, "MuiSwitch-root"))) return true;
        var role = (checkEl.getAttribute && checkEl.getAttribute("role")) ? String(checkEl.getAttribute("role")).toLowerCase() : "";
        if (["button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "combobox", "listbox"].indexOf(role) >= 0) return true;
        return false;
    }

    function getRecordableElementFromTarget(clickTarget) {
        if (!clickTarget || clickTarget.nodeType !== 1) return null;
        var el = clickTarget;
        while (el && el !== document.body) {
            if (isRecordableElement(el)) return el;
            var root = getControlRoot(el);
            if (root && isRecordableElement(root)) return root;
            el = el.parentElement;
        }
        return null;
    }

    function captureRecordedElement(el, actionType, inputValue) {
        if (!isRecording) return;
        var target = el;
        var root = getControlRoot(el);
        if (root) target = root;
        if (!isRecordableElement(target)) return;
        if (target.closest && target.closest("[data-webio-panel], [data-locator-popup], [data-export-popup], [data-webio-contextmenu]")) return;

        var logicalName = getLogicalName(target);
        var objectType = determineObjectType(target);
        var xpath = "";
        var css = "";
        try { xpath = getXPath(target) || ""; } catch (x) {}
        try { css = getCssSelector(target) || ""; } catch (x) {}
        var selectorValue = xpath || css;
        if (!selectorValue) return;

        var record = {
            logicalName: logicalName,
            objectType: objectType,
            selectorType: xpath ? "xpath" : "css",
            selectorValue: selectorValue,
            actionType: actionType || "click",
            inputValue: inputValue != null ? String(inputValue) : ""
        };

        function pushRecordedAction(r) {
            try {
                recordedActionsLog.push({
                    screenId: currentScreenId,
                    page: window.location.href || "",
                    timestamp: new Date().toISOString(),
                    logicalName: r.logicalName,
                    objectType: r.objectType,
                    selectorType: r.selectorType,
                    selectorValue: r.selectorValue,
                    actionType: r.actionType,
                    inputValue: r.inputValue
                });
            } catch (e) {}
        }

        if (!recordedScreens[currentScreenId]) {
            recordedScreens[currentScreenId] = {
                screenId: currentScreenId,
                page: window.location.href || "",
                title: getPageTitle(),
                label: getPageLabelFallback(),
                elements: []
            };
        }
        var elements = recordedScreens[currentScreenId].elements;
        if (actionType === "input" && (objectType === "Textbox" || objectType === "textbox")) {
            var existing = elements.find(function (r) { return r.selectorValue === selectorValue; });
            if (existing) {
                existing.inputValue = record.inputValue;
                pushRecordedAction(record);
                return;
            }
        }
        elements.push(record);
        pushRecordedAction(record);
    }

    function initRecordingListeners() {
        if (window.__WEBIO_RECORDING_INIT__) return;
        window.__WEBIO_RECORDING_INIT__ = true;
        document.addEventListener("click", function (e) {
            if (!isRecording) return;
            if (e.target.closest && e.target.closest("[data-webio-panel], [data-locator-popup], [data-export-popup], [data-webio-contextmenu]")) return;
            var el = getRecordableElementFromTarget(e.target);
            if (el) captureRecordedElement(el, "click", null);
        }, true);
        document.addEventListener("change", function (e) {
            if (!isRecording) return;
            var el = e.target;
            if (!el || el.nodeType !== 1) return;
            if (el.closest && el.closest("[data-webio-panel], [data-locator-popup], [data-export-popup]")) return;
            var tag = (el.tagName || "").toLowerCase();
            var typeAttr = (el.getAttribute && el.getAttribute("type")) ? String(el.getAttribute("type")).toLowerCase() : "";
            if (tag === "select") captureRecordedElement(el, "change", (el.options && el.options[el.selectedIndex]) ? el.options[el.selectedIndex].text : el.value);
            else if (tag === "input" && (typeAttr === "checkbox" || typeAttr === "radio")) captureRecordedElement(el, "change", el.checked);
            else if ((tag === "input" && ["text", "password", "search", "email", ""].indexOf(typeAttr) >= 0) || tag === "textarea") captureRecordedElement(el, "input", el.value);
        }, true);
    }
    initRecordingListeners();

    let contextMenu = null;
    let tooltip = null;
    let areaSelectionMode = false;
    let selectionRect = null;
    let isSelecting = false;
    let selectable = [];
    let filteredSelectable = [];
    
    // -----------------------------
    // Web table drag selection mode
    // -----------------------------
    // Stores everything in ONE object: window.__WEBIO__.selectedTable
    // Shape:
    // selectedTable = { name, selectedRows, selectedColumns, data }
    let tableSelectionMode = false;
    let activeTable = null;
    let tableSelectedRows = new Set();   // data rows (0-based, excludes header)
    let tableSelectedCols = new Set();   // columns (0-based)
    let dragStart = null; // { r: number, c: number } (r is table row index including header at 0)
    let dragEnd = null;   // { r: number, c: number }
    let tablePreviewPopup = null;

    const TABLE_SELECTED_CELL_CLASS = "webio-table-selected-cell";
    function ensureTableSelectionStyles() {
        if (document.getElementById("webio-table-selection-style")) return;
        const style = document.createElement("style");
        style.id = "webio-table-selection-style";
        style.textContent = `
            .${TABLE_SELECTED_CELL_CLASS} { outline: 2px solid #f59e0b !important; background: rgba(245, 158, 11, 0.12) !important; }
            [data-webio-table-preview] * { color: #000 !important; color-scheme: light; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function getClosestTable(el) {
        try {
            return el && el.closest ? el.closest("table") : null;
        } catch (e) {
            return null;
        }
    }

    function getCellCoords(cell, tableEl) {
        if (!cell || !tableEl) return null;
        const td = cell.closest ? cell.closest("td,th") : null;
        if (!td) return null;
        const tr = td.parentElement;
        if (!tr) return null;
        // rowIndex on HTMLTableRowElement is relative to the entire table (includes header rows)
        const rowIndex = tr.rowIndex;
        const colIndex = td.cellIndex;
        if (typeof rowIndex !== "number" || typeof colIndex !== "number") return null;
        return { r: rowIndex, c: colIndex };
    }

    function clearTableHighlights() {
        if (!activeTable) return;
        try {
            const cells = activeTable.querySelectorAll("td." + TABLE_SELECTED_CELL_CLASS + ", th." + TABLE_SELECTED_CELL_CLASS);
            cells.forEach((c) => c.classList.remove(TABLE_SELECTED_CELL_CLASS));
        } catch (e) {}
    }

    function applyTableHighlights() {
        if (!activeTable) return;
        clearTableHighlights();
        const rows = activeTable.rows ? Array.from(activeTable.rows) : [];
        if (!rows.length) return;
        // header
        const headerRow = rows[0];
        Array.from(headerRow.cells || []).forEach((cell, ci) => {
            if (tableSelectedCols.has(ci)) cell.classList.add(TABLE_SELECTED_CELL_CLASS);
        });
        // body
        for (let ri = 1; ri < rows.length; ri++) {
            const bodyRowIdx = ri - 1;
            if (!tableSelectedRows.has(bodyRowIdx)) continue;
            const cells = Array.from(rows[ri].cells || []);
            cells.forEach((cell, ci) => {
                if (tableSelectedCols.has(ci)) cell.classList.add(TABLE_SELECTED_CELL_CLASS);
            });
        }
    }

    function computeSelectedTableData() {
        if (!activeTable) return { headers: [], rows: [] };
        const rows = activeTable.rows ? Array.from(activeTable.rows) : [];
        if (!rows.length) return { headers: [], rows: [] };
        const headerCells = Array.from(rows[0].cells || []);
        const sortedCols = Array.from(tableSelectedCols).sort((a, b) => a - b);
        const headers = sortedCols.map((ci) => (headerCells[ci] && (headerCells[ci].innerText || headerCells[ci].textContent) || "").trim());
        const sortedRows = Array.from(tableSelectedRows).sort((a, b) => a - b);
        const dataRows = sortedRows.map((rIdx) => {
            const tr = rows[rIdx + 1]; // +1 to skip header
            const cells = tr ? Array.from(tr.cells || []) : [];
            return sortedCols.map((ci) => (cells[ci] && (cells[ci].innerText || cells[ci].textContent) || "").trim());
        });
        return { headers, rows: dataRows, sortedCols, sortedRows };
    }

    function setSelectedTableObject(name) {
        const calc = computeSelectedTableData();
        const selectedTable = {
            name: String(name || "").trim() || "Table",
            selectedRows: calc.sortedRows || [],
            selectedColumns: calc.sortedCols || [],
            data: [calc.headers].concat(calc.rows || [])
        };
        try {
            window.__WEBIO__.selectedTable = selectedTable;
        } catch (e) {}
        // also attach to current screen for generation/export
        try {
            const s = getCurrentScreen();
            s.selectedTable = selectedTable;
        } catch (e) {}
        // If recording mode is active, attach to recordedScreens too so generation includes it.
        try {
            if (recordedScreens && recordedScreens[currentScreenId]) {
                recordedScreens[currentScreenId].selectedTable = selectedTable;
            }
        } catch (e) {}
        return selectedTable;
    }

    function renderTablePreview() {
        if (!tablePreviewPopup) return;
        const nameInput = tablePreviewPopup.querySelector("#webioTableNameInput");
        const name = nameInput ? nameInput.value : (activeTable && activeTable.id ? activeTable.id : "Table");
        const selectedTable = setSelectedTableObject(name);

        const previewWrap = tablePreviewPopup.querySelector("#webioTablePreviewWrap");
        if (!previewWrap) return;
        const data = selectedTable.data || [];
        const htmlRows = data.map((row, idx) => {
            const cells = (row || []).map((c) => `<${idx === 0 ? "th" : "td"} style="border:1px solid #ddd;padding:6px;text-align:left;">${escapeHtml(String(c ?? ""))}</${idx === 0 ? "th" : "td"}>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        previewWrap.innerHTML = `
          <div style="font-size:12px;margin-bottom:8px;color:#111;">
            Selected rows: <b>${JSON.stringify(selectedTable.selectedRows || [])}</b> &nbsp; Selected columns: <b>${JSON.stringify(selectedTable.selectedColumns || [])}</b>
          </div>
          <div style="overflow:auto;max-height:240px;border:1px solid #eee;border-radius:6px;">
            <table style="border-collapse:collapse;width:100%;font-size:12px;">
              ${htmlRows}
            </table>
          </div>
        `;
    }

    function openTablePreviewPopup(defaultName) {
        // close existing
        const existing = document.querySelector("[data-webio-table-preview]");
        if (existing) {
            try { document.body.removeChild(existing); } catch (e) {}
        }
        tablePreviewPopup = document.createElement("div");
        tablePreviewPopup.setAttribute("data-webio-table-preview", "true");
        tablePreviewPopup.style.cssText = `
            position: fixed; top: 20px; left: 20px;
            background: #fff; border: 1px solid #ccc; border-radius: 10px;
            padding: 14px; z-index: 999999; width: 420px; max-width: 90vw;
            box-shadow: 0 12px 30px rgba(0,0,0,0.25); font-family: sans-serif;
        `;
        tablePreviewPopup.innerHTML = `
            <div class="webio-table-drag-handle" style="cursor:move;user-select:none;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:4px 0;">
              <div style="font-weight:700;">Table selection</div>
              <div style="font-size:12px;color:#555;">Drag to select. Click header = toggle column. Click row cell = toggle row.</div>
            </div>
            <label style="display:block;font-size:12px;margin-bottom:8px;">
              Table name<br/>
              <input id="webioTableNameInput" value="${escapeHtml(String(defaultName || ""))}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;"/>
            </label>
            <div id="webioTablePreviewWrap" style="margin-bottom:10px;"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button id="webioTableConfirmBtn" style="padding:8px 12px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer;">Confirm</button>
              <button id="webioTableResetBtn" style="padding:8px 12px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;">Reset Selection</button>
              <button id="webioTableCancelBtn" style="padding:8px 12px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;">Cancel</button>
            </div>
        `;
        document.body.appendChild(tablePreviewPopup);
        makePopupDraggable(tablePreviewPopup, ".webio-table-drag-handle");
        tablePreviewPopup.querySelector("#webioTableNameInput").addEventListener("input", function () {
            renderTablePreview();
        });
        tablePreviewPopup.querySelector("#webioTableResetBtn").onclick = function (ev) {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
            tableSelectedRows = new Set();
            tableSelectedCols = new Set();
            applyTableHighlights();
            renderTablePreview();
        };
        tablePreviewPopup.querySelector("#webioTableCancelBtn").onclick = function (ev) {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
            exitTableSelectionMode(true);
        };
        tablePreviewPopup.querySelector("#webioTableConfirmBtn").onclick = function (ev) {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
            // Persist selectedTable and also capture a locator for the table root by name (so step can resolve it).
            const nameInput = tablePreviewPopup.querySelector("#webioTableNameInput");
            const tableName = nameInput ? String(nameInput.value || "").trim() : "";
            const selectedTable = setSelectedTableObject(tableName);

            // Capture locator for the table itself (no data), so locator JSON contains the table name.
            try {
                const t = activeTable;
                if (t) {
                    const logicalName = selectedTable.name;
                    const selectorType = t.id ? "id" : "xpath";
                    const selectorValue = t.id ? t.id : (getXPath(t) || "");
                    if (selectorValue) {
                        const payload = { logicalName, objectType: "Other", selectorType, selectorValue, value: "" };
                        const screen = getCurrentScreen();
                        screen.elements = screen.elements || [];
                        if (!screen.elements.some((e) => e && e.logicalName === logicalName)) {
                            screen.elements.push(payload);
                        }
                        if (recordedScreens && recordedScreens[currentScreenId]) {
                            const rs = recordedScreens[currentScreenId];
                            rs.elements = rs.elements || [];
                            if (!rs.elements.some((e) => e && e.logicalName === logicalName)) {
                                rs.elements.push(payload);
                            }
                        }
                    }
                }
            } catch (e) {}

            persistScreensOrAlert("Persist table selection");
            updateListUI();
            exitTableSelectionMode(false);
        };

        renderTablePreview();
    }

    function startTableSelectionMode(tableEl) {
        ensureTableSelectionStyles();
        tableSelectionMode = true;
        activeTable = tableEl;
        dragStart = null;
        dragEnd = null;
        // Keep any existing selection (merge behavior) if user re-enters mode on same table,
        // otherwise start clean.
        if (!activeTable || !activeTable.rows || activeTable.rows.length === 0) {
            alert("[webio] No rows found in this table.");
            return;
        }
        openTablePreviewPopup(activeTable.id || "ProductTable");
        applyTableHighlights();
    }

    function exitTableSelectionMode(clearSelection) {
        tableSelectionMode = false;
        dragStart = null;
        dragEnd = null;
        if (clearSelection) {
            tableSelectedRows = new Set();
            tableSelectedCols = new Set();
        }
        clearTableHighlights();
        activeTable = null;
        if (tablePreviewPopup) {
            try { document.body.removeChild(tablePreviewPopup); } catch (e) {}
            tablePreviewPopup = null;
        }
    }

    function onTableMouseDown(e) {
        if (!tableSelectionMode || !activeTable) return;
        const coords = getCellCoords(e.target, activeTable);
        if (!coords) return;
        e.preventDefault();
        e.stopPropagation();
        dragStart = coords;
        dragEnd = coords;
        applyDraggedRectangle(true);
    }
    function onTableMouseOver(e) {
        if (!tableSelectionMode || !activeTable) return;
        if (!dragStart) return;
        const coords = getCellCoords(e.target, activeTable);
        if (!coords) return;
        dragEnd = coords;
        applyDraggedRectangle(true);
    }
    function onTableMouseUp(e) {
        if (!tableSelectionMode || !activeTable) return;
        if (!dragStart || !dragEnd) return;
        e.preventDefault();
        e.stopPropagation();
        applyDraggedRectangle(false); // commit
        dragStart = null;
        dragEnd = null;
        applyTableHighlights();
        renderTablePreview();
    }

    function applyDraggedRectangle(previewOnly) {
        if (!activeTable || !dragStart || !dragEnd) return;
        const r1 = Math.min(dragStart.r, dragEnd.r);
        const r2 = Math.max(dragStart.r, dragEnd.r);
        const c1 = Math.min(dragStart.c, dragEnd.c);
        const c2 = Math.max(dragStart.c, dragEnd.c);
        if (!previewOnly) {
            // Merge selection: add all rows/cols in rectangle.
            for (let c = c1; c <= c2; c++) tableSelectedCols.add(c);
            for (let r = r1; r <= r2; r++) {
                if (r === 0) continue; // header row not stored in selectedRows
                tableSelectedRows.add(r - 1);
            }
        }
        applyTableHighlights();
    }

    function onTableClickToggle(e) {
        if (!tableSelectionMode || !activeTable) return;
        const coords = getCellCoords(e.target, activeTable);
        if (!coords) return;
        // If user clicks a selected area again: remove row/column.
        // - header cell click toggles column
        // - body cell click toggles row
        if (coords.r === 0) {
            if (tableSelectedCols.has(coords.c)) tableSelectedCols.delete(coords.c);
            else tableSelectedCols.add(coords.c);
        } else {
            const bodyRow = coords.r - 1;
            if (tableSelectedRows.has(bodyRow)) tableSelectedRows.delete(bodyRow);
            else tableSelectedRows.add(bodyRow);
        }
        applyTableHighlights();
        renderTablePreview();
    }

    // Global listeners (capture phase) so selection works on any page without touching app code.
    document.addEventListener("mousedown", function (e) {
        if (!tableSelectionMode) return;
        if (!activeTable) return;
        if (!activeTable.contains(e.target)) return;
        onTableMouseDown(e);
    }, true);
    document.addEventListener("mouseover", function (e) {
        if (!tableSelectionMode) return;
        if (!activeTable) return;
        if (!activeTable.contains(e.target)) return;
        onTableMouseOver(e);
    }, true);
    document.addEventListener("mouseup", function (e) {
        if (!tableSelectionMode) return;
        if (!activeTable) return;
        onTableMouseUp(e);
    }, true);
    document.addEventListener("click", function (e) {
        if (!tableSelectionMode) return;
        if (!activeTable) return;
        if (!activeTable.contains(e.target)) return;
        onTableClickToggle(e);
    }, true);
    
    function xpathLiteral(str) {
        const s = String(str == null ? "" : str);
        if (s.indexOf('"') === -1) return '"' + s + '"';
        if (s.indexOf("'") === -1) return "'" + s + "'";
        const parts = s.split('"');
        return "concat(" + parts.map((p) => '"' + p + '"').join(', \'"\', ') + ")";
    }

    function getXPath(el) {
        if (!el || el.nodeType !== 1) return "";
        const attr = (n) => {
            try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
        };

        const id = el.id ? String(el.id).trim() : "";
        if (id) return "//*[@id=" + xpathLiteral(id) + "]";
        const dataTestId = attr("data-testid");
        if (dataTestId && String(dataTestId).trim()) return "//*[@data-testid=" + xpathLiteral(String(dataTestId).trim()) + "]";
        const name = attr("name");
        if (name && String(name).trim()) return "//*[@name=" + xpathLiteral(String(name).trim()) + "]";
        const aria = attr("aria-label");
        if (aria && String(aria).trim()) return "//*[@aria-label=" + xpathLiteral(String(aria).trim()) + "]";

        const placeholder = attr("placeholder");
        const tag = (el.tagName || "").toLowerCase();
        if ((tag === "input" || tag === "textarea") && placeholder && String(placeholder).trim()) {
            return "//" + tag + "[@placeholder=" + xpathLiteral(String(placeholder).trim()) + "]";
        }
        const text = String((el.innerText || el.textContent || "")).trim().replace(/\s+/g, " ");
        if ((tag === "button" || tag === "a") && text && text.length <= 80) {
            return "//" + tag + "[normalize-space(.)=" + xpathLiteral(text) + "]";
        }

        // Fallback absolute path
        if (el === document.body) return "/html/body";
        let ix = 0;
        const siblings = el.parentNode ? el.parentNode.childNodes : [];
        for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === el) return getXPath(el.parentNode) + "/" + el.tagName.toLowerCase() + "[" + (ix + 1) + "]";
            if (sibling && sibling.nodeType === 1 && sibling.tagName === el.tagName) ix++;
        }
        return "";
    }
    
    function getCssSelector(el) {
        if (el.id) return `#${el.id}`;
        let path = [];
        while (el && el.nodeType === 1) {
            let selector = el.nodeName.toLowerCase();
            if (el.className) selector += "." + [...el.classList].join(".");
            path.unshift(selector);
            el = el.parentElement;
        }
        return path.join(" > ");
    }
    
    function getConfidence(el) {
        let score = 0.5;
        if (el.id) score += 0.3;
        if (el.className && el.className.length < 40) score += 0.2;
        return Math.min(1.0, score);
    }

    /** Return true if el is or is inside a Material-UI Radio/Checkbox/Switch root. */
    function isMuiControlClass(el, className) {
        if (!el || !el.classList) return false;
        for (var i = 0; i < el.classList.length; i++) {
            if (el.classList[i].indexOf(className) !== -1) return true;
        }
        return false;
    }
    /** Resolve to the MUI control root (e.g. .MuiRadio-root) when right-clicking icon/span inside it. */
    function getMuiControlRoot(el) {
        if (!el || !el.closest) return null;
        var root = el.closest(".MuiRadio-root, .MuiCheckbox-root, .MuiSwitch-root, [class*=\"MuiRadio-root\"], [class*=\"MuiCheckbox-root\"], [class*=\"MuiSwitch-root\"]");
        return root || null;
    }
    /**
     * Universal control root for any UI (MUI, Ant Design, Bootstrap, plain HTML, etc.).
     * Returns the clickable wrapper: MUI root, <label> containing radio/checkbox, or [role="radio"]/[role="checkbox"].
     */
    function getControlRoot(el) {
        if (!el || !el.closest) return null;
        var mui = getMuiControlRoot(el);
        if (mui) return mui;
        var label = el.tagName && el.tagName.toLowerCase() === "label" ? el : (el.closest("label") || null);
        if (label && label.querySelector && label.querySelector("input[type=\"radio\"], input[type=\"checkbox\"]"))
            return label;
        var roleRoot = el.closest("[role=\"radio\"], [role=\"checkbox\"], [role=\"switch\"]");
        return roleRoot || null;
    }
    /**
     * Get the native input inside any control (MUI root, label, or role wrapper). Used for id/name in selectors.
     * Uses case-insensitive type check so type="Radio" / "Checkbox" is found on sites that set it via JS.
     */
    function getControlInput(root) {
        if (!root) return null;
        if (root.tagName && root.tagName.toLowerCase() === "input") return root;
        if (!root.querySelector) return null;
        var input = root.querySelector("input[type=\"radio\"], input[type=\"checkbox\"], input[type=\"hidden\"], input[type=\"Radio\"], input[type=\"Checkbox\"]");
        if (input) return input;
        var allInputs = root.querySelectorAll("input");
        for (var i = 0; i < allInputs.length; i++) {
            var t = (allInputs[i].getAttribute && allInputs[i].getAttribute("type")) ? String(allInputs[i].getAttribute("type")).toLowerCase() : "";
            if (t === "radio" || t === "checkbox" || t === "hidden") return allInputs[i];
        }
        return null;
    }
    /** Get visible label text for any control (MUI, PrimeReact, native <label>, or label[for], sibling label). */
    function getControlLabel(root) {
        if (!root) return "";
        var formLabel = root.closest && root.closest(".MuiFormControlLabel-root");
        if (formLabel) {
            var labelEl = formLabel.querySelector(".MuiFormControlLabel-label");
            if (labelEl && labelEl.innerText) return labelEl.innerText.trim();
            if (formLabel.innerText) return formLabel.innerText.trim();
        }
        if (root.tagName && root.tagName.toLowerCase() === "label" && root.innerText)
            return root.innerText.trim();
        var labelParent = root.closest && root.closest("label");
        if (labelParent && labelParent.innerText) return labelParent.innerText.trim();
        var inputEl = getControlInput(root) || (root.tagName && root.tagName.toLowerCase() === "input" ? root : null);
        if (inputEl && inputEl.id) {
            try {
                var idStr = String(inputEl.id).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                var forLabel = document.querySelector('label[for="' + idStr + '"]');
                if (forLabel && forLabel.innerText) return forLabel.innerText.trim();
            } catch (e) {}
        }
        var wrapper = root.parentElement;
        if (wrapper) {
            var next = root.nextElementSibling;
            if (next && next.tagName && next.tagName.toLowerCase() === "label" && next.innerText) return next.innerText.trim();
            var prev = root.previousElementSibling;
            if (prev && prev.tagName && prev.tagName.toLowerCase() === "label" && prev.innerText) return prev.innerText.trim();
        }
        return "";
    }
    function determineObjectType(el) {
        if (!el) return "Button";
        var root = getControlRoot(el);
        var checkEl = root || el;
        if (isMuiControlClass(checkEl, "MuiRadio-root")) return "Radio";
        if (isMuiControlClass(checkEl, "MuiCheckbox-root") || isMuiControlClass(checkEl, "MuiSwitch-root")) return "Checkbox";
        var role = (checkEl.getAttribute && checkEl.getAttribute("role")) ? String(checkEl.getAttribute("role")).toLowerCase() : "";
        if (role === "textbox" || role === "searchbox") return "Textbox";
        if (role === "combobox" || role === "listbox") return "Dropdown";
        if (role === "checkbox" || role === "switch") return "Checkbox";
        if (role === "radio" || role === "radiogroup") return "Radio";
        if (role === "button" || role === "link") return role === "link" ? "Link" : "Button";
        var inputEl = getControlInput(checkEl);
        if (inputEl) {
            var itype = (inputEl.getAttribute && inputEl.getAttribute("type")) ? String(inputEl.getAttribute("type")).toLowerCase() : "";
            if (itype === "radio") return "Radio";
            if (itype === "checkbox") return "Checkbox";
        }
        var tag = (el.tagName || "").toLowerCase();
        var typeAttr = (el.getAttribute && el.getAttribute("type")) ? String(el.getAttribute("type")).toLowerCase() : "";
        if (tag === "textarea") return "Textbox";
        if (tag === "button") return "Button";
        if (tag === "a") return "Link";
        if (tag === "select") return "Dropdown";
        if (tag === "input") {
            if (typeAttr === "checkbox") return "Checkbox";
            if (typeAttr === "radio") return "Radio";
            return "Textbox";
        }
        return "Button";
    }

    function buildSelectorOptions(el, savedRecord) {
        const seen = new Set();
        const options = [];
        function add(type, value, label) {
            if (!type || value == null || String(value).trim() === "") return;
            const key = type + "__" + value;
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ type, value: String(value).trim(), label: label || type + ": " + (String(value).length > 45 ? String(value).slice(0, 42) + "..." : value) });
        }
        if (el) {
            var inputEl = getControlInput(el) || el;
            if (inputEl.id && inputEl.id.trim()) add("id", inputEl.id.trim(), "id: " + inputEl.id.trim());
            var name = (inputEl.getAttribute && inputEl.getAttribute("name")) || (el.getAttribute && el.getAttribute("name"));
            if (name && String(name).trim()) add("name", String(name).trim(), "name: " + String(name).trim());
            var dataTestId = (inputEl.getAttribute && inputEl.getAttribute("data-testid")) || (el.getAttribute && el.getAttribute("data-testid"));
            if (dataTestId && String(dataTestId).trim()) add("data-testid", String(dataTestId).trim(), "data-testid: " + String(dataTestId).trim());
            var tag = (el.tagName || "").toLowerCase();
            var text = (el.innerText || el.textContent || "").trim().slice(0, 200);
            if (tag === "a" && text) add("linkText", text, "linkText: " + (text.length > 40 ? text.slice(0, 37) + "..." : text));
            if (tag === "button" && text) add("buttonText", text, "buttonText: " + (text.length > 40 ? text.slice(0, 37) + "..." : text));
            // For radio/checkbox use the actual input so we get id-based selector (e.g. //*[@id="category1"]) when present; else xpath
            var selectorEl = inputEl && (inputEl.id || inputEl.tagName === "INPUT" || inputEl.tagName === "SELECT") ? inputEl : el;
            add("css", getCssSelector(selectorEl), "css: ...");
            add("xpath", getXPath(selectorEl), "xpath: ...");
        }
        if (savedRecord) {
            if (savedRecord.selectorType && savedRecord.selectorValue) add(savedRecord.selectorType, savedRecord.selectorValue);
            if (savedRecord.css) add("css", savedRecord.css);
            if (savedRecord.xpath) add("xpath", savedRecord.xpath);
            if (savedRecord.id) add("id", savedRecord.id);
        }
        return options.length ? options : [{ type: "css", value: "", label: "css: " }];
    }

    function makePopupDraggable(popup, handleSelector) {
        var handle = popup.querySelector(handleSelector);
        if (!handle) return;
        var startX = 0, startY = 0, startLeft = 0, startTop = 0;
        function onMove(e) {
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            popup.style.left = Math.max(0, startLeft + dx) + "px";
            popup.style.top = Math.max(0, startTop + dy) + "px";
            popup.style.right = "auto";
            popup.style.transform = "none";
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        }
        handle.addEventListener("mousedown", function (e) {
            if (e.target.closest("input, button, select")) return;
            var rect = popup.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            e.preventDefault();
            popup.style.transform = "none";
            popup.style.left = startLeft + "px";
            popup.style.top = startTop + "px";
            popup.style.right = "auto";
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    function showPopup(el, defaults, onSave) {
        const existingPopup = document.querySelector('[data-locator-popup]');
        if (existingPopup) document.body.removeChild(existingPopup);

        const popup = document.createElement("div");
        popup.setAttribute("data-locator-popup", "true");
        popup.style.cssText = "position:fixed;top:30px;left:30px;z-index:999999;background:#fff;color:#000;border:1px solid #ccc;padding:16px;font-family:sans-serif;box-shadow:2px 2px 10px rgba(0,0,0,0.3);color-scheme:light;width:320px;";

        var esc = function (s) { return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
        var objType = defaults.objectType || (el ? determineObjectType(el) : "Button");
        var selectorOpts = buildSelectorOptions(el, defaults);
        var selIdx = 0;
        if (defaults.selectorType && defaults.selectorValue) {
            var found = selectorOpts.findIndex(function (o) { return o.type === defaults.selectorType && o.value === defaults.selectorValue; });
            if (found >= 0) selIdx = found;
        }
        var selOpt = selectorOpts[selIdx] || selectorOpts[0];
        var selValue = defaults.selectorValue != null ? defaults.selectorValue : (selOpt ? selOpt.value : "");
        var actionValue = defaults.value != null ? defaults.value : (el && el.value != null && typeof el.value === "string" ? el.value : "");
        if (!actionValue && objType === "Textbox" && el && (el.placeholder || (el.getAttribute && el.getAttribute("placeholder"))))
            actionValue = (el.placeholder || el.getAttribute("placeholder") || "").trim();
        if (!actionValue && objType === "Dropdown" && el && el.options && el.options.length)
            actionValue = (el.options[el.selectedIndex] && el.options[el.selectedIndex].text) ? el.options[el.selectedIndex].text.trim() : "";
        var objTypes = ["Textbox", "Button", "Link", "Dropdown", "Checkbox", "Radio", "Other"];
        var objHtml = objTypes.map(function (t) { return "<option value=\"" + esc(t) + "\"" + (t === objType ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
        var selHtml = selectorOpts.map(function (o, i) { return "<option value=\"" + i + "\">" + esc(o.label) + "</option>"; }).join("");

        popup.innerHTML = "<style>[data-locator-popup] input,[data-locator-popup] label,[data-locator-popup] button,[data-locator-popup] select{color:#000!important;background-color:#fff!important;border-color:#ccc!important}</style>" +
            "<div class=\"webio-popup-drag-handle\" style=\"cursor:move;user-select:none;padding:4px 0 8px;margin:-16px -16px 10px -16px;border-bottom:1px solid #eee;font-weight:600;\">Capture element</div>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Logical Name<br><input id=\"logicalName\" value=\"" + esc(defaults.logicalName) + "\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Object Type<br><select id=\"objectType\" style=\"width:100%;padding:6px;box-sizing:border-box;\">" + objHtml + "</select></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Choose Attribute/Selector to Save<br><select id=\"selectorSelect\" style=\"width:100%;padding:6px;box-sizing:border-box;\">" + selHtml + "</select></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Selector Value<br><input id=\"selectorValue\" value=\"" + esc(selValue) + "\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<label style=\"display:block;margin-bottom:12px;font-size:12px;\">Value (text to enter / option to select)<br><input id=\"actionValue\" value=\"" + esc(actionValue) + "\" placeholder=\"e.g. username, option1\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<div style=\"text-align:right;\"><button id=\"cancelBtn\" style=\"margin-right:8px;padding:6px 12px;\">Cancel</button><button id=\"saveBtn\" style=\"padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;\">Save</button></div>";

        document.body.appendChild(popup);
        makePopupDraggable(popup, ".webio-popup-drag-handle");
        // Focus to ensure keystrokes go to the popup, not the underlying app.
        try { popup.querySelector("#logicalName") && popup.querySelector("#logicalName").focus(); } catch (e) {}

        var selSelect = popup.querySelector("#selectorSelect");
        var selValueInput = popup.querySelector("#selectorValue");
        selSelect.addEventListener("change", function () {
            var idx = parseInt(selSelect.value, 10);
            if (!isNaN(idx) && selectorOpts[idx]) selValueInput.value = selectorOpts[idx].value;
        });

        popup.querySelector("#saveBtn").onclick = function (ev) {
            try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
            try {
                var idx = parseInt(selSelect.value, 10);
                var chosen = selectorOpts[idx] || selectorOpts[0] || { type: "css", value: selValueInput.value };
                onSave({
                    logicalName: (popup.querySelector("#logicalName").value || "").trim() || "Element",
                    objectType: popup.querySelector("#objectType").value || objType,
                    selectorType: chosen.type,
                    selectorValue: (selValueInput.value || chosen.value || "").trim(),
                    value: (popup.querySelector("#actionValue").value || "").trim(),
                    css: chosen.type === "css" ? (selValueInput.value || chosen.value) : (defaults.css || ""),
                    xpath: chosen.type === "xpath" ? (selValueInput.value || chosen.value) : (defaults.xpath || ""),
                    confidence: defaults.confidence
                });
            } catch (e) {
                alert("[webio] Save failed: " + (e && e.message ? e.message : "unknown error"));
            } finally {
                try { if (el && el.style) el.style.outline = ""; } catch (e) {}
                try { document.body.removeChild(popup); } catch (e) {}
            }
        };
        popup.querySelector("#cancelBtn").onclick = function (ev) {
            try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
            try { if (el && el.style) el.style.outline = ""; } catch (e) {}
            try { document.body.removeChild(popup); } catch (e) {}
        };
    }
    
    function showContextMenu(e, el) {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove existing context menu
        if (contextMenu) {
            document.body.removeChild(contextMenu);
        }
        
        contextMenu = document.createElement("div");
        contextMenu.setAttribute("data-webio-contextmenu", "true");
        // Use viewport coords because the menu is position:fixed
        // (pageX/pageY + fixed can push the menu off-screen for lower elements).
        var x = (typeof e.clientX === "number") ? e.clientX : (typeof e.pageX === "number" ? e.pageX : 0);
        var y = (typeof e.clientY === "number") ? e.clientY : (typeof e.pageY === "number" ? e.pageY : 0);
        contextMenu.style.cssText = `
            position: fixed; left: ${x}px; top: ${y}px;
            background: #fff; color: #000; border: 1px solid #ccc; padding: 5px 0;
            font-family: sans-serif; box-shadow: 2px 2px 10px rgba(0,0,0,0.3);
            z-index: 999999; min-width: 150px; color-scheme: light;
        `;
        
        function closeMenu() {
            try { if (contextMenu) document.body.removeChild(contextMenu); } catch (e) {}
            contextMenu = null;
        }

        function persistLocatorForElement(targetEl, objectTypeOverride, defaultValueOverride) {
            const label = (getControlLabel(targetEl) || targetEl.innerText || "").trim() || targetEl.tagName.toLowerCase();
            var selectorEl = targetEl;
            var ctrlInput = getControlInput(targetEl);
            if (ctrlInput && (ctrlInput.id || ctrlInput.tagName === "INPUT" || ctrlInput.tagName === "SELECT")) selectorEl = ctrlInput;
            const css = getCssSelector(selectorEl);
            const xpath = getXPath(selectorEl);
            const confidence = getConfidence(selectorEl);

            var defaultObjectType = objectTypeOverride || determineObjectType(targetEl);
            var defaultValue = defaultValueOverride != null ? defaultValueOverride : "";

            showPopup(targetEl, {
                logicalName: label,
                css,
                xpath,
                confidence,
                objectType: defaultObjectType,
                value: defaultValue
            }, (userInput) => {
                targetEl.style.outline = '2px solid green';
                var ctrlInput = getControlInput(targetEl);
                var exportId = (ctrlInput && ctrlInput.id) ? ctrlInput.id : (targetEl.id || "");
                var objType = userInput.objectType || determineObjectType(targetEl);
                var payload = {
                    tag: (ctrlInput && ctrlInput.tagName) ? ctrlInput.tagName.toLowerCase() : targetEl.tagName.toLowerCase(),
                    id: exportId,
                    class: targetEl.className,
                    text: label,
                    logicalName: userInput.logicalName,
                    objectType: objType,
                    selectorType: userInput.selectorType,
                    selectorValue: userInput.selectorValue,
                    value: userInput.value,
                    css: userInput.css,
                    xpath: userInput.xpath,
                    confidence: userInput.confidence
                };
                if ((objType === "Radio" || objType === "Checkbox") && label) payload.labelText = label;
                getCurrentScreen().elements.push(payload);
                persistScreensOrAlert("Persist locator");
                updateListUI();
            });
            closeMenu();
        }

        function persistLocatorDirect(targetEl, objectTypeOverride, valueOverride) {
            if (!targetEl) return;
            const label = (getControlLabel(targetEl) || targetEl.innerText || "").trim() || targetEl.tagName.toLowerCase();
            var selectorEl = targetEl;
            var ctrlInput = getControlInput(targetEl);
            if (ctrlInput && (ctrlInput.id || ctrlInput.tagName === "INPUT" || ctrlInput.tagName === "SELECT")) selectorEl = ctrlInput;

            const css = getCssSelector(selectorEl);
            const xpath = getXPath(selectorEl);
            const confidence = getConfidence(selectorEl);
            const selectorOpts = buildSelectorOptions(targetEl, null);
            const xpathOpt = selectorOpts && selectorOpts.find(function (o) { return o.type === "xpath"; });
            const xpathValue = (xpathOpt && xpathOpt.value) ? xpathOpt.value : (xpath || "");
            const objType = objectTypeOverride || determineObjectType(targetEl);
            const defaultValue = valueOverride != null ? String(valueOverride).trim() : "";

            var payload = {
                tag: (ctrlInput && ctrlInput.tagName) ? ctrlInput.tagName.toLowerCase() : targetEl.tagName.toLowerCase(),
                id: (ctrlInput && ctrlInput.id) ? ctrlInput.id : (targetEl.id || ""),
                class: targetEl.className,
                text: label,
                logicalName: label,
                objectType: objType,
                selectorType: "xpath",
                selectorValue: (xpathValue || "").trim(),
                value: defaultValue,
                css: css,
                xpath: xpath,
                confidence: confidence
            };
            if ((objType === "Radio" || objType === "Checkbox") && label) payload.labelText = label;
            getCurrentScreen().elements.push(payload);
            persistScreensOrAlert("Persist locator");
            updateListUI();
            closeMenu();
        }

        function addMenuAction(label, onClick) {
            const item = document.createElement("div");
            item.innerText = label;
            item.style.cssText = "padding: 8px 15px; cursor: pointer;";
            item.onmouseenter = () => { item.style.background = "#f0f0f0"; };
            item.onmouseleave = () => { item.style.background = "#fff"; };
            item.onclick = () => {
                try { onClick(); } catch (err) {}
            };
            contextMenu.appendChild(item);
        }

        // If user right-clicks on a table (or inside it), show table-specific actions. Order: Save locator, Verify text, Verify web table.
        const closestTable = getClosestTable(el);
        if (closestTable) {
            addMenuAction("Save locator", () => {
                persistLocatorForElement(el);
            });
            addMenuAction("Verify Text", () => {
                const cellText = ((el && (el.innerText || el.textContent)) || "").trim();
                persistLocatorDirect(el, "Other", cellText);
            });
            addMenuAction("Verify Web Table", () => {
                closeMenu();
                startTableSelectionMode(closestTable);
            });
        } else {
            // Default non-table actions. Order: Save locator, Verify text.
            addMenuAction("Save locator", () => {
                persistLocatorForElement(el);
            });
            addMenuAction("Verify Text", () => {
                const textVal = ((el && (el.innerText || el.textContent)) || "").trim();
                persistLocatorDirect(el, "Other", textVal);
            });
        }
        document.body.appendChild(contextMenu);

        // Clamp the menu so it stays visible within the viewport.
        try {
            var rect = contextMenu.getBoundingClientRect();
            var pad = 8;
            var maxLeft = Math.max(pad, (window.innerWidth || document.documentElement.clientWidth) - rect.width - pad);
            var maxTop = Math.max(pad, (window.innerHeight || document.documentElement.clientHeight) - rect.height - pad);
            var newLeft = Math.min(Math.max(pad, x), maxLeft);
            var newTop = Math.min(Math.max(pad, y), maxTop);
            contextMenu.style.left = newLeft + "px";
            contextMenu.style.top = newTop + "px";
        } catch (err) {}
        
        // Close context menu on click outside
        setTimeout(() => {
            const closeContextMenu = (e) => {
                if (contextMenu && !contextMenu.contains(e.target)) {
                    document.body.removeChild(contextMenu);
                    contextMenu = null;
                    document.removeEventListener("click", closeContextMenu);
                }
            };
            document.addEventListener("click", closeContextMenu);
        }, 0);
    }
    
    function showTooltip(e, el) {
        if (tooltip) {
            document.body.removeChild(tooltip);
        }
        
        tooltip = document.createElement("div");
        tooltip.innerText = "Save locator";
        tooltip.style.cssText = `
            position: fixed; left: ${e.pageX + 10}px; top: ${e.pageY + 10}px;
            background: #333; color: #fff; padding: 5px 10px;
            font-family: sans-serif; font-size: 12px;
            border-radius: 3px; pointer-events: none;
            z-index: 999998; white-space: nowrap;
        `;
        
        document.body.appendChild(tooltip);
    }
    
    function hideTooltip() {
        if (tooltip) {
            document.body.removeChild(tooltip);
            tooltip = null;
        }
    }
    
    const HIGHLIGHT_CLASS = 'webio-detected';
    function injectHighlightStyle() {
        if (document.getElementById('webio-highlight-style')) return;
        var style = document.createElement('style');
        style.id = 'webio-highlight-style';
        style.textContent = '.' + HIGHLIGHT_CLASS + ' { outline: 2px solid red !important; box-shadow: 0 0 0 2px red !important; cursor: pointer !important; }'
            + ' .webio-saved-highlight { outline: 2px solid #16a34a !important; box-shadow: 0 0 0 2px #16a34a !important; }'
            + ' [data-webio-panel],[data-locator-popup],[data-export-popup],[data-webio-table-preview]{ font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif !important; color: #000 !important; background-color: #fff !important; box-sizing: border-box !important; -webkit-font-smoothing: antialiased !important; }'
            + ' [data-webio-panel] *,[data-locator-popup] *,[data-export-popup] *,[data-webio-table-preview] *{ box-sizing: border-box !important; }'
            + ' [data-webio-panel] input,[data-webio-panel] button,[data-webio-panel] select,[data-webio-panel] textarea,[data-locator-popup] input,[data-locator-popup] button,[data-locator-popup] select,[data-export-popup] input,[data-export-popup] button,[data-export-popup] textarea,[data-webio-table-preview] input,[data-webio-table-preview] button,[data-webio-table-preview] select{ font-family: inherit !important; color: #000 !important; background-color: #fff !important; border-color: #ccc !important; }';
        (document.head || document.documentElement).appendChild(style);
    }

    function highlightElement(el) {
        if (el && el.nodeType === 1) {
            el.classList.add(HIGHLIGHT_CLASS);
            el.style.cursor = 'pointer';
        }
    }

    function removeHighlight(el) {
        if (el && el.nodeType === 1) {
            el.classList.remove(HIGHLIGHT_CLASS);
            el.style.cursor = '';
        }
    }
    
    function isElementInSelectionRect(el, rect) {
        if (!rect) return true;
        const elRect = el.getBoundingClientRect();
        return !(
            elRect.right < rect.left ||
            elRect.left > rect.right ||
            elRect.bottom < rect.top ||
            elRect.top > rect.bottom
        );
    }
    
    function filterSelectableByArea() {
        filteredSelectable = selectionRect 
            ? selectable.filter(el => isElementInSelectionRect(el, selectionRect))
            : selectable;
        
        // Update highlights
        selectable.forEach(el => {
            removeHighlight(el);
        });
        
        filteredSelectable.forEach(el => {
            highlightElement(el);
        });
    }

    /** Query all elements matching selector from root and from every descendant shadow root. */
    function queryAllIncludingShadowRoots(root, selector) {
        var out = [];
        if (!root || !root.querySelectorAll) return out;
        try {
            var list = root.querySelectorAll(selector);
            for (var i = 0; i < list.length; i++) out.push(list[i]);
            var all = root.querySelectorAll("*");
            for (var k = 0; k < all.length; k++) {
                if (all[k].shadowRoot) {
                    var inner = queryAllIncludingShadowRoots(all[k].shadowRoot, selector);
                    for (var j = 0; j < inner.length; j++) out.push(inner[j]);
                }
            }
        } catch (e) {}
        return out;
    }

    /** Get all inputs that are radio/checkbox inside a label, from root and shadow roots; type checked case-insensitively. */
    function queryLabelRadioCheckboxIncludingShadowRoots(root) {
        var inputs = [];
        function walk(r) {
            if (!r || !r.querySelectorAll) return;
            try {
                var labels = r.querySelectorAll("label");
                for (var i = 0; i < labels.length; i++) {
                    var inps = labels[i].querySelectorAll("input");
                    for (var j = 0; j < inps.length; j++) {
                        var t = (inps[j].getAttribute && inps[j].getAttribute("type")) ? String(inps[j].getAttribute("type")).toLowerCase() : "";
                        if (t === "radio" || t === "checkbox") inputs.push(inps[j]);
                    }
                }
                var all = r.querySelectorAll("*");
                for (var k = 0; k < all.length; k++) {
                    if (all[k].shadowRoot) walk(all[k].shadowRoot);
                }
            } catch (e) {}
        }
        walk(root);
        return inputs;
    }
    
    function initializeSelectable() {
        selectable.forEach(function (el) {
            removeHighlight(el);
        });
        selectable = [];
        // Detect all interactive controls: native + ARIA roles + MUI + PrimeReact + label containing radio/checkbox (listen: click, input, change)
        var selector = [
            'button', 'a', 'input', 'textarea', 'select',
            '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]',
            '[role="combobox"]', '[role="listbox"]', '[role="option"]',
            '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
            '.MuiRadio-root', '.MuiCheckbox-root', '.MuiSwitch-root',
            '[class*="MuiRadio-root"]', '[class*="MuiCheckbox-root"]', '[class*="MuiSwitch-root"]',
            '.p-radiobutton', '.p-checkbox', '.p-inputswitch',
            '[class*="p-radiobutton"]', '[class*="p-checkbox"]', '[class*="radiobutton"]', '[class*="checkbox"]'
        ].join(', ');
        var nodes = queryAllIncludingShadowRoots(document.body, selector);
        var seen = new Set();
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.tagName && node.tagName.toLowerCase() === "input") {
                var typeAttr = (node.getAttribute && node.getAttribute("type")) ? String(node.getAttribute("type")).toLowerCase() : "";
                if (typeAttr === "hidden") continue;
                var inLabel = node.closest && node.closest("label");
                var inRole = node.closest && node.closest("[role=\"radio\"], [role=\"checkbox\"], [role=\"switch\"]");
                if (getMuiControlRoot(node) || inLabel || inRole) continue;
            }
            if (seen.has(node)) continue;
            if (node.closest && node.closest("[data-webio-panel], [data-locator-popup], [data-export-popup], [data-webio-table-preview]")) continue;
            seen.add(node);
            selectable.push(node);
        }
        var labelInputs = queryLabelRadioCheckboxIncludingShadowRoots(document.body);
        for (var j = 0; j < labelInputs.length; j++) {
            var lbl = labelInputs[j].closest && labelInputs[j].closest("label");
            if (lbl && !seen.has(lbl) && !(lbl.closest && lbl.closest("[data-webio-panel], [data-locator-popup], [data-export-popup], [data-webio-table-preview]"))) { seen.add(lbl); selectable.push(lbl); }
        }
        filteredSelectable = selectable;
        selectable.forEach(function (el, index) {
            el.setAttribute("data-locator-id", index);
            if (el.getAttribute("data-webio-bound") === "true") return;
            el.setAttribute("data-webio-bound", "true");
            el.addEventListener("mouseenter", function (e) {
                showTooltip(e, el);
            });
            el.addEventListener("mouseleave", function () {
                hideTooltip();
            });
        });
        filterSelectableByArea();
    }
    
    // Right-click on ANY element to select it (not just suggested list)
    document.addEventListener("contextmenu", (e) => {
        if (e.target.closest("[data-locator-popup], [data-export-popup], [data-webio-panel], [data-webio-contextmenu]") || contextMenu) return;
        var el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
        if (!el || !document.body.contains(el)) return;
        var controlRoot = getControlRoot(el);
        if (controlRoot) el = controlRoot;
        showContextMenu(e, el);
    }, true);
    
    function getScreensForGeneration() {
        var hasRecorded = Object.keys(recordedScreens).length > 0;
        if (hasRecorded) {
            return Object.keys(recordedScreens).map(function (id) {
                var s = recordedScreens[id];
                return {
                    screenId: s.screenId,
                    page: s.page,
                    title: s.title,
                    label: s.label,
                    selectedTable: (s.selectedTable || (collectedScreens[id] && collectedScreens[id].selectedTable) || null),
                    elements: (s.elements || []).map(function (el) {
                        return {
                            logicalName: el.logicalName,
                            objectType: el.objectType,
                            selectorType: el.selectorType,
                            selectorValue: el.selectorValue,
                            value: el.inputValue
                        };
                    })
                };
            });
        }
        return Object.keys(collectedScreens).map(function (id) { return collectedScreens[id]; });
    }

    function getExportDataCurrent() {
        var screens = getScreensForGeneration();
        var screen = screens.find(function (s) { return s.screenId === currentScreenId; });
        if (!screen) screen = getCurrentScreen();
        var jsonData = { page: screen.page, screenId: screen.screenId, elements: screen.elements || [] };
        return { jsonData, jsonString: JSON.stringify(jsonData, null, 2) };
    }
    function getExportDataAll() {
        var screensArray = getScreensForGeneration();
        var jsonData = { screens: screensArray };
        return { jsonData, jsonString: JSON.stringify(jsonData, null, 2) };
    }

    function downloadBlobAsFile(content, filename, mimeType) {
        var blob = new Blob([content], { type: mimeType || "application/octet-stream" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { if (a.parentNode) document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    }

    function escapeHtml(s) {
        if (s == null) return "";
        var div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
    }

    function getFilteredNetworkLog(methodFilter, urlKeyword, statusFilter) {
        var log = (window.__WEBIO__ && window.__WEBIO__.networkLog) ? window.__WEBIO__.networkLog : [];
        return log.filter(function (entry) {
            if (methodFilter && (entry.method || "").toUpperCase() !== (methodFilter || "").toUpperCase()) return false;
            if (urlKeyword && (entry.url || "").indexOf(urlKeyword) === -1) return false;
            if (statusFilter !== "" && statusFilter != null) {
                var status = entry.responseStatus;
                var want = String(statusFilter).trim();
                if (want.slice(-1) === "x" && want.length >= 2) {
                    var prefix = want.slice(0, -1);
                    if (prefix === "2" && Math.floor(status / 100) !== 2) return false;
                    if (prefix === "4" && Math.floor(status / 100) !== 4) return false;
                    if (prefix === "5" && Math.floor(status / 100) !== 5) return false;
                } else if (parseInt(want, 10) !== status) return false;
            }
            return true;
        });
    }

    function apiNameFromEntry(entry) {
        try {
            var u = new URL(entry.url, window.location.origin);
            var path = u.pathname || "";
            var last = path.split("/").filter(Boolean).pop();
            if (last) return last.replace(/[^\w-]/g, "_").slice(0, 40) || "api";
        } catch (e) {}
        return "api";
    }

    function formatFeatureValue(val) {
        if (val === null || val === undefined) return '""';
        if (typeof val === "string") return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        if (typeof val === "number") return String(val);
        if (typeof val === "boolean") return val ? "true" : "false";
        if (Array.isArray(val)) return JSON.stringify(val);
        if (typeof val === "object") return JSON.stringify(val);
        return '"' + String(val) + '"';
    }

    function flattenToPathValueTable(obj, prefix, rows) {
        prefix = prefix || "";
        rows = rows || [];
        if (obj === null || obj === undefined) return rows;
        if (typeof obj !== "object" || Array.isArray(obj)) {
            rows.push({ path: prefix.replace(/^\./, ""), value: formatFeatureValue(obj) });
            return rows;
        }
        Object.keys(obj).forEach(function (key) {
            var path = prefix ? prefix + "." + key : key;
            var v = obj[key];
            if (v !== null && typeof v === "object" && !Array.isArray(v)) {
                flattenToPathValueTable(v, path, rows);
            } else {
                rows.push({ path: path, value: formatFeatureValue(v) });
            }
        });
        return rows;
    }

    function buildApiFeatureContent(entries) {
        var lines = ["Feature: API tests", ""];
        entries.forEach(function (entry) {
            var name = apiNameFromEntry(entry);
            var url = (entry.url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            var method = (entry.method || "GET").toUpperCase();
            if (["GET", "POST", "PUT", "DELETE"].indexOf(method) === -1) method = "GET";
            var status = entry.responseStatus != null ? entry.responseStatus : 0;
            var bodyObj = null;
            if (entry.requestBody != null && entry.requestBody !== "") {
                if (typeof entry.requestBody === "object") bodyObj = entry.requestBody;
                else {
                    try { bodyObj = JSON.parse(entry.requestBody); } catch (e) { bodyObj = null; }
                }
            }
            lines.push("  @api");
            lines.push("  Scenario: Verify " + name);
            if (bodyObj && typeof bodyObj === "object" && !Array.isArray(bodyObj) && Object.keys(bodyObj).length > 0) {
                var tableRows = flattenToPathValueTable(bodyObj);
                lines.push('    Given User sends ' + method + ' request to "' + url + '" with body:');
                lines.push("      | path                          | value          |");
                tableRows.forEach(function (r) {
                    var pathStr = String(r.path || "");
                    var valueStr = String(r.value || "");
                    lines.push("      | " + pathStr + " | " + valueStr + " |");
                });
            } else {
                lines.push('    Given User sends ' + method + ' request to "' + url + '"');
            }
            lines.push("    Then User expects status code " + status);
            lines.push("");
        });
        return lines.join("\n").replace(/\n+$/, "\n");
    }

    function requestBodyToTableRows(requestBody) {
        if (requestBody == null) return [];
        var obj = requestBody;
        if (typeof requestBody === "string") {
            var s = (requestBody || "").trim();
            if (!s) return [];
            try { obj = JSON.parse(s); } catch (e) { return []; }
        }
        if (typeof obj !== "object" || obj === null) return [];
        var rows = [];
        Object.keys(obj).forEach(function (path) {
            var v = obj[path];
            var valueCell;
            if (typeof v === "string") valueCell = '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
            else if (typeof v === "number") valueCell = String(v);
            else if (typeof v === "boolean") valueCell = v ? "true" : "false";
            else if (v !== null && typeof v === "object") valueCell = '"' + JSON.stringify(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
            else valueCell = '""';
            rows.push({ path: path, value: valueCell });
        });
        return rows;
    }

    function buildWebuiApiFeatureContent(steps, useTableFormat) {
        function esc(s) { return (s == null ? "" : String(s)).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
        function pathFromUrl(url) {
            if (!url) return "";
            try { var u = new URL(url, window.location.origin); return u.pathname || url; } catch (e) { return url; }
        }
        if (useTableFormat) {
            var lines = ["# Web UI + API — True E2E (table validation)", "Feature: Web UI + API Integration", ""];
            lines.push("  @webui-api @smoke");
            lines.push("  Scenario: E2E flow with UI actions and API validations");
            steps.forEach(function (step) {
                var stepName = esc(step.name || "Step");
                lines.push('    Given user performs "' + stepName + '"');
                lines.push('    When APIs triggered for "' + stepName + '" are captured');
                var selectedApis = (step.apiEntries || []).filter(function (e) { return e.selected !== false; });
                lines.push("    Then validate the following APIs:");
                lines.push("      | Method | URL | Status |");
                if (selectedApis.length > 0) {
                    selectedApis.forEach(function (e) {
                        var method = (e.method || "GET").toUpperCase();
                        var url = pathFromUrl(e.url) || e.url || "";
                        if (url.length > 60) url = url.slice(0, 57) + "...";
                        lines.push("      | " + method + " | " + url + " | " + (e.responseStatus != null ? e.responseStatus : 200) + " |");
                    });
                } else {
                    lines.push("      | GET | (no APIs captured) | 200 |");
                }
                lines.push("");
            });
            return lines.join("\n").replace(/\n+$/, "\n");
        }
        var lines = ["# Web UI + API — combined UI + API (same Gherkin as Screen.feature + api-tests)", "Feature: Web UI + API Integration", ""];
        lines.push("  @webui-api @smoke");
        lines.push("  Scenario: E2E flow with UI actions and API validations");
        var isFirstStep = true;
        steps.forEach(function (step) {
            var selectedApis = (step.apiEntries || []).filter(function (e) { return e.selected !== false; });
            var selectedUi = (step.uiActions || []).filter(function (a) { return a.selected !== false; });
            var hasTimestamps = selectedUi.some(function (a) { return a.timestamp; }) && selectedApis.some(function (e) { return e.timestamp; });
            var safeStepName = String(step.name || "Step").replace(/[\\\/:\*\?"<>\|]/g, "_").replace(/\s+/g, " ").trim().replace(/[\. ]+$/g, "") || "Step";
            var screenRef = "generated/" + safeStepName;

            function emitGroupedUiForSegment(uiSegment) {
                var textboxByKey = {};
                var textboxOrder = [];
                var buttonByKey = {};
                var buttonOrder = [];
                var linkByKey = {};
                var linkOrder = [];
                var checkboxByKey = {};
                var checkboxOrder = [];
                var radioByKey = {};
                var radioOrder = [];
                var dropdownByKey = {};
                var dropdownOrder = [];
                uiSegment.forEach(function (a) {
                    var logicalName = (a.logicalName || "Element").trim();
                    var key = logicalName + "|" + (a.selectorValue || "");
                    var objType = (a.objectType || "").toLowerCase();
                    var val = (a.inputValue != null && String(a.inputValue).trim() !== "") ? String(a.inputValue).trim() : "";
                    if (objType === "textbox") {
                        if (!textboxByKey[key]) textboxOrder.push(key);
                        textboxByKey[key] = { logicalName: logicalName, value: val };
                    } else if (objType === "button") {
                        if (!buttonByKey[key]) buttonOrder.push(key);
                        buttonByKey[key] = logicalName;
                    } else if (objType === "link") {
                        if (!linkByKey[key]) linkOrder.push(key);
                        linkByKey[key] = logicalName;
                    } else if (objType === "checkbox") {
                        if (!checkboxByKey[key]) checkboxOrder.push(key);
                        checkboxByKey[key] = logicalName;
                    } else if (objType === "radio") {
                        if (!radioByKey[key]) radioOrder.push(key);
                        radioByKey[key] = logicalName;
                    } else if (objType === "dropdown") {
                        if (!dropdownByKey[key]) dropdownOrder.push(key);
                        dropdownByKey[key] = { logicalName: logicalName, value: val };
                    } else {
                        if (!buttonByKey[key]) buttonOrder.push(key);
                        buttonByKey[key] = logicalName;
                    }
                });
                textboxOrder.forEach(function (k) {
                    var o = textboxByKey[k];
                    var val = (o.value && o.value.trim() !== "") ? esc(o.value.trim()) : "12345";
                    lines.push('    And enters "' + val + '" text in "' + esc(o.logicalName) + '" textbox');
                });
                buttonOrder.forEach(function (k) {
                    lines.push('    When clicks on "' + esc(buttonByKey[k]) + '" button');
                });
                linkOrder.forEach(function (k) {
                    lines.push('    When clicks on "' + esc(linkByKey[k]) + '" link');
                });
                checkboxOrder.forEach(function (k) {
                    lines.push('    And select "' + esc(checkboxByKey[k]) + '" Checkbox');
                });
                radioOrder.forEach(function (k) {
                    lines.push('    When clicks on "' + esc(radioByKey[k]) + '" Radio button');
                });
                dropdownOrder.forEach(function (k) {
                    var o = dropdownByKey[k];
                    lines.push('    When selects "' + esc(o.value || "option1") + '" from "' + esc(o.logicalName) + '" Drop-down list');
                });
            }

            if (hasTimestamps) {
                var events = [];
                selectedUi.forEach(function (a) { events.push({ type: "ui", timestamp: a.timestamp || "", payload: a }); });
                selectedApis.forEach(function (e) { events.push({ type: "api", timestamp: e.timestamp || "", payload: e }); });
                events.sort(function (x, y) { return String(x.timestamp).localeCompare(String(y.timestamp)); });
                var idx = 0;
                while (idx < events.length) {
                    if (events[idx].type === "ui") {
                        var uiSegment = [];
                        while (idx < events.length && events[idx].type === "ui") {
                            uiSegment.push(events[idx].payload);
                            idx++;
                        }
                        if (uiSegment.length > 0) {
                            if (isFirstStep) {
                                if (step.page) lines.push('    Given User navigates to "' + esc(step.page) + '" URL');
                                lines.push('    And User is on "' + esc(screenRef) + '" screen');
                                isFirstStep = false;
                            }
                            emitGroupedUiForSegment(uiSegment);
                        }
                    } else {
                        if (isFirstStep) {
                            if (step.page) lines.push('    Given User navigates to "' + esc(step.page) + '" URL');
                            lines.push('    And User is on "' + esc(screenRef) + '" screen');
                            isFirstStep = false;
                        }
                        var e = events[idx].payload;
                        var method = (e.method || "GET").toUpperCase();
                        var url = (e.url || "").trim() || "http://localhost/";
                        var status = e.responseStatus != null ? e.responseStatus : 200;
                        var methodWithBody = ["POST", "PUT", "PATCH"];
                        var hasBody = methodWithBody.indexOf(method) >= 0 && e.requestBody != null;
                        var bodyRows = hasBody ? requestBodyToTableRows(e.requestBody) : [];
                        if (bodyRows.length > 0) {
                            lines.push('    Given User sends ' + method + ' request to "' + esc(url) + '" with body:');
                            lines.push("      | path  | value |");
                            bodyRows.forEach(function (r) { lines.push("      | " + r.path + " | " + r.value + " |"); });
                        } else {
                            lines.push('    Given User sends ' + method + ' request to "' + esc(url) + '"');
                        }
                        lines.push("    Then User expects status code " + status);
                        lines.push("");
                        idx++;
                    }
                }
            } else {
                if (isFirstStep) {
                    if (step.page) lines.push('    Given User navigates to "' + esc(step.page) + '" URL');
                    lines.push('    And User is on "' + esc(screenRef) + '" screen');
                    isFirstStep = false;
                } else {
                    lines.push('    And User is on "' + esc(screenRef) + '" screen');
                }
                if (selectedUi.length > 0) emitGroupedUiForSegment(selectedUi);
                var methodWithBody = ["POST", "PUT", "PATCH"];
                selectedApis.forEach(function (e) {
                    var method = (e.method || "GET").toUpperCase();
                    var url = (e.url || "").trim() || "http://localhost/";
                    var status = e.responseStatus != null ? e.responseStatus : 200;
                    var hasBody = methodWithBody.indexOf(method) >= 0 && e.requestBody != null;
                    var bodyRows = hasBody ? requestBodyToTableRows(e.requestBody) : [];
                    if (bodyRows.length > 0) {
                        lines.push('    Given User sends ' + method + ' request to "' + esc(url) + '" with body:');
                        lines.push("      | path  | value |");
                        bodyRows.forEach(function (r) { lines.push("      | " + r.path + " | " + r.value + " |"); });
                    } else {
                        lines.push('    Given User sends ' + method + ' request to "' + esc(url) + '"');
                    }
                    lines.push("    Then User expects status code " + status);
                    lines.push("");
                });
            }
        });
        return lines.join("\n").replace(/\n+$/, "\n");
    }

    function showApiFeatureEditPopup(initialContent, title, downloadPrefix) {
        title = title || "API Feature — Edit then Save";
        downloadPrefix = downloadPrefix || "api-tests";
        var existing = document.querySelector("[data-webio-api-feature-popup]");
        if (existing) document.body.removeChild(existing);
        var popup = document.createElement("div");
        popup.setAttribute("data-webio-api-feature-popup", "true");
        popup.setAttribute("data-export-popup", "true");
        popup.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#000;border:1px solid #ccc;padding:20px;font-family:sans-serif;box-shadow:2px 2px 20px rgba(0,0,0,0.5);z-index:999999;max-width:700px;width:90vw;height:85vh;max-height:85vh;overflow:hidden;color-scheme:light;display:flex;flex-direction:column;box-sizing:border-box;";
        popup.innerHTML = "<style>[data-webio-api-feature-popup] textarea,[data-webio-api-feature-popup] h3{color:#000!important;background:#fff!important}[data-webio-api-feature-popup] button{color:#000!important;background:#f5f5f5!important;border:1px solid #ccc!important}</style>"
            + "<div class=\"webio-api-feature-drag-handle\" style=\"cursor:move;user-select:none;margin:-20px -20px 12px -20px;padding:12px 20px;border-bottom:1px solid #eee;flex-shrink:0;\"><h3 style=\"margin:0;\">" + escapeHtml(title) + "</h3></div>"
            + "<div style=\"flex:1;min-height:0;display:flex;flex-direction:column;margin-top:8px;\">"
            + "<textarea id=\"webioApiFeatureContent\" style=\"flex:1;min-height:0;width:100%;font-family:monospace;font-size:12px;padding:10px;box-sizing:border-box;border:1px solid #ccc;overflow-y:auto;resize:none;display:block;\"></textarea>"
            + "</div>"
            + "<div style=\"margin-top:12px;text-align:right;flex-shrink:0;\">"
            + "<button id=\"webioApiFeatureCopy\" style=\"padding:8px 15px;margin-right:8px;cursor:pointer;\">Copy</button>"
            + "<button id=\"webioApiFeatureDownload\" style=\"padding:8px 15px;margin-right:8px;cursor:pointer;\">Download .feature</button>"
            + "<button id=\"webioApiFeatureClose\" style=\"padding:8px 15px;cursor:pointer;\">Close</button>"
            + "</div>";
        document.body.appendChild(popup);
        var ta = popup.querySelector("#webioApiFeatureContent");
        ta.value = initialContent;
        popup.querySelector("#webioApiFeatureCopy").onclick = function () {
            ta.select();
            document.execCommand("copy");
            alert("Copied to clipboard.");
        };
        popup.querySelector("#webioApiFeatureDownload").onclick = function () {
            var content = ta.value;
            var blob = new Blob([content], { type: "text/plain" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = downloadPrefix + "-" + Date.now() + ".feature";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        popup.querySelector("#webioApiFeatureClose").onclick = function () {
            document.body.removeChild(popup);
        };
        if (typeof makePopupDraggable === "function") makePopupDraggable(popup, ".webio-api-feature-drag-handle");
    }

    function updateListUI() {
        if (panelMinimized) return;
        var useRecorded = Object.keys(recordedScreens).length > 0;
        var screensSource = useRecorded ? recordedScreens : collectedScreens;
        var screenIds = Object.keys(screensSource);
        var allScreensHtml = screenIds.length ? screenIds.map(function (id) {
            var screen = screensSource[id];
            var count = (screen.elements && screen.elements.length) || 0;
            var isCurrent = id === currentScreenId;
            return "<div class=\"screen-row\" data-screen-id=\"" + escapeHtml(id) + "\" style=\"margin:4px 0;padding:6px 8px;background:" + (isCurrent ? "#e0f0ff" : "#f0f0f0") + ";border-radius:4px;font-size:12px;cursor:pointer;\"><b>" + (isCurrent ? "[Current] " : "") + escapeHtml(id) + "</b> (" + count + " elements) — click to select</div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">No screens yet. Assign a Screen ID above and capture elements.</div>";
        var currentScreenData = useRecorded && recordedScreens[currentScreenId] ? recordedScreens[currentScreenId] : getCurrentScreen();
        var currentElements = currentScreenData.elements || [];
        var savedElementsHtml = currentElements.length ? currentElements.map(function (el, idx) {
            var logical = el.logicalName || el.text || ("Element " + (idx + 1));
            var name = logical.slice(0, 25);
            return ""
                + "<div class=\"saved-element-row\" data-element-idx=\"" + idx + "\""
                + " style=\"margin:4px 0;padding:6px 8px;background:#fff;border:1px solid #ddd;border-radius:4px;"
                + "font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;\">"
                +   "<span title=\"" + escapeHtml(logical) + "\" style=\"flex:1;min-width:0;\">"
                +     escapeHtml(name)
                +     (useRecorded ? " <i style=\\\"color:#666;font-size:10px;\\\">(recorded)</i>" : "")
                +   "</span>"
                +   "<div style=\"flex-shrink:0;display:flex;gap:4px;\">"
                +     "<button type=\"button\" class=\"editElementBtn\" data-idx=\"" + idx + "\""
                +       " style=\"padding:2px 6px;font-size:11px;border:1px solid #2563eb;border-radius:4px;"
                +       "background:#2563eb;color:#fff;cursor:pointer;\">Edit</button>"
                +     "<button type=\"button\" class=\"deleteElementBtn\" data-idx=\"" + idx + "\""
                +       " style=\"padding:2px 6px;font-size:11px;border:1px solid #dc2626;border-radius:4px;"
                +       "background:#fff;color:#dc2626;cursor:pointer;\">Delete</button>"
                +   "</div>"
                + "</div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">" + (useRecorded ? "No recorded elements for this screen. Interact with page elements while recording." : "No saved elements for this screen. Right‑click page elements to add.") + "</div>";
        var prevInput = listUI.querySelector("#screenIdInput");
        var pathInput = listUI.querySelector("#parentPathInput");
        var screenIdHadFocus = prevInput && document.activeElement === prevInput;
        var pathHadFocus = pathInput && document.activeElement === pathInput;
        var preservedScreenIdValue = prevInput ? prevInput.value : null;
        var preservedPathValue = pathHadFocus && pathInput ? pathInput.value : null;
        var apiMethodEl = listUI.querySelector("#apiMethodFilter");
        var apiUrlEl = listUI.querySelector("#apiUrlKeyword");
        var apiStatusEl = listUI.querySelector("#apiStatusFilter");
        if (apiMethodEl) apiMethodFilter = apiMethodEl.value || "";
        if (apiUrlEl) apiUrlKeyword = (apiUrlEl.value || "").trim();
        if (apiStatusEl) apiStatusFilter = (apiStatusEl.value || "").trim();
        listUI.querySelectorAll(".webio-api-checkbox").forEach(function (cb) {
            var id = cb.getAttribute("data-api-id");
            if (id) selectedApiIds[id] = cb.checked;
        });
        if (webioActiveTab === "webui-api") {
            listUI.querySelectorAll(".webui-api-step-api-cb").forEach(function (cb) {
                var si = parseInt(cb.getAttribute("data-step-index"), 10);
                var ai = parseInt(cb.getAttribute("data-api-index"), 10);
                if (!isNaN(si) && !isNaN(ai) && webuiApiSteps[si] && webuiApiSteps[si].apiEntries && webuiApiSteps[si].apiEntries[ai]) {
                    webuiApiSteps[si].apiEntries[ai].selected = cb.checked;
                }
            });
            listUI.querySelectorAll(".webui-api-step-ui-cb").forEach(function (cb) {
                var si = parseInt(cb.getAttribute("data-step-index"), 10);
                var ui = parseInt(cb.getAttribute("data-ui-index"), 10);
                if (!isNaN(si) && !isNaN(ui) && webuiApiSteps[si] && webuiApiSteps[si].uiActions && webuiApiSteps[si].uiActions[ui]) {
                    webuiApiSteps[si].uiActions[ui].selected = cb.checked;
                }
            });
        }
        var apiListEl = listUI.querySelector("#apiListContainer");
        var savedApiListScrollTop = apiListEl ? apiListEl.scrollTop : 0;
        var parentPathForTemplate = preservedPathValue !== null ? preservedPathValue : persistedParentPath;
        var rawPath = (parentPathForTemplate || "").trim() || "generated";
        var exportPathSegment = rawPath === "generated" ? "generated" : ("generated/" + rawPath);

        var filteredApiLog = getFilteredNetworkLog(apiMethodFilter, apiUrlKeyword, apiStatusFilter);
        var apiListHtml = filteredApiLog.length ? filteredApiLog.map(function (entry) {
            var shortUrl = (entry.url || "").length > 45 ? (entry.url || "").slice(0, 42) + "..." : (entry.url || "");
            var status = entry.responseStatus != null ? entry.responseStatus : "-";
            var checked = selectedApiIds[entry.id] ? " checked" : "";
            return "<div style=\"margin:4px 0;padding:6px 8px;background:#fff;border:1px solid #ddd;border-radius:4px;font-size:11px;display:flex;align-items:center;gap:8px;\">"
                + "<input type=\"checkbox\" class=\"webio-api-checkbox\" data-api-id=\"" + escapeHtml(entry.id) + "\"" + checked + " style=\"flex-shrink:0;\"/>"
                + "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;\" title=\"" + escapeHtml(entry.url || "") + "\">"
                + "<b>" + escapeHtml(entry.method || "GET") + "</b> " + escapeHtml(shortUrl) + " <span style=\"color:#666;\">" + escapeHtml(String(status)) + "</span></span></div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">No API calls captured yet. Use the app to trigger XHR/Fetch requests.</div>";

        var webuiApiStepsListHtml = "";
        if (webioActiveTab === "webui-api") {
            var webuiApiStepNamePreserved = listUI.querySelector("#webuiApiStepNameInput");
            if (webuiApiStepNamePreserved && webuiApiStepNamePreserved.value) webuiApiStepCaptureName = webuiApiStepNamePreserved.value.trim();
            var webuiApiTableFormatCb = listUI.querySelector("#webuiApiUseTableFormat");
            if (webuiApiTableFormatCb) webuiApiUseTableFormat = webuiApiTableFormatCb.checked;
            if (webuiApiSteps.length === 0) {
                webuiApiStepsListHtml = "<div style=\"font-size:12px;color:#666;\">Add a step: enter a name, click <b>Start step</b>, perform the UI action in the app, then click <b>End step &amp; capture UI + APIs</b>. UI actions + APIs triggered in between will be grouped under that step.</div>";
            } else {
                webuiApiStepsListHtml = webuiApiSteps.map(function (step, stepIdx) {
                    var uiHtml = (step.uiActions && step.uiActions.length)
                        ? step.uiActions.map(function (a, uiIdx) {
                            var checked = a.selected !== false ? " checked" : "";
                            var label = (a.actionType || "click").toUpperCase() + " " + (a.logicalName || "Element");
                            if ((a.objectType || "").toLowerCase() === "textbox" && a.inputValue) {
                                label += " = " + String(a.inputValue).slice(0, 50);
                            }
                            return "<div style=\"margin:2px 0;padding:4px 8px;background:#fdf2f8;border-radius:4px;font-size:11px;display:flex;align-items:center;gap:6px;\">"
                                + "<input type=\"checkbox\" class=\"webui-api-step-ui-cb\" data-step-index=\"" + stepIdx + "\" data-ui-index=\"" + uiIdx + "\"" + checked + " style=\"flex-shrink:0;\"/>"
                                + "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;\" title=\"" + escapeHtml(label) + "\">"
                                + escapeHtml(label)
                                + "</span></div>";
                        }).join("")
                        : "<div style=\"font-size:11px;color:#888;\">No UI actions recorded for this step. Turn on <b>Start Recording</b> in Web UI tab, then perform the UI action.</div>";
                    var apisHtml = (step.apiEntries && step.apiEntries.length)
                        ? step.apiEntries.map(function (entry, apiIdx) {
                            var shortUrl = (entry.url || "").length > 40 ? (entry.url || "").slice(0, 37) + "..." : (entry.url || "");
                            var status = entry.responseStatus != null ? entry.responseStatus : "-";
                            var checked = entry.selected !== false ? " checked" : "";
                            return "<div style=\"margin:2px 0;padding:4px 8px;background:#f8fafc;border-radius:4px;font-size:11px;display:flex;align-items:center;gap:6px;\">"
                                + "<input type=\"checkbox\" class=\"webui-api-step-api-cb\" data-step-index=\"" + stepIdx + "\" data-api-index=\"" + apiIdx + "\"" + checked + " style=\"flex-shrink:0;\"/>"
                                + "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;\" title=\"" + escapeHtml(entry.url || "") + "\">"
                                + "<b>" + escapeHtml((entry.method || "GET").toUpperCase()) + "</b> " + escapeHtml(shortUrl) + " <span style=\"color:#666;\">" + escapeHtml(String(status)) + "</span></span></div>";
                        }).join("")
                        : "<div style=\"font-size:11px;color:#888;\">No APIs captured for this step.</div>";
                    var screenLabel = step.screenId ? " Screen: " + escapeHtml(step.screenId) : "";
                    var elLabel = step.elementSummary ? " · " + escapeHtml(step.elementSummary) : "";
                    return "<div class=\"webui-api-step-card\" data-step-index=\"" + stepIdx + "\" style=\"margin-bottom:12px;padding:10px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;\">"
                        + "<div style=\"font-weight:600;font-size:12px;color:#000;margin-bottom:4px;\">Step: " + escapeHtml(step.name) + "</div>"
                        + "<div style=\"font-size:11px;color:#555;margin-bottom:8px;\">" + screenLabel + elLabel + "</div>"
                        + "<div style=\"font-size:11px;color:#000;margin-bottom:4px;\">UI actions (check to include in feature):</div>"
                        + "<div style=\"max-height:120px;overflow-y:auto;margin-bottom:10px;\">" + uiHtml + "</div>"
                        + "<div style=\"font-size:11px;color:#000;margin-bottom:4px;\">APIs (check to include in feature):</div>"
                        + "<div style=\"max-height:120px;overflow-y:auto;\">" + apisHtml + "</div>"
                        + "<button type=\"button\" class=\"webui-api-step-remove\" data-step-index=\"" + stepIdx + "\" style=\"margin-top:8px;padding:4px 10px;font-size:11px;border:1px solid #dc2626;border-radius:4px;background:#fff;color:#dc2626;cursor:pointer;\">Remove step</button>"
                        + "</div>";
                }).join("");
            }
        }

        // Preserve scroll position of the active tab so re-renders don't jump back to top
        var scrollEl = listUI.querySelector("#webio-tab-webui .webio-scroll") || listUI.querySelector("#webio-tab-api .webio-scroll") || listUI.querySelector("#webio-tab-webui-api .webio-scroll") || listUI.querySelector(".webio-scroll");
        var savedScrollTop = scrollEl ? scrollEl.scrollTop : 0;

        listUI.innerHTML = `<style>[data-webio-panel] input,[data-webio-panel] select,[data-webio-panel] textarea{color:#000!important;background-color:#fff!important;border-color:#ccc!important}[data-webio-panel] button:not(#setScreenIdBtn):not(#recordingToggleBtn):not(#generateJsonBtn):not(#generateFeatureBtn):not(#generateApiFeatureBtn):not(#webioHideBtn):not(.webio-tab){color:#000!important;background-color:#fff!important;border-color:#ccc!important}</style>
            <div class="webio-header webio-drag-handle" style="flex-shrink:0;padding:12px;background:#fff;color:#000;border-bottom:1px solid #e0e0e0;cursor:move;user-select:none;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;text-transform:uppercase;">Assign Screen ID</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                        <input id="screenIdInput" type="text" value="${escapeHtml(screenIdHadFocus && preservedScreenIdValue !== null ? preservedScreenIdValue : currentScreenId)}" placeholder="e.g. Login, Dashboard" autocomplete="off" style="flex:1;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;"/>
                        <button id="setScreenIdBtn" type="button" style="flex-shrink:0;padding:10px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">Set</button>
                    </div>
                    <div style="font-size:11px;color:#000;">Current: <strong id="currentScreenIdLabel">${escapeHtml(currentScreenId)}</strong></div>
                </div>
                <button id="webioHideBtn" type="button" title="Hide panel (click bubble to show again)" style="flex-shrink:0;width:28px;height:28px;padding:0;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;color:#333;cursor:pointer;font-size:16px;line-height:1;">−</button>
            </div>
            <div class="webio-tabs" style="flex-shrink:0;display:flex;border-bottom:1px solid #e0e0e0;background:#f5f5f5;">
                <button type="button" id="webioTabWebui" class="webio-tab" data-tab="webui" style="flex:1;padding:10px 12px;border:none;border-bottom:3px solid ${webioActiveTab === "webui" ? "#2563eb" : "transparent"};background:${webioActiveTab === "webui" ? "#fff" : "transparent"};font-weight:600;font-size:12px;cursor:pointer;color:#000;">Web UI</button>
                <button type="button" id="webioTabApi" class="webio-tab" data-tab="api" style="flex:1;padding:10px 12px;border:none;border-bottom:3px solid ${webioActiveTab === "api" ? "#2563eb" : "transparent"};background:${webioActiveTab === "api" ? "#fff" : "transparent"};font-weight:600;font-size:12px;cursor:pointer;color:#000;">API</button>
                <button type="button" id="webioTabWebuiApi" class="webio-tab" data-tab="webui-api" style="flex:1;padding:10px 12px;border:none;border-bottom:3px solid ${webioActiveTab === "webui-api" ? "#2563eb" : "transparent"};background:${webioActiveTab === "webui-api" ? "#fff" : "transparent"};font-weight:600;font-size:12px;cursor:pointer;color:#000;">Web UI + API</button>
            </div>
            <div id="webio-tab-webui" class="webio-tab-pane" style="display:${webioActiveTab === "webui" ? "flex" : "none"};flex:1;flex-direction:column;min-height:0;">
                <div class="webio-scroll" style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px;-webkit-overflow-scrolling:touch;">
                    <div style="margin-bottom:12px;">
                        <button id="recordingToggleBtn" type="button" style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:${isRecording ? "#dc2626" : "#16a34a"};color:#fff;">
                            ${isRecording ? "Stop Recording" : "Start Recording"}
                        </button>
                    </div>
                    <div style="margin-bottom:12px;">
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Page elements</div>
                        <button id="areaSelectBtn" type="button" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">
                            ${areaSelectionMode ? "Disable" : "Enable"} area selection
                        </button>
                    </div>
                    <div style="margin-bottom:12px;padding:12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;">
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Buttons</div>
                        <button id="generateJsonBtn" type="button" style="display:block;width:100%;margin-bottom:6px;padding:10px 12px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Generate JSON</button>
                        <button id="generateFeatureBtn" type="button" style="display:block;width:100%;margin-bottom:10px;padding:10px 12px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Generate Feature File</button>
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Parent path</div>
                        <input id="parentPathInput" type="text" value="${escapeHtml(parentPathForTemplate)}" placeholder="e.g. login, dashboard" style="width:100%;padding:8px;box-sizing:border-box;margin-bottom:8px;border:1px solid #ccc;border-radius:6px;"/>
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Display export location path</div>
                        <div id="exportLocationDisplay" style="font-size:10px;color:#555;word-break:break-all;margin-bottom:0;padding:6px;background:#f5f5f5;border-radius:4px;">pages/${escapeHtml(exportPathSegment)}/<br>features/${escapeHtml(exportPathSegment)}/</div>
                    </div>
                    <div style="margin-bottom:8px;font-size:11px;color:#000;font-weight:600;">All screens (click to select)</div>
                    <div id="allScreensList" style="max-height:100px;overflow-y:auto;margin-bottom:12px;font-size:12px;">${allScreensHtml}</div>
                    <div style="margin-bottom:8px;font-size:11px;color:#000;font-weight:600;">Saved elements — Edit / Delete</div>
                    <div id="savedElementsList" style="max-height:160px;overflow-y:auto;margin-bottom:12px;font-size:12px;">${savedElementsHtml}</div>
                    <div id="elementListWrap" style="margin-bottom:8px;">
                        <div id="elementListHeader" style="font-size:11px;color:#000;font-weight:600;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;"><span id="elementListChevron">▶</span> Click to add to current screen</div>
                        <div id="elementList" style="display:none;max-height:200px;overflow-y:auto;margin-top:6px;"></div>
                    </div>
                </div>
            </div>
            <div id="webio-tab-api" class="webio-tab-pane" style="display:${webioActiveTab === "api" ? "flex" : "none"};flex:1;flex-direction:column;min-height:0;">
                <div class="webio-scroll webio-api-scroll" style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px;-webkit-overflow-scrolling:touch;">
                    <div style="margin-bottom:12px;padding:12px;background:#f8fafc;border:1px solid #e0e0e0;border-radius:8px;">
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">API / Network — select requests to generate tests</div>
                        <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                            <select id="apiMethodFilter" style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;min-width:70px;">
                                <option value="">All</option>
                                <option value="GET"${apiMethodFilter === "GET" ? " selected" : ""}>GET</option>
                                <option value="POST"${apiMethodFilter === "POST" ? " selected" : ""}>POST</option>
                                <option value="PUT"${apiMethodFilter === "PUT" ? " selected" : ""}>PUT</option>
                                <option value="DELETE"${apiMethodFilter === "DELETE" ? " selected" : ""}>DELETE</option>
                                <option value="PATCH"${apiMethodFilter === "PATCH" ? " selected" : ""}>PATCH</option>
                            </select>
                            <input id="apiUrlKeyword" type="text" value="${escapeHtml(apiUrlKeyword)}" placeholder="URL contains" style="flex:1;min-width:80px;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;box-sizing:border-box;"/>
                            <input id="apiStatusFilter" type="text" value="${escapeHtml(apiStatusFilter)}" placeholder="Status (e.g. 200, 2xx)" style="width:70px;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;box-sizing:border-box;"/>
                        </div>
                        <div id="apiListContainer" style="height:220px;min-height:180px;overflow-y:auto;overflow-x:hidden;margin-bottom:8px;font-size:12px;-webkit-overflow-scrolling:touch;">${apiListHtml}</div>
                        <button id="generateApiFeatureBtn" type="button" style="width:100%;padding:8px 12px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Generate API Feature (selected only)</button>
                    </div>
                </div>
            </div>
            <div id="webio-tab-webui-api" class="webio-tab-pane" style="display:${webioActiveTab === "webui-api" ? "flex" : "none"};flex:1;flex-direction:column;min-height:0;">
                <div class="webio-scroll webio-webui-api-scroll" style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px;-webkit-overflow-scrolling:touch;">
                    <div style="margin-bottom:12px;padding:12px;background:#f0f9ff;border:1px solid #0ea5e9;border-radius:8px;">
                        <div style="font-size:12px;font-weight:600;color:#000;margin-bottom:8px;">Web UI + API — True E2E integration</div>
                        <div style="font-size:11px;color:#333;line-height:1.5;">
                            <p style="margin:0 0 8px 0;">This tab combines <strong>UI actions</strong> and <strong>API validations</strong> in one flow.</p>
                            <ul style="margin:0 0 8px 0;padding-left:18px;">
                                <li>Enter a step name, click <b>Start step</b>, perform the UI action in the app, then click <b>End step &amp; capture UI + APIs</b>.</li>
                                <li>APIs triggered in between are grouped under that step. Select which APIs to include in the generated feature.</li>
                                <li>Click <b>Generate Web UI + API Feature</b> to create the Gherkin feature file.</li>
                            </ul>
                        </div>
                    </div>
                    <div style="margin-bottom:12px;padding:10px;background:#fff;border:1px solid #e0e0e0;border-radius:6px;">
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Add step</div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <input id="webuiApiStepNameInput" type="text" placeholder="e.g. Login, Dashboard" value="${escapeHtml(webuiApiStepCaptureName)}" style="flex:1;min-width:120px;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:12px;box-sizing:border-box;"/>
                            <button id="webuiApiStartStepBtn" type="button" style="padding:8px 14px;border:1px solid #16a34a;border-radius:6px;background:#16a34a;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Start step</button>
                            <button id="webuiApiEndStepBtn" type="button" style="padding:8px 14px;border:1px solid #0ea5e9;border-radius:6px;background:#0ea5e9;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">End step &amp; capture UI + APIs</button>
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">UI steps with captured APIs</div>
                        <div id="webuiApiStepsList" style="min-height:80px;padding:10px;background:#fff;border:1px solid #e0e0e0;border-radius:6px;font-size:12px;color:#666;">${webuiApiStepsListHtml}</div>
                    </div>
                    <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" id="webuiApiUseTableFormat" ${webuiApiUseTableFormat ? " checked" : ""} style="flex-shrink:0;"/>
                        <label for="webuiApiUseTableFormat" style="font-size:12px;color:#000;">Use table validation format (Given/When/Then with Method | URL | Status table)</label>
                    </div>
                    <button id="generateWebuiApiFeatureBtn" type="button" style="width:100%;padding:10px 12px;border:1px solid #0ea5e9;border-radius:6px;background:#0ea5e9;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Generate Web UI + API Feature</button>
                </div>
            </div>
            <div class="webio-resize-handle" style="height:6px;cursor:ns-resize;background:#e0e0e0;flex-shrink:0;" title="Drag to resize height"></div>
        `;

        var newScrollEl = webioActiveTab === "webui"
            ? listUI.querySelector("#webio-tab-webui .webio-scroll")
            : webioActiveTab === "api"
            ? listUI.querySelector("#webio-tab-api .webio-scroll")
            : listUI.querySelector("#webio-tab-webui-api .webio-scroll");
        if (newScrollEl && savedScrollTop > 0) newScrollEl.scrollTop = savedScrollTop;
        var newApiList = listUI.querySelector("#apiListContainer");
        if (newApiList && savedApiListScrollTop > 0) {
            (function (el, pos) {
                var done = function () { el.scrollTop = pos; };
                if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(function () { requestAnimationFrame(done); });
                else setTimeout(done, 0);
            })(newApiList, savedApiListScrollTop);
        }

        var screenIdInput = listUI.querySelector("#screenIdInput");
        var currentScreenIdLabel = listUI.querySelector("#currentScreenIdLabel");
        function applyScreenId() {
            var val = (screenIdInput.value || "").trim();
            if (!val) {
                screenIdInput.value = currentScreenId;
                return;
            }
            currentScreenId = val;
            screenIdInput.value = val;
            if (currentScreenIdLabel) currentScreenIdLabel.textContent = val;
            if (!collectedScreens[currentScreenId]) {
                collectedScreens[currentScreenId] = {
                    screenId: currentScreenId,
                    page: pageUrl,
                    title: getPageTitle(),
                    label: getPageLabelFallback(),
                    elements: []
                };
            } else {
                collectedScreens[currentScreenId].page = pageUrl;
                collectedScreens[currentScreenId].title = getPageTitle();
                collectedScreens[currentScreenId].label = getPageLabelFallback();
            }
            persistScreensOrAlert("Set Screen ID");
            var pathEl = listUI.querySelector("#parentPathInput");
            savePanelSettings({ lastScreenId: currentScreenId, parentPath: (pathEl && pathEl.value || "").trim() || persistedParentPath });
            updateListUI();
        }
        screenIdInput.onblur = function () {
            screenIdInput.value = currentScreenId;
            if (currentScreenIdLabel) currentScreenIdLabel.textContent = currentScreenId;
        };
        screenIdInput.onkeydown = function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                applyScreenId();
            }
            e.stopPropagation();
        };
        screenIdInput.onkeyup = screenIdInput.oninput = function (e) { e.stopPropagation(); };
        var setScreenIdBtn = listUI.querySelector("#setScreenIdBtn");
        if (setScreenIdBtn) setScreenIdBtn.onclick = applyScreenId;

        if (screenIdHadFocus && preservedScreenIdValue !== null) {
            screenIdInput.value = preservedScreenIdValue;
            screenIdInput.focus();
        }
        if (pathHadFocus && preservedPathValue !== null) {
            var newPathInput = listUI.querySelector("#parentPathInput");
            if (newPathInput) {
                newPathInput.value = preservedPathValue;
                newPathInput.focus();
            }
        }

        listUI.querySelectorAll(".screen-row").forEach(function (row) {
            row.onclick = function () {
                currentScreenId = row.getAttribute("data-screen-id") || currentScreenId;
                savePanelSettings({ lastScreenId: currentScreenId, parentPath: persistedParentPath });
                persistScreensOrAlert("Switch screen");
                updateListUI();
            };
        });

        listUI.querySelectorAll(".saved-element-row").forEach(function (row) {
            row.onclick = function (e) {
                if (e.target.closest(".editElementBtn, .deleteElementBtn")) return;
                var idx = parseInt(row.getAttribute("data-element-idx"), 10);
                if (isNaN(idx)) return;
                var useRecorded = Object.keys(recordedScreens).length > 0;
                var screenData = useRecorded && recordedScreens[currentScreenId] ? recordedScreens[currentScreenId] : getCurrentScreen();
                var elements = screenData.elements || [];
                var savedEl = elements[idx];
                if (!savedEl) return;
                var domEl = resolveElementBySelector(savedEl.selectorType || "xpath", savedEl.selectorValue);
                clearSavedHighlight();
                if (domEl && domEl.nodeType === 1) {
                    domEl.classList.add("webio-saved-highlight");
                    lastHighlightedSavedElement = domEl;
                    try { domEl.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (err) {}
                }
            };
        });

        var parentPathInput = listUI.querySelector("#parentPathInput");
        var exportLocationDisplay = listUI.querySelector("#exportLocationDisplay");
        function updateExportLocationDisplay() {
            var folder = (parentPathInput && parentPathInput.value || "generated").trim() || "generated";
            var pathSegment = folder === "generated" ? "generated" : ("generated/" + folder);
            if (exportLocationDisplay) exportLocationDisplay.innerHTML = "pages/" + pathSegment + "/<br>features/" + pathSegment + "/";
        }
        if (parentPathInput) {
            parentPathInput.oninput = parentPathInput.onchange = function () {
                persistedParentPath = (parentPathInput.value || "").trim() || "generated";
                savePanelSettings({ lastScreenId: currentScreenId, parentPath: persistedParentPath });
                updateExportLocationDisplay();
            };
            updateExportLocationDisplay();
        }
        listUI.querySelector("#generateJsonBtn").onclick = function () {
            var folder = (parentPathInput && parentPathInput.value || "generated").trim() || "generated";
            var screensArray = getScreensForGeneration();
            var jsonData = { screens: screensArray, __mode: "json", __folder: folder };
            downloadBlobAsFile(JSON.stringify(jsonData, null, 2), "webio-screens-" + Date.now() + ".json", "application/json");
            alert("JSON downloaded. Run: node webio/generate-locators-and-features.js <path-to-downloaded.json>");
        };
        listUI.querySelector("#generateFeatureBtn").onclick = function () {
            var folder = (parentPathInput && parentPathInput.value || "generated").trim() || "generated";
            var screensArray = getScreensForGeneration();
            if (typeof window.webioWriteGeneratedFiles === "function") {
                window.webioWriteGeneratedFiles({ screens: screensArray, folder: folder }).then(function (result) {
                    if (result && result.ok) {
                        alert("Files generated successfully.\n\n" + (result.paths ? result.paths.join("\n") : ""));
                    } else {
                        alert("Generation failed: " + (result && result.message ? result.message : "unknown error"));
                    }
                }).catch(function (err) {
                    alert("Generation failed: " + (err && err.message ? err.message : String(err)));
                });
            } else {
                var jsonData = { screens: screensArray, __mode: "feature", __folder: folder };
                downloadBlobAsFile(JSON.stringify(jsonData, null, 2), "webio-screens-" + Date.now() + ".json", "application/json");
                alert("JSON downloaded. Run: node webio/generate-locators-and-features.js <path-to-downloaded.json>");
            }
        };

        var apiMethodFilterEl = listUI.querySelector("#apiMethodFilter");
        var apiUrlKeywordEl = listUI.querySelector("#apiUrlKeyword");
        var apiStatusFilterEl = listUI.querySelector("#apiStatusFilter");
        if (apiMethodFilterEl) apiMethodFilterEl.onchange = function () { updateApiListOnly(); };
        if (apiUrlKeywordEl) apiUrlKeywordEl.oninput = apiUrlKeywordEl.onchange = function () { updateApiListOnly(); };
        if (apiStatusFilterEl) apiStatusFilterEl.oninput = apiStatusFilterEl.onchange = function () { updateApiListOnly(); };
        listUI.querySelectorAll(".webio-api-checkbox").forEach(function (cb) {
            cb.onchange = function () {
                var id = cb.getAttribute("data-api-id");
                if (id) selectedApiIds[id] = cb.checked;
            };
        });
        var generateWebuiApiFeatureBtn = listUI.querySelector("#generateWebuiApiFeatureBtn");
        if (generateWebuiApiFeatureBtn) {
            generateWebuiApiFeatureBtn.onclick = function () {
                listUI.querySelectorAll(".webui-api-step-api-cb").forEach(function (cb) {
                    var si = parseInt(cb.getAttribute("data-step-index"), 10);
                    var ai = parseInt(cb.getAttribute("data-api-index"), 10);
                    if (!isNaN(si) && !isNaN(ai) && webuiApiSteps[si] && webuiApiSteps[si].apiEntries && webuiApiSteps[si].apiEntries[ai]) {
                        webuiApiSteps[si].apiEntries[ai].selected = cb.checked;
                    }
                });
                listUI.querySelectorAll(".webui-api-step-ui-cb").forEach(function (cb) {
                    var si = parseInt(cb.getAttribute("data-step-index"), 10);
                    var ui = parseInt(cb.getAttribute("data-ui-index"), 10);
                    if (!isNaN(si) && !isNaN(ui) && webuiApiSteps[si] && webuiApiSteps[si].uiActions && webuiApiSteps[si].uiActions[ui]) {
                        webuiApiSteps[si].uiActions[ui].selected = cb.checked;
                    }
                });
                if (webuiApiSteps.length === 0) {
                    alert("Add at least one step: use Start step, perform the UI action, then End step & capture UI + APIs.");
                    return;
                }
                var payload = {
                    mode: "webui-api",
                    steps: webuiApiSteps.map(function (s) {
                        return {
                            stepName: s.name,
                            name: s.name,
                            uiActions: s.uiActions || [],
                            apis: (s.apiEntries || []).map(function (e) {
                                return { url: e.url, method: e.method || "GET", responseStatus: e.responseStatus, requestBody: e.requestBody, timestamp: e.timestamp, selected: e.selected !== false };
                            }),
                            screenId: s.screenId,
                            page: s.page,
                            title: s.pageTitle || s.title || s.screenId,
                            labels: (s.uiActions || []).map(function (a) { return a.logicalName || ""; }).filter(Boolean)
                        };
                    })
                };
                if (typeof window.webioWriteGeneratedFiles === "function") {
                    window.webioWriteGeneratedFiles(payload).then(function (result) {
                        if (result && result.ok) {
                            alert("Files written:\n" + (result.paths && result.paths.length ? result.paths.join("\n") : result.message));
                        } else {
                            showApiFeatureEditPopup(buildWebuiApiFeatureContent(webuiApiSteps, listUI.querySelector("#webuiApiUseTableFormat") ? listUI.querySelector("#webuiApiUseTableFormat").checked : webuiApiUseTableFormat), "Web UI + API Feature — Edit then Save", "web-ui-api-integration");
                        }
                    }).catch(function () {
                        var useTable = listUI.querySelector("#webuiApiUseTableFormat") ? listUI.querySelector("#webuiApiUseTableFormat").checked : webuiApiUseTableFormat;
                        showApiFeatureEditPopup(buildWebuiApiFeatureContent(webuiApiSteps, useTable), "Web UI + API Feature — Edit then Save", "web-ui-api-integration");
                    });
                } else {
                    var useTable = listUI.querySelector("#webuiApiUseTableFormat") ? listUI.querySelector("#webuiApiUseTableFormat").checked : webuiApiUseTableFormat;
                    var content = buildWebuiApiFeatureContent(webuiApiSteps, useTable);
                    showApiFeatureEditPopup(content, "Web UI + API Feature — Edit then Save (run CLI to write to disk)", "web-ui-api-integration");
                }
            };
        }
        var webuiApiStartStepBtn = listUI.querySelector("#webuiApiStartStepBtn");
        if (webuiApiStartStepBtn) {
            webuiApiStartStepBtn.onclick = function () {
                var input = listUI.querySelector("#webuiApiStepNameInput");
                var name = (input && input.value || "").trim() || "Step" + (webuiApiSteps.length + 1);
                webuiApiStepCaptureName = name;
                if (input) input.value = name;
                isRecording = true;
                var log = (window.__WEBIO__ && window.__WEBIO__.networkLog) ? window.__WEBIO__.networkLog : [];
                webuiApiStepCaptureStartIndex = log.length;
                webuiApiStepActionsStartIndex = recordedActionsLog.length;
                alert("Step \"" + name + "\" started. Recording is ON. Perform the UI action in the app, then click \"End step & capture UI + APIs\".");
                updateListUI();
            };
        }
        var webuiApiEndStepBtn = listUI.querySelector("#webuiApiEndStepBtn");
        if (webuiApiEndStepBtn) {
            webuiApiEndStepBtn.onclick = function () {
                var input = listUI.querySelector("#webuiApiStepNameInput");
                var name = (input && input.value || "").trim() || webuiApiStepCaptureName || "Step" + (webuiApiSteps.length + 1);
                var log = (window.__WEBIO__ && window.__WEBIO__.networkLog) ? window.__WEBIO__.networkLog : [];
                var start = webuiApiStepCaptureStartIndex != null ? webuiApiStepCaptureStartIndex : log.length;
                var entries = log.slice(start).map(function (e) {
                    return {
                        id: e.id,
                        url: e.url,
                        method: e.method,
                        responseStatus: e.responseStatus,
                        requestBody: e.requestBody,
                        responseBody: e.responseBody,
                        timestamp: e.timestamp || new Date().toISOString(),
                        selected: true
                    };
                });
                var uiStart = webuiApiStepActionsStartIndex != null ? webuiApiStepActionsStartIndex : recordedActionsLog.length;
                var uiActions = recordedActionsLog.slice(uiStart).map(function (a) {
                    return {
                        logicalName: a.logicalName,
                        objectType: a.objectType,
                        selectorType: a.selectorType,
                        selectorValue: a.selectorValue,
                        actionType: a.actionType,
                        inputValue: a.inputValue,
                        timestamp: a.timestamp || new Date().toISOString(),
                        selected: true
                    };
                });
                webuiApiSteps.push({
                    name: name,
                    screenId: currentScreenId,
                    page: window.location.href || "",
                    pageTitle: typeof getPageTitle === "function" ? getPageTitle() : (document && document.title ? document.title.trim() : ""),
                    elementSummary: "",
                    uiActions: uiActions,
                    apiEntries: entries
                });
                webuiApiStepCaptureStartIndex = null;
                webuiApiStepActionsStartIndex = null;
                webuiApiStepCaptureName = "";
                if (input) input.value = "";
                updateListUI();
            };
        }
        listUI.querySelectorAll(".webui-api-step-remove").forEach(function (btn) {
            btn.onclick = function () {
                var si = parseInt(btn.getAttribute("data-step-index"), 10);
                if (!isNaN(si) && si >= 0 && si < webuiApiSteps.length) {
                    webuiApiSteps.splice(si, 1);
                    updateListUI();
                }
            };
        });
        var generateApiFeatureBtn = listUI.querySelector("#generateApiFeatureBtn");
        if (generateApiFeatureBtn) {
            generateApiFeatureBtn.onclick = function () {
                var log = (window.__WEBIO__ && window.__WEBIO__.networkLog) ? window.__WEBIO__.networkLog : [];
                var selected = [];
                Object.keys(selectedApiIds).forEach(function (id) {
                    if (selectedApiIds[id]) {
                        var entry = log.filter(function (e) { return e.id === id; })[0];
                        if (entry) selected.push(entry);
                    }
                });
                if (selected.length === 0) {
                    alert("Select one or more API requests from the list above, then click Generate API Feature.");
                    return;
                }
                var content = buildApiFeatureContent(selected);
                showApiFeatureEditPopup(content);
            };
        }

        listUI.querySelectorAll(".webio-tab").forEach(function (tabBtn) {
            tabBtn.onclick = function () {
                var tab = tabBtn.getAttribute("data-tab");
                if (tab && (tab === "webui" || tab === "api" || tab === "webui-api")) {
                    webioActiveTab = tab;
                    updateListUI();
                }
            };
        });

        const elementList = listUI.querySelector("#elementList");
        filteredSelectable.forEach((el, i) => {
            const label = (getControlLabel(el) || el.innerText || "").trim() || el.tagName.toLowerCase();
            const btn = document.createElement("button");
            btn.innerText = `${label.slice(0, 30)}`;
            btn.style.display = "block";
            btn.style.marginBottom = "6px";
            btn.style.width = "100%";
            btn.onclick = () => {
                var selectorEl = el;
                var ctrlInput = getControlInput(el);
                if (ctrlInput && (ctrlInput.id || ctrlInput.tagName === "INPUT" || ctrlInput.tagName === "SELECT")) selectorEl = ctrlInput;
                const css = getCssSelector(selectorEl);
                const xpath = getXPath(selectorEl);
                const confidence = getConfidence(selectorEl);

                showPopup(el, {
                    logicalName: label,
                    css,
                    xpath,
                    confidence,
                    objectType: determineObjectType(el)
                }, (userInput) => {
                    el.style.outline = '2px solid green';
                    var ctrlInput = getControlInput(el);
                    var exportId = (ctrlInput && ctrlInput.id) ? ctrlInput.id : (el.id || "");
                    var objType = userInput.objectType || determineObjectType(el);
                    var payload = {
                        tag: (ctrlInput && ctrlInput.tagName) ? ctrlInput.tagName.toLowerCase() : el.tagName.toLowerCase(),
                        id: exportId,
                        class: el.className,
                        text: label,
                        logicalName: userInput.logicalName,
                        objectType: objType,
                        selectorType: userInput.selectorType,
                        selectorValue: userInput.selectorValue,
                        value: userInput.value,
                        css: userInput.css,
                        xpath: userInput.xpath,
                        confidence: userInput.confidence
                    };
                    if ((objType === "Radio" || objType === "Checkbox") && label) payload.labelText = label;
                    getCurrentScreen().elements.push(payload);
                    persistScreensOrAlert("Persist locator");
                    updateListUI();
                });
            };
            elementList.appendChild(btn);
        });
        var listEl = listUI.querySelector("#elementList");
        var chevronEl = listUI.querySelector("#elementListChevron");
        if (listEl) listEl.style.display = elementListCollapsed ? "none" : "block";
        if (chevronEl) chevronEl.textContent = elementListCollapsed ? "▶" : "▼";
    }
    
    function exportJSON() {
        const { jsonData, jsonString } = getExportDataCurrent();
        
        // Close existing export popup if any
        const existingExportPopup = document.querySelector('[data-export-popup]');
        if (existingExportPopup) {
            document.body.removeChild(existingExportPopup);
        }
        
        const exportPopup = document.createElement("div");
        exportPopup.setAttribute("data-export-popup", "true");
        exportPopup.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #fff; color: #000; border: 1px solid #ccc; padding: 20px;
            font-family: sans-serif; box-shadow: 2px 2px 20px rgba(0,0,0,0.5);
            z-index: 999999; max-width: 600px; max-height: 80vh; overflow: auto;
            color-scheme: light;
        `;
        
        exportPopup.innerHTML = `
            <style>[data-export-popup] textarea,[data-export-popup] h3{color:#000!important;background-color:#fff!important;border-color:#ccc!important}[data-export-popup] button{color:#000!important;background-color:#f5f5f5!important;border:1px solid #ccc!important}</style>
            <div class="webio-export-drag-handle" style="cursor:move;user-select:none;margin:-20px -20px 12px -20px;padding:12px 20px;border-bottom:1px solid #eee;"><h3 style="margin: 0;">Export JSON</h3></div>
            <textarea id="jsonOutput" style="width: 100%; height: 300px; font-family: monospace; padding: 10px; box-sizing: border-box; border: 1px solid #ccc;">${jsonString}</textarea>
            <div style="margin-top: 15px; text-align: right;">
                <button id="copyBtn" style="padding: 8px 15px; margin-right: 10px; cursor: pointer;">Copy to Clipboard</button>
                <button id="downloadBtn" style="padding: 8px 15px; margin-right: 10px; cursor: pointer;">Download JSON</button>
                <button id="closeExportBtn" style="padding: 8px 15px; cursor: pointer;">Close</button>
            </div>
        `;
        
            document.body.appendChild(exportPopup);
        makePopupDraggable(exportPopup, ".webio-export-drag-handle");
        
        exportPopup.querySelector("#copyBtn").onclick = () => {
            const textarea = exportPopup.querySelector("#jsonOutput");
            textarea.select();
            document.execCommand("copy");
            alert("JSON copied to clipboard!");
        };
        
        exportPopup.querySelector("#downloadBtn").onclick = () => {
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "locator-" + (String(currentScreenId || "screen").replace(/\s+/g, "-")) + "-" + Date.now() + ".json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        
        exportPopup.querySelector("#closeExportBtn").onclick = () => {
            document.body.removeChild(exportPopup);
        };
    }
    
    // Area selection functionality
    let selectionOverlay = null;
    let startX = 0, startY = 0;
    
    function startAreaSelection(e) {
        if (!areaSelectionMode) return;
        
        e.preventDefault();
        e.stopPropagation();
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        
        if (selectionOverlay) {
            document.body.removeChild(selectionOverlay);
        }
        
        selectionOverlay = document.createElement("div");
        selectionOverlay.style.cssText = `
            position: fixed; border: 2px dashed #0066ff;
            background: rgba(0, 102, 255, 0.1); pointer-events: none;
            z-index: 999997;
        `;
        document.body.appendChild(selectionOverlay);
    }
    
    function updateAreaSelection(e) {
        if (!isSelecting || !areaSelectionMode) return;
        
        const currentX = e.clientX;
        const currentY = e.clientY;
        
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        
        selectionOverlay.style.left = left + "px";
        selectionOverlay.style.top = top + "px";
        selectionOverlay.style.width = width + "px";
        selectionOverlay.style.height = height + "px";
    }
    
    function endAreaSelection(e) {
        if (!isSelecting || !areaSelectionMode) return;
        
        isSelecting = false;
        
        if (selectionOverlay) {
            const rect = selectionOverlay.getBoundingClientRect();
            selectionRect = {
                left: rect.left + window.scrollX,
                top: rect.top + window.scrollY,
                right: rect.right + window.scrollX,
                bottom: rect.bottom + window.scrollY
            };
            
            document.body.removeChild(selectionOverlay);
            selectionOverlay = null;
        }
        
        filterSelectableByArea();
        updateListUI();
    }
    
    // Run when DOM is ready so detected elements exist and can be highlighted in red
    const listUI = document.createElement("div");
    listUI.setAttribute("data-webio-panel", "true");
    var panelMinimized = false;
    var panelHeight = Math.min(500, Math.max(300, (window.innerHeight || 600) * 0.6));
    listUI.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        width: 320px; max-width: 95vw; height: ` + panelHeight + `px; max-height: 90vh;
        background: #fafafa; color: #000; border: 1px solid #ccc; border-radius: 10px; z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex; flex-direction: column;
        box-shadow: -2px 0 12px rgba(0,0,0,0.08);
        color-scheme: light;
    `;
    var elementListCollapsed = true;
    var lastHighlightedSavedElement = null;
    function clearSavedHighlight() {
        if (lastHighlightedSavedElement) {
            lastHighlightedSavedElement.classList.remove("webio-saved-highlight");
            lastHighlightedSavedElement = null;
        }
    }
    function resolveElementBySelector(selectorType, selectorValue) {
        if (!selectorType || !selectorValue) return null;
        try {
            if (selectorType === "id") return document.getElementById(selectorValue);
            if (selectorType === "css") return document.querySelector(selectorValue);
            if (selectorType === "xpath") {
                var r = document.evaluate(selectorValue, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return r && r.singleNodeValue;
            }
        } catch (e) {}
        return null;
    }

    // Event delegation so drag still works after updateListUI() replaces innerHTML
    var panelDragging = false, panelStartX = 0, panelStartY = 0, panelStartLeft = 0, panelStartTop = 0;
    var resizing = false, resizeStartY = 0, resizeStartHeight = 0;
    var justDraggedBubble = false;
    var panelDragMoved = false;
    function makePanelDraggable(panel) {
        panel.addEventListener("mousedown", function (e) {
            if (!e.target.closest(".webio-drag-handle")) return;
            if (e.target.closest("input, button, select")) return;
            panelDragging = true;
            var rect = panel.getBoundingClientRect();
            panelStartX = e.clientX;
            panelStartY = e.clientY;
            panelStartLeft = rect.right - rect.width;
            panelStartTop = rect.top;
            e.preventDefault();
        });
    }
    document.addEventListener("mousemove", function (e) {
        if (resizing) {
            var dy = e.clientY - resizeStartY;
            var newH = Math.max(200, Math.min(window.innerHeight - 40, resizeStartHeight + dy));
            panelHeight = newH;
            listUI.style.height = newH + "px";
            return;
        }
        if (!panelDragging || !listUI.parentNode) return;
        var dx = e.clientX - panelStartX;
        var dy = e.clientY - panelStartY;
        if (dx !== 0 || dy !== 0) panelDragMoved = true;
        listUI.style.right = "auto";
        listUI.style.left = (panelStartLeft + dx) + "px";
        listUI.style.top = Math.max(0, panelStartTop + dy) + "px";
        listUI.style.bottom = "auto";
    });
    document.addEventListener("mouseup", function () {
        if (panelDragging && panelMinimized && panelDragMoved) justDraggedBubble = true;
        panelDragging = false;
        panelDragMoved = false;
        resizing = false;
    });

    function showBubbleView() {
        panelMinimized = true;
        var rect = listUI.getBoundingClientRect();
        listUI.style.left = rect.left + "px";
        listUI.style.top = rect.top + "px";
        listUI.style.right = "auto";
        listUI.style.width = "auto";
        listUI.style.height = "auto";
        listUI.style.minWidth = "120px";
        listUI.innerHTML = "<div class=\"webio-bubble webio-drag-handle\" style=\"padding:10px 46px;background:#2563eb;color:#fff;border-radius:50px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);\" title=\"Click to show Assign Screen ID panel\">Webio</div>";
        listUI.querySelector(".webio-bubble").addEventListener("click", function (e) {
            if (justDraggedBubble) { justDraggedBubble = false; return; }
            panelMinimized = false;
            listUI.style.width = "320px";
            listUI.style.maxWidth = "95vw";
            listUI.style.height = panelHeight + "px";
            listUI.style.minWidth = "";
            updateListUI();
        });
    }

    function updateApiListOnly() {
        if (!listUI || !listUI.parentNode) return;
        var container = listUI.querySelector("#apiListContainer");
        if (!container) return;
        var methodEl = listUI.querySelector("#apiMethodFilter");
        var urlEl = listUI.querySelector("#apiUrlKeyword");
        var statusEl = listUI.querySelector("#apiStatusFilter");
        if (methodEl) apiMethodFilter = methodEl.value || "";
        if (urlEl) apiUrlKeyword = (urlEl.value || "").trim();
        if (statusEl) apiStatusFilter = (statusEl.value || "").trim();
        listUI.querySelectorAll(".webio-api-checkbox").forEach(function (cb) {
            var id = cb.getAttribute("data-api-id");
            if (id) selectedApiIds[id] = cb.checked;
        });
        var savedScroll = container.scrollTop;
        var filteredApiLog = getFilteredNetworkLog(apiMethodFilter, apiUrlKeyword, apiStatusFilter);
        var apiListHtml = filteredApiLog.length ? filteredApiLog.map(function (entry) {
            var shortUrl = (entry.url || "").length > 45 ? (entry.url || "").slice(0, 42) + "..." : (entry.url || "");
            var status = entry.responseStatus != null ? entry.responseStatus : "-";
            var checked = selectedApiIds[entry.id] ? " checked" : "";
            return "<div style=\"margin:4px 0;padding:6px 8px;background:#fff;border:1px solid #ddd;border-radius:4px;font-size:11px;display:flex;align-items:center;gap:8px;\">"
                + "<input type=\"checkbox\" class=\"webio-api-checkbox\" data-api-id=\"" + escapeHtml(entry.id) + "\"" + checked + " style=\"flex-shrink:0;\"/>"
                + "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;\" title=\"" + escapeHtml(entry.url || "") + "\">"
                + "<b>" + escapeHtml(entry.method || "GET") + "</b> " + escapeHtml(shortUrl) + " <span style=\"color:#666;\">" + escapeHtml(String(status)) + "</span></span></div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">No API calls captured yet. Use the app to trigger XHR/Fetch requests.</div>";
        container.innerHTML = apiListHtml;
        container.scrollTop = savedScroll;
        listUI.querySelectorAll(".webio-api-checkbox").forEach(function (cb) {
            cb.onchange = function () {
                var id = cb.getAttribute("data-api-id");
                if (id) selectedApiIds[id] = cb.checked;
            };
        });
    }

    function runHighlightScan() {
        if (document.body && listUI && !document.body.contains(listUI)) {
            document.body.appendChild(listUI);
        }
        injectHighlightStyle();
        initializeSelectable();
        if (panelMinimized) return;
        if (webioActiveTab === "api" || webioActiveTab === "webui-api") {
            if (webioActiveTab === "api") updateApiListOnly();
            return;
        }
        if (!listUI.contains(document.activeElement)) {
            updateListUI();
        }
    }

    function init() {
        if (!document.body) {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", init);
                return;
            }
            setTimeout(init, 50);
            return;
        }
        if (listUI.parentNode) return;
        injectHighlightStyle();
        document.body.appendChild(listUI);
        makePanelDraggable(listUI);
        listUI.addEventListener("mousedown", function (e) {
            var resizeHandle = e.target.closest(".webio-resize-handle");
            if (resizeHandle && !panelMinimized) {
                e.preventDefault();
                resizing = true;
                resizeStartY = e.clientY;
                resizeStartHeight = panelHeight;
            }
        });
        listUI.addEventListener("click", function (e) {
            var hideBtn = e.target.closest("#webioHideBtn");
            if (hideBtn) {
                e.preventDefault();
                e.stopPropagation();
                showBubbleView();
                return;
            }
            var elementListHeader = e.target.closest("#elementListHeader");
            if (elementListHeader) {
                e.preventDefault();
                e.stopPropagation();
                elementListCollapsed = !elementListCollapsed;
                var listEl = listUI.querySelector("#elementList");
                var chevronEl = listUI.querySelector("#elementListChevron");
                if (listEl) listEl.style.display = elementListCollapsed ? "none" : "block";
                if (chevronEl) chevronEl.textContent = elementListCollapsed ? "▶" : "▼";
                return;
            }
            var recordingBtn = e.target.closest("#recordingToggleBtn");
            if (recordingBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (isRecording) {
                    isRecording = false;
                } else {
                    isRecording = true;
                    recordedScreens = {};
                }
                updateListUI();
                return;
            }
            var areaBtn = e.target.closest("#areaSelectBtn");
            if (areaBtn) {
                e.preventDefault();
                e.stopPropagation();
                areaSelectionMode = !areaSelectionMode;
                if (!areaSelectionMode) {
                    selectionRect = null;
                    filterSelectableByArea();
                    runHighlightScan();
                } else {
                    updateListUI();
                }
                return;
            }
            var editBtn = e.target.closest(".editElementBtn");
            if (editBtn) {
                e.preventDefault();
                e.stopPropagation();
                var idx = parseInt(editBtn.getAttribute("data-idx"), 10);
                var useRecorded = Object.keys(recordedScreens).length > 0;
                var screenData = useRecorded && recordedScreens[currentScreenId]
                    ? recordedScreens[currentScreenId]
                    : getCurrentScreen();
                var elements = screenData.elements || [];
                var el = elements[idx];
                if (!el) return;
                showPopup(null, {
                    logicalName: el.logicalName || el.text || "",
                    css: el.css || "",
                    xpath: el.xpath || "",
                    objectType: el.objectType || "Button",
                    selectorType: el.selectorType,
                    selectorValue: el.selectorValue,
                    value: el.value != null ? el.value : "",
                    confidence: el.confidence != null ? el.confidence : 0.5
                }, function (updated) {
                    var merged = {};
                    for (var k in el) if (el.hasOwnProperty(k)) merged[k] = el[k];
                    merged.logicalName = updated.logicalName;
                    merged.objectType = updated.objectType;
                    merged.selectorType = updated.selectorType;
                    merged.selectorValue = updated.selectorValue;
                    merged.value = updated.value;
                    merged.css = updated.css;
                    merged.xpath = updated.xpath;
                    merged.confidence = updated.confidence;
                    elements[idx] = merged;
                    // keep collectedScreens in sync and persist to localStorage
                    var current = getCurrentScreen();
                    current.elements = elements.slice();
                    persistScreensOrAlert("Update saved locator");
                    updateListUI();
                });
                return;
            }
            var delBtn = e.target.closest(".deleteElementBtn");
            if (delBtn) {
                e.preventDefault();
                e.stopPropagation();
                var idx = parseInt(delBtn.getAttribute("data-idx"), 10);
                var useRecorded = Object.keys(recordedScreens).length > 0;
                var screenData = useRecorded && recordedScreens[currentScreenId]
                    ? recordedScreens[currentScreenId]
                    : getCurrentScreen();
                var elements = screenData.elements || [];
                if (idx >= 0 && idx < elements.length) {
                    elements.splice(idx, 1);
                    var current = getCurrentScreen();
                    current.elements = elements.slice();
                    persistScreensOrAlert("Delete saved locator");
                    updateListUI();
                }
            }
        });
        runHighlightScan();
        setTimeout(runHighlightScan, 300);
        setTimeout(runHighlightScan, 1500);
        setTimeout(runHighlightScan, 3000);
        setTimeout(runHighlightScan, 5000);
        window.addEventListener("load", function onLoad() {
            window.removeEventListener("load", onLoad);
            runHighlightScan();
        });
        // Re-scan when DOM changes (SPA / dynamic content) so radios and inputs added later are detected
        var scanTimer = null;
        function debouncedScan() {
            if (scanTimer) clearTimeout(scanTimer);
            scanTimer = setTimeout(function () {
                scanTimer = null;
                // Re-append panel if DOM was refreshed (e.g. SPA replaced body) so we don't rely on re-injecting script
                if (document.body && !document.body.contains(listUI)) {
                    document.body.appendChild(listUI);
                }
                runHighlightScan();
            }, 600);
        }
        try {
            var observer = new MutationObserver(debouncedScan);
            observer.observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    document.addEventListener("mousedown", (e) => {
        if (e.target.closest("[data-webio-panel], [data-locator-popup], [data-export-popup]")) return;
        if (areaSelectionMode && e.button === 0) {
            startAreaSelection(e);
        }
    });
    document.addEventListener("mousemove", (e) => {
        updateAreaSelection(e);
    });
    document.addEventListener("mouseup", (e) => {
        endAreaSelection(e);
    });

    init();
})();