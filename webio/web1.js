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

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return '//*[@id="' + el.id.replace(/"/g, '\\"') + '"]';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1;
      let sibling = node.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.nodeName === node.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      const tagName = node.nodeName.toLowerCase();
      const part = tagName + "[" + index + "]";
      parts.unshift(part);
      node = node.parentNode;
    }
    return "/html/" + parts.join("/");
  }

  function getCssSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + String(el.id).replace(/\s/g, "\\ ");
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let selector = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) {
        selector += "." + Array.from(node.classList).join(".");
      }
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
    var currentScreenId = defaultScreenIdForPage;
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

    let contextMenu = null;
    let tooltip = null;
    let areaSelectionMode = false;
    let selectionRect = null;
    let isSelecting = false;
    let selectable = [];
    let filteredSelectable = [];
    
    function getXPath(el) {
        if (el.id) return `//*[@id="${el.id}"]`;
        if (el === document.body) return '/html/body';
        let ix = 0;
        const siblings = el.parentNode.childNodes;
        for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            
            if (sibling === el) return getXPath(el.parentNode) + '/' + el.tagName.toLowerCase() + `[${ix + 1}]`;
            if (sibling.nodeType === 1 && sibling.tagName === el.tagName) ix++;
        }
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
            add("css", getCssSelector(el), "css: ...");
            add("xpath", getXPath(el), "xpath: ...");
        }
        if (savedRecord) {
            if (savedRecord.selectorType && savedRecord.selectorValue) add(savedRecord.selectorType, savedRecord.selectorValue);
            if (savedRecord.css) add("css", savedRecord.css);
            if (savedRecord.xpath) add("xpath", savedRecord.xpath);
            if (savedRecord.id) add("id", savedRecord.id);
        }
        return options.length ? options : [{ type: "css", value: "", label: "css: " }];
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
            "<div style=\"font-weight:600;margin-bottom:10px;\">Capture element</div>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Logical Name<br><input id=\"logicalName\" value=\"" + esc(defaults.logicalName) + "\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Object Type<br><select id=\"objectType\" style=\"width:100%;padding:6px;box-sizing:border-box;\">" + objHtml + "</select></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Choose Attribute/Selector to Save<br><select id=\"selectorSelect\" style=\"width:100%;padding:6px;box-sizing:border-box;\">" + selHtml + "</select></label>" +
            "<label style=\"display:block;margin-bottom:8px;font-size:12px;\">Selector Value<br><input id=\"selectorValue\" value=\"" + esc(selValue) + "\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<label style=\"display:block;margin-bottom:12px;font-size:12px;\">Value (text to enter / option to select)<br><input id=\"actionValue\" value=\"" + esc(actionValue) + "\" placeholder=\"e.g. username, option1\" style=\"width:100%;padding:6px;box-sizing:border-box;\"/></label>" +
            "<div style=\"text-align:right;\"><button id=\"cancelBtn\" style=\"margin-right:8px;padding:6px 12px;\">Cancel</button><button id=\"saveBtn\" style=\"padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;\">Save</button></div>";

        document.body.appendChild(popup);
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
                try { document.body.removeChild(popup); } catch (e) {}
            }
        };
        popup.querySelector("#cancelBtn").onclick = function (ev) {
            try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
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
        
        const menuItem = document.createElement("div");
        menuItem.innerText = "Edit Save Locator";
        menuItem.style.cssText = `
            padding: 8px 15px; cursor: pointer;
        `;
        menuItem.onmouseenter = () => {
            menuItem.style.background = "#f0f0f0";
        };
        menuItem.onmouseleave = () => {
            menuItem.style.background = "#fff";
        };
        menuItem.onclick = () => {
            const label = (getControlLabel(el) || el.innerText || "").trim() || el.tagName.toLowerCase();
            const css = getCssSelector(el);
            const xpath = getXPath(el);
            const confidence = getConfidence(el);

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

            document.body.removeChild(contextMenu);
            contextMenu = null;
        };
        
        contextMenu.appendChild(menuItem);
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
        tooltip.innerText = "Edit Save Locator";
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
        style.textContent = '.' + HIGHLIGHT_CLASS + ' { outline: 2px solid red !important; box-shadow: 0 0 0 2px red !important; cursor: pointer !important; }';
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
        // Detect all interactive controls: native + ARIA roles + MUI + any <label> containing radio/checkbox (including inside shadow roots)
        var selector = [
            'button', 'a', 'input', 'textarea', 'select',
            '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]',
            '[role="combobox"]', '[role="listbox"]', '[role="option"]',
            '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
            '.MuiRadio-root', '.MuiCheckbox-root', '.MuiSwitch-root',
            '[class*="MuiRadio-root"]', '[class*="MuiCheckbox-root"]', '[class*="MuiSwitch-root"]'
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
            seen.add(node);
            selectable.push(node);
        }
        var labelInputs = queryLabelRadioCheckboxIncludingShadowRoots(document.body);
        for (var j = 0; j < labelInputs.length; j++) {
            var lbl = labelInputs[j].closest && labelInputs[j].closest("label");
            if (lbl && !seen.has(lbl)) { seen.add(lbl); selectable.push(lbl); }
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
    
    function getExportDataCurrent() {
        var screen = getCurrentScreen();
        var jsonData = { page: screen.page, screenId: screen.screenId, elements: screen.elements || [] };
        return { jsonData, jsonString: JSON.stringify(jsonData, null, 2) };
    }
    function getExportDataAll() {
        var screensArray = Object.keys(collectedScreens).map(function (id) { return collectedScreens[id]; });
        var jsonData = { screens: screensArray };
        return { jsonData, jsonString: JSON.stringify(jsonData, null, 2) };
    }

    function copyJsonToClipboard(exportAll) {
        exportAll = !!exportAll;
        try {
            var data = exportAll ? getExportDataAll() : getExportDataCurrent();
            var jsonString = data.jsonString;
            const ta = document.createElement("textarea");
            ta.value = jsonString;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, jsonString.length);
            var ok = false;
            try {
                ok = document.execCommand("copy");
            } catch (e) {}
            document.body.removeChild(ta);
            if (ok) {
                alert("JSON copied to clipboard!");
            } else if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonString).then(function () { alert("JSON copied to clipboard!"); }).catch(function () { alert("Copy failed. Use Download JSON."); });
            } else {
                alert("Copy failed. Use Download JSON.");
            }
        } catch (e) {
            alert("Copy failed: " + (e && e.message ? e.message : "unknown"));
        }
    }

    function downloadJsonFile(exportAll) {
        try {
            var data = exportAll ? getExportDataAll() : getExportDataCurrent();
            var jsonString = data.jsonString;
            var filename = exportAll ? "locator-all-screens-" + Date.now() + ".json" : "locator-" + (String(currentScreenId || "screen").replace(/\s+/g, "-")) + "-" + Date.now() + ".json";
            var blob = new Blob([jsonString], { type: "application/json" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                if (a.parentNode) document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 500);
            alert("Download started. Check your downloads folder.");
        } catch (e) {
            alert("Download failed: " + (e && e.message ? e.message : "unknown"));
        }
    }

    function escapeHtml(s) {
        if (s == null) return "";
        var div = document.createElement("div");
        div.textContent = s;
        return div.innerHTML;
    }

    function updateListUI() {
        var screenIds = Object.keys(collectedScreens);
        var allScreensHtml = screenIds.length ? screenIds.map(function (id) {
            var screen = collectedScreens[id];
            var count = (screen.elements && screen.elements.length) || 0;
            var isCurrent = id === currentScreenId;
            return "<div class=\"screen-row\" data-screen-id=\"" + escapeHtml(id) + "\" style=\"margin:4px 0;padding:6px 8px;background:" + (isCurrent ? "#e0f0ff" : "#f0f0f0") + ";border-radius:4px;font-size:12px;cursor:pointer;\"><b>" + (isCurrent ? "[Current] " : "") + escapeHtml(id) + "</b> (" + count + " elements) — click to select</div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">No screens yet. Assign a Screen ID above and capture elements.</div>";
        var currentElements = getCurrentScreen().elements || [];
        var savedElementsHtml = currentElements.length ? currentElements.map(function (el, idx) {
            var name = (el.logicalName || el.text || "Element " + (idx + 1)).slice(0, 25);
            return "<div class=\"saved-element-row\" data-element-idx=\"" + idx + "\" style=\"margin:4px 0;padding:6px 8px;background:#fff;border:1px solid #ddd;border-radius:4px;font-size:12px;display:flex;align-items:center;justify-content:space-between;\"><span title=\"" + escapeHtml(el.logicalName || el.text || "") + "\">" + escapeHtml(name) + "</span><span><button type=\"button\" class=\"editElementBtn\" data-idx=\"" + idx + "\" style=\"margin-right:4px;padding:2px 8px;cursor:pointer;font-size:11px;\">Edit</button><button type=\"button\" class=\"deleteElementBtn\" data-idx=\"" + idx + "\" style=\"padding:2px 8px;cursor:pointer;font-size:11px;color:#c00;\">Delete</button></span></div>";
        }).join("") : "<div style=\"font-size:12px;color:#000;\">No saved elements for this screen. Right‑click page elements to add.</div>";
        var prevInput = listUI.querySelector("#screenIdInput");
        var hadFocus = prevInput && document.activeElement === prevInput;
        var preservedValue = prevInput ? prevInput.value : null;

        listUI.innerHTML = `<style>[data-webio-panel] input,[data-webio-panel] select,[data-webio-panel] textarea{color:#000!important;background-color:#fff!important;border-color:#ccc!important}[data-webio-panel] button:not(#setScreenIdBtn){color:#000!important;background-color:#fff!important;border-color:#ccc!important}</style>
            <div class="webio-header" style="flex-shrink:0;padding:12px;background:#fff;color:#000;border-bottom:1px solid #e0e0e0;">
                <div style="font-size:10px;color:#333;margin-bottom:8px;">Scroll page in main area (left). This panel scrolls below.</div>
                <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;text-transform:uppercase;">Assign Screen ID for this page</div>
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                    <input id="screenIdInput" type="text" value="${escapeHtml(currentScreenId)}" placeholder="e.g. Login, Dashboard" autocomplete="off" style="flex:1;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;"/>
                    <button id="setScreenIdBtn" type="button" style="flex-shrink:0;padding:10px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">Set</button>
                </div>
                <div style="font-size:11px;color:#000;">Current: <strong id="currentScreenIdLabel">${escapeHtml(currentScreenId)}</strong></div>
            </div>
            <div class="webio-scroll" style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px;-webkit-overflow-scrolling:touch;">
                <div style="margin-bottom:12px;">
                    <div style="font-size:11px;color:#000;margin-bottom:6px;font-weight:600;">Page elements</div>
                    <button id="areaSelectBtn" type="button" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">
                        ${areaSelectionMode ? "Disable" : "Enable"} area selection
                    </button>
                </div>
                <div style="margin-bottom:12px;padding:12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;">
                    <div style="font-size:11px;color:#000;margin-bottom:8px;font-weight:600;">Export JSON</div>
                    <button id="copyCurrentBtn" type="button" style="display:block;width:100%;margin-bottom:6px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">Copy current screen</button>
                    <button id="copyAllBtn" type="button" style="display:block;width:100%;margin-bottom:6px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">Copy all screens</button>
                    <button id="downloadCurrentBtn" type="button" style="display:block;width:100%;margin-bottom:6px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">Download current screen</button>
                    <button id="downloadAllBtn" type="button" style="display:block;width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;">Download all screens</button>
                </div>
                <div style="margin-bottom:8px;font-size:11px;color:#000;font-weight:600;">All screens (click to select)</div>
                <div id="allScreensList" style="max-height:100px;overflow-y:auto;margin-bottom:12px;font-size:12px;">${allScreensHtml}</div>
                <div style="margin-bottom:8px;font-size:11px;color:#000;font-weight:600;">Saved elements — Edit / Delete</div>
                <div id="savedElementsList" style="max-height:160px;overflow-y:auto;margin-bottom:12px;font-size:12px;">${savedElementsHtml}</div>
                <div style="margin-bottom:8px;font-size:11px;color:#000;font-weight:600;">Click to add to current screen</div>
                <div id="elementList"></div>
            </div>
        `;

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

        if (hadFocus && preservedValue !== null) {
            screenIdInput.value = preservedValue;
            screenIdInput.focus();
        }

        listUI.querySelectorAll(".screen-row").forEach(function (row) {
            row.onclick = function () {
                currentScreenId = row.getAttribute("data-screen-id") || currentScreenId;
                persistScreensOrAlert("Switch screen");
                updateListUI();
            };
        });

        listUI.querySelector("#copyCurrentBtn").onclick = function () { copyJsonToClipboard(false); };
        listUI.querySelector("#copyAllBtn").onclick = function () { copyJsonToClipboard(true); };
        listUI.querySelector("#downloadCurrentBtn").onclick = function () { downloadJsonFile(false); };
        listUI.querySelector("#downloadAllBtn").onclick = function () { downloadJsonFile(true); };

        const elementList = listUI.querySelector("#elementList");
        filteredSelectable.forEach((el, i) => {
            const label = (getControlLabel(el) || el.innerText || "").trim() || el.tagName.toLowerCase();
            const btn = document.createElement("button");
            btn.innerText = `${label.slice(0, 30)}`;
            btn.style.display = "block";
            btn.style.marginBottom = "6px";
            btn.style.width = "100%";
            btn.onclick = () => {
                const css = getCssSelector(el);
                const xpath = getXPath(el);
                const confidence = getConfidence(el);

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
            <h3 style="margin-top: 0;">Export JSON</h3>
            <textarea id="jsonOutput" style="width: 100%; height: 300px; font-family: monospace; padding: 10px; box-sizing: border-box; border: 1px solid #ccc;">${jsonString}</textarea>
            <div style="margin-top: 15px; text-align: right;">
                <button id="copyBtn" style="padding: 8px 15px; margin-right: 10px; cursor: pointer;">Copy to Clipboard</button>
                <button id="downloadBtn" style="padding: 8px 15px; margin-right: 10px; cursor: pointer;">Download JSON</button>
                <button id="closeExportBtn" style="padding: 8px 15px; cursor: pointer;">Close</button>
            </div>
        `;
        
            document.body.appendChild(exportPopup);
        
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
    listUI.style.cssText = `
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 320px; max-width: 95vw;
        background: #fafafa; color: #000; border-left: 1px solid #ccc; z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex; flex-direction: column;
        box-shadow: -2px 0 12px rgba(0,0,0,0.08);
        color-scheme: light;
    `;

    function runHighlightScan() {
        injectHighlightStyle();
        initializeSelectable();
        updateListUI();
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
        listUI.addEventListener("click", function (e) {
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
                var elements = getCurrentScreen().elements;
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
                var elements = getCurrentScreen().elements;
                if (idx >= 0 && idx < elements.length) {
                    elements.splice(idx, 1);
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