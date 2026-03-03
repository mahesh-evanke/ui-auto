/**
 * Extraction logic that runs inside the browser via browser.execute().
 * Returns an array of interactable elements with xpath, css, id, logicalName, objectType.
 * Must be self-contained (no outer scope) for WebdriverIO serialization.
 */
function extractInteractableElements() {
    function xpathLiteral(str) {
        const s = String(str == null ? "" : str);
        if (s.indexOf('"') === -1) return '"' + s + '"';
        if (s.indexOf("'") === -1) return "'" + s + "'";
        const parts = s.split('"');
        return "concat(" + parts.map(function (p) { return '"' + p + '"'; }).join(', \'"\', ') + ")";
    }

    function getXPath(el) {
        if (!el || el.nodeType !== 1) return "";
        function attr(n) {
            try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
        }
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
        var node = el;
        while (node && node.nodeType === 1 && node !== document.documentElement) {
            var index = 1;
            var sibling = node.previousSibling;
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
        function attr(n) {
            try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
        }
        const id = el.id ? String(el.id).trim() : "";
        if (id) return "#" + id.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
        const dataTestId = attr("data-testid");
        if (dataTestId && String(dataTestId).trim()) return '[data-testid="' + String(dataTestId).trim().replace(/"/g, '\\"') + '"]';
        const name = attr("name");
        if (name && String(name).trim()) return '[name="' + String(name).trim().replace(/"/g, '\\"') + '"]';
        const aria = attr("aria-label");
        if (aria && String(aria).trim()) return '[aria-label="' + String(aria).trim().replace(/"/g, '\\"') + '"]';
        const path = [];
        var node = el;
        while (node && node.nodeType === 1 && node !== document.documentElement) {
            var selector = node.nodeName.toLowerCase();
            if (node.classList && node.classList.length) selector += "." + Array.from(node.classList).join(".");
            path.unshift(selector);
            node = node.parentElement;
        }
        return path.join(" > ");
    }

    function getLogicalName(el) {
        if (!el || el.nodeType !== 1) return "";
        if (el.getAttribute && el.getAttribute("aria-label")) return (el.getAttribute("aria-label") || "").trim();
        if (el.getAttribute && el.getAttribute("placeholder")) return (el.getAttribute("placeholder") || "").trim();
        if (el.getAttribute && el.getAttribute("name")) return (el.getAttribute("name") || "").trim();
        if (el.id) return String(el.id).trim();
        if (el.innerText && el.innerText.trim()) return el.innerText.trim().slice(0, 60);
        if (el.value != null && String(el.value).trim()) return String(el.value).trim().slice(0, 60);
        return (el.tagName ? el.tagName.toLowerCase() : "") || "element";
    }

    function getObjectType(el) {
        if (!el || el.nodeType !== 1) return "button";
        const tag = (el.tagName || "").toLowerCase();
        const typeAttr = (el.getAttribute && el.getAttribute("type")) ? String(el.getAttribute("type")).toLowerCase() : "";
        const role = (el.getAttribute && el.getAttribute("role")) ? String(el.getAttribute("role")).toLowerCase() : "";
        if (tag === "input") {
            if (typeAttr === "submit" || typeAttr === "button" || typeAttr === "reset") return "button";
            if (typeAttr === "checkbox") return "checkbox";
            if (typeAttr === "radio") return "radio";
            if (typeAttr === "email" || typeAttr === "text" || typeAttr === "password" || typeAttr === "search") return "textbox";
            return "textbox";
        }
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "dropdown";
        if (tag === "a" && (el.getAttribute("href") || el.href)) return "link";
        if (tag === "button" || role === "button") return "button";
        return "button";
    }

    function pickSelector(el) {
        const attr = function (n) { try { return el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; } };
        if (el.id && String(el.id).trim()) return { type: "id", value: "#" + String(el.id).trim() };
        const dt = attr("data-testid");
        if (dt && String(dt).trim()) return { type: "css", value: '[data-testid="' + String(dt).trim() + '"]' };
        const name = attr("name");
        if (name && String(name).trim()) return { type: "css", value: '[name="' + String(name).trim() + '"]' };
        const aria = attr("aria-label");
        if (aria && String(aria).trim()) return { type: "css", value: '[aria-label="' + String(aria).trim().replace(/"/g, '\\"') + '"]' };
        const xpath = getXPath(el);
        if (xpath) return { type: "xpath", value: xpath };
        const css = getCssSelector(el);
        return { type: "css", value: css || ("xpath:" + xpath) };
    }

    const selector = "input, textarea, button, a[href], select, [role=\"button\"], [role=\"link\"], [role=\"textbox\"], [onclick], [tabindex=\"0\"]";
    const nodes = document.querySelectorAll(selector);
    const results = [];
    const seen = new Set();

    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!el || !document.documentElement.contains(el)) continue;
        var xpath = getXPath(el);
        if (!xpath || seen.has(xpath)) continue;
        seen.add(xpath);

        var sel = pickSelector(el);
        var logicalName = getLogicalName(el);
        if (!logicalName) logicalName = "element_" + (i + 1);

        results.push({
            logicalName: logicalName,
            selectorType: sel.type === "id" ? "css" : sel.type,
            selectorValue: sel.value,
            objectType: getObjectType(el),
            tag: (el.tagName || "").toLowerCase(),
            id: el.id || "",
            name: (el.getAttribute && el.getAttribute("name")) || "",
            placeholder: (el.getAttribute && el.getAttribute("placeholder")) || "",
            ariaLabel: (el.getAttribute && el.getAttribute("aria-label")) || ""
        });
    }

    return {
        page: window.location.href || "",
        title: (document && document.title && document.title.trim) ? document.title.trim() : "",
        label: (function () {
            try {
                var h = document.querySelector("main h1, main h2, h1, h2");
                return (h && h.textContent) ? h.textContent.trim() : "";
            } catch (e) { return ""; }
        })(),
        elements: results
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = extractInteractableElements;
}
