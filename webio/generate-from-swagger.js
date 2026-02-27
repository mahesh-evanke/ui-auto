#!/usr/bin/env node
/**
 * Generate API feature files from a Swagger/OpenAPI JSON URL.
 *
 * Responsibilities:
 * - Fetch Swagger/OpenAPI JSON from a given URL.
 * - Discover all APIs (paths + methods).
 * - For each API, derive:
 *   - Full URL (including base URL).
 *   - Input fields (path params, query params, JSON body fields).
 *   - Required vs optional fields (for JSON body and params).
 * - Generate one feature file per API with:
 *   - A main "happy path" scenario.
 *   - Additional scenarios for:
 *     - Missing required field.
 *     - Wrong value/type for a field.
 *     - Edge-case value for a field.
 *
 * Usage:
 *   node webio/generate-from-swagger.js <swagger-json-url> [output-dir]
 *
 *   - <swagger-json-url>: HTTP(S) URL to Swagger/OpenAPI JSON.
 *   - [output-dir]: Optional. Directory (relative to project root) where .feature
 *                   files will be written. Defaults to "e2e/generated/api/features/".
 *
 * The generated feature files use the generic API step definitions in
 * `e2e/stepdefinitions/api/generic.steps.ts`.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { getGeneratedPaths, ensureLocatorStructure } = require("./generation-utils.js");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function safeFileName(s) {
    return (s || "")
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9\-_.]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "api";
}

function escFeatureString(s) {
    return String(s == null ? "" : s).replace(/"/g, '\\"');
}

function joinUrl(base, relativePath) {
    const b = String(base || "").replace(/\/+$/, "");
    const p = String(relativePath || "");
    if (!b) return p;
    if (!p) return b;
    return b + (p.startsWith("/") ? p : "/" + p);
}

function detectBaseUrlFromOpenApi(openapi, sourceUrl) {
    if (openapi && Array.isArray(openapi.servers) && openapi.servers.length > 0) {
        const u = openapi.servers[0].url;
        if (typeof u === "string" && u.trim()) {
            return u.trim();
        }
    }
    try {
        const u = new URL(sourceUrl);
        return u.origin;
    } catch {
        return "";
    }
}

function detectBaseUrlFromSwagger2(swagger, sourceUrl) {
    if (swagger.host) {
        const scheme = Array.isArray(swagger.schemes) && swagger.schemes.length > 0
            ? swagger.schemes[0]
            : "https";
        const basePath = swagger.basePath || "";
        return scheme + "://" + swagger.host.replace(/\/+$/, "") + (basePath || "");
    }
    try {
        const u = new URL(sourceUrl);
        const basePath = swagger.basePath || "";
        return u.origin + (basePath || "");
    } catch {
        return swagger.basePath || "";
    }
}

function resolveRef(ref, root) {
    if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
    const parts = ref.slice(2).split("/");
    let current = root;
    for (const part of parts) {
        if (!current || typeof current !== "object") return null;
        current = current[part];
    }
    return current || null;
}

function normalizeSchema(schema, root) {
    if (!schema) return {};
    let s = schema;
    if (s.$ref) {
        const resolved = resolveRef(s.$ref, root);
        if (resolved) s = resolved;
    }
    if (Array.isArray(s.allOf) && s.allOf.length > 0) {
        const merged = { type: "object", properties: {}, required: [] };
        for (const part of s.allOf) {
            const norm = normalizeSchema(part, root);
            if (norm.properties) {
                Object.assign(merged.properties, norm.properties);
            }
            if (Array.isArray(norm.required)) {
                merged.required = Array.from(new Set(merged.required.concat(norm.required)));
            }
        }
        return merged;
    }
    return s;
}

function extractBodyModelOpenApi3(operation, root) {
    const rb = operation.requestBody;
    if (!rb || !rb.content) return null;
    const jsonContent =
        rb.content["application/json"] ||
        rb.content["application/*+json"] ||
        rb.content["*/*"];
    if (!jsonContent || !jsonContent.schema) return null;
    const schema = normalizeSchema(jsonContent.schema, root);
    if (!schema || !schema.properties) return null;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema.properties || {};
    const fields = [];
    for (const [name, propSchema] of Object.entries(properties)) {
        const prop = normalizeSchema(propSchema, root);
        const type = prop.type || (prop.format ? "string" : "string");
        fields.push({
            name,
            type,
            required: required.includes(name),
        });
    }
    return fields;
}

function extractBodyModelSwagger2(operation, root) {
    const params = Array.isArray(operation.parameters) ? operation.parameters : [];
    const bodyParam = params.find((p) => p.in === "body");
    if (!bodyParam || !bodyParam.schema) return null;
    const schema = normalizeSchema(bodyParam.schema, root);
    if (!schema || !schema.properties) return null;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema.properties || {};
    const fields = [];
    for (const [name, propSchema] of Object.entries(properties)) {
        const prop = normalizeSchema(propSchema, root);
        const type = prop.type || (prop.format ? "string" : "string");
        fields.push({
            name,
            type,
            required: required.includes(name),
        });
    }
    return fields;
}

function extractParamsForOperation(pathItem, operation) {
    const combined = []
        .concat(Array.isArray(pathItem.parameters) ? pathItem.parameters : [])
        .concat(Array.isArray(operation.parameters) ? operation.parameters : []);
    const seen = new Set();
    const result = [];
    for (const p of combined) {
        if (!p || typeof p.name !== "string") continue;
        const key = p.in + ":" + p.name;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(p);
    }
    return result;
}

function classifyParams(params, root) {
    const pathParams = [];
    const queryParams = [];
    for (const p of params) {
        const isRequired = !!p.required;
        let type = p.type;
        if (!type && p.schema) {
            const s = normalizeSchema(p.schema, root);
            type = s.type || "string";
        }
        const entry = {
            name: p.name,
            in: p.in,
            type: type || "string",
            required: isRequired,
        };
        if (p.in === "path") pathParams.push(entry);
        else if (p.in === "query") queryParams.push(entry);
    }
    return { pathParams, queryParams };
}

function sampleValueForType(name, type) {
    const t = (type || "string").toLowerCase();
    if (t === "integer" || t === "number") return 1;
    if (t === "boolean") return true;
    return name.toLowerCase().includes("id") ? "123" : "sample-" + name;
}

function wrongTypeValueForType(type) {
    const t = (type || "string").toLowerCase();
    if (t === "integer" || t === "number") return '"WRONG_TYPE"';
    if (t === "boolean") return '"not-boolean"';
    return 123;
}

function edgeCaseValueForType(type) {
    const t = (type || "string").toLowerCase();
    if (t === "integer" || t === "number") return 0;
    if (t === "boolean") return false;
    return '"EDGE_CASE_VALUE"';
}

function serializeValueForBody(v) {
    if (typeof v === "string") {
        if (v.startsWith('"') && v.endsWith('"')) return v;
        return `"${v}"`;
    }
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v === null) return "null";
    return JSON.stringify(v);
}

function buildUrlWithPathParams(baseUrl, rawPath, pathParams) {
    let p = rawPath || "";
    for (const param of pathParams) {
        const placeholder = "{" + param.name + "}";
        const sample = sampleValueForType(param.name, param.type);
        p = p.replace(placeholder, encodeURIComponent(String(sample)));
    }
    return joinUrl(baseUrl, p);
}

function buildQueryString(params, variant) {
    if (!params || params.length === 0) return "";
    const parts = [];
    for (const param of params) {
        if (variant === "missing" && param.required) {
            continue;
        }
        let value;
        if (variant === "wrong") {
            const w = wrongTypeValueForType(param.type);
            value = typeof w === "string" ? w.replace(/^"|"$/g, "") : String(w);
        } else if (variant === "edge") {
            const e = edgeCaseValueForType(param.type);
            value = typeof e === "string" ? e.replace(/^"|"$/g, "") : String(e);
        } else {
            const s = sampleValueForType(param.name, param.type);
            value = typeof s === "string" ? s : String(s);
        }
        parts.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(value)}`);
    }
    if (parts.length === 0) return "";
    return "?" + parts.join("&");
}

function pickFirstRequiredField(fields) {
    if (!fields || fields.length === 0) return null;
    const required = fields.filter((f) => f.required);
    if (required.length > 0) return required[0];
    return fields[0];
}

function generateBodyTable(fields, mode) {
    const lines = [];
    lines.push("      | path  | value |");
    if (!fields || fields.length === 0) {
        return lines.join("\n");
    }
    const targetField = pickFirstRequiredField(fields);
    for (const f of fields) {
        if (mode === "missing" && targetField && f.name === targetField.name) {
            continue;
        }
        let raw;
        if (mode === "wrong" && targetField && f.name === targetField.name) {
            raw = serializeValueForBody(wrongTypeValueForType(f.type));
        } else if (mode === "edge" && targetField && f.name === targetField.name) {
            raw = serializeValueForBody(edgeCaseValueForType(f.type));
        } else {
            raw = serializeValueForBody(sampleValueForType(f.name, f.type));
        }
        lines.push(`      | ${f.name} | ${raw} |`);
    }
    return lines.join("\n");
}

function generateFeatureForApi(options) {
    const {
        method,
        pathTemplate,
        baseUrl,
        summary,
        operationId,
        pathParams,
        queryParams,
        bodyFields,
    } = options;

    const methodUpper = method.toUpperCase();
    const humanName =
        summary ||
        operationId ||
        `${methodUpper} ${pathTemplate}`;

    const urlBase = buildUrlWithPathParams(baseUrl, pathTemplate, pathParams);
    const hasBody = Array.isArray(bodyFields) && bodyFields.length > 0;

    const queryNormal = buildQueryString(queryParams, "normal");
    const queryMissing = buildQueryString(queryParams, "missing");
    const queryWrong = buildQueryString(queryParams, "wrong");
    const queryEdge = buildQueryString(queryParams, "edge");

    const lines = [];
    lines.push("@api @auto-swagger");
    lines.push(`Feature: ${escFeatureString(humanName)}`);
    lines.push("");
    lines.push(`  # Endpoint: ${methodUpper} ${pathTemplate}`);
    lines.push(`  # Base URL: ${baseUrl || "(from Swagger/OpenAPI)"}`);
    lines.push("");

    lines.push(`  Scenario: ${methodUpper} ${pathTemplate} - happy path`);
    if (hasBody) {
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryNormal
            )}" with body:`
        );
        lines.push(generateBodyTable(bodyFields, "normal"));
    } else {
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryNormal
            )}"`
        );
    }
    lines.push("    Then User expects status code 200");
    lines.push("");

    if (hasBody) {
        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - missing required field`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryNormal
            )}" with body:`
        );
        lines.push(generateBodyTable(bodyFields, "missing"));
        lines.push("    Then User expects status code 400");
        lines.push("");

        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - wrong value type`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryNormal
            )}" with body:`
        );
        lines.push(generateBodyTable(bodyFields, "wrong"));
        lines.push("    Then User expects status code 400");
        lines.push("");

        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - edge-case value`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryNormal
            )}" with body:`
        );
        lines.push(generateBodyTable(bodyFields, "edge"));
        lines.push("    Then User expects status code 200");
        lines.push("");
    } else if (queryParams && queryParams.length > 0) {
        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - missing required query parameter`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryMissing
            )}"`
        );
        lines.push("    Then User expects status code 400");
        lines.push("");

        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - wrong query parameter type`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryWrong
            )}"`
        );
        lines.push("    Then User expects status code 400");
        lines.push("");

        lines.push(
            `  Scenario: ${methodUpper} ${pathTemplate} - edge-case query parameter value`
        );
        lines.push(
            `    Given User sends ${methodUpper} request to "${escFeatureString(
                urlBase + queryEdge
            )}"`
        );
        lines.push("    Then User expects status code 200");
        lines.push("");
    }

    return lines.join("\n") + "\n";
}

async function generateFromOpenApi(openapi, sourceUrl, outDir) {
    const baseUrl = detectBaseUrlFromOpenApi(openapi, sourceUrl);
    const paths = openapi.paths || {};
    const methods = ["get", "post", "put", "patch", "delete"];

    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
        if (!pathItem || typeof pathItem !== "object") continue;
        for (const m of methods) {
            const operation = pathItem[m];
            if (!operation) continue;
            const params = extractParamsForOperation(pathItem, operation);
            const { pathParams, queryParams } = classifyParams(params, openapi);
            const bodyFields = extractBodyModelOpenApi3(operation, openapi);

            const featureContent = generateFeatureForApi({
                method: m,
                pathTemplate,
                baseUrl,
                summary: operation.summary,
                operationId: operation.operationId,
                pathParams,
                queryParams,
                bodyFields,
            });

            const nameHint =
                (operation.operationId && safeFileName(operation.operationId)) ||
                safeFileName(m + "-" + pathTemplate.replace(/[{}]/g, ""));
            const fileName = nameHint + ".feature";
            const outPath = path.join(outDir, fileName);
            fs.writeFileSync(outPath, featureContent, "utf8");
            console.log("Wrote:", outPath);
        }
    }
}

async function generateFromSwagger2(swagger, sourceUrl, outDir) {
    const baseUrl = detectBaseUrlFromSwagger2(swagger, sourceUrl);
    const paths = swagger.paths || {};
    const methods = ["get", "post", "put", "patch", "delete"];

    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
        if (!pathItem || typeof pathItem !== "object") continue;
        for (const m of methods) {
            const operation = pathItem[m];
            if (!operation) continue;
            const params = extractParamsForOperation(pathItem, operation);
            const { pathParams, queryParams } = classifyParams(params, swagger);
            const bodyFields = extractBodyModelSwagger2(operation, swagger);

            const featureContent = generateFeatureForApi({
                method: m,
                pathTemplate,
                baseUrl,
                summary: operation.summary,
                operationId: operation.operationId,
                pathParams,
                queryParams,
                bodyFields,
            });

            const nameHint =
                (operation.operationId && safeFileName(operation.operationId)) ||
                safeFileName(m + "-" + pathTemplate.replace(/[{}]/g, ""));
            const fileName = nameHint + ".feature";
            const outPath = path.join(outDir, fileName);
            fs.writeFileSync(outPath, featureContent, "utf8");
            console.log("Wrote:", outPath);
        }
    }
}

async function main() {
    const swaggerUrl = process.argv[2];
    const outDirArg = process.argv[3];

    if (!swaggerUrl) {
        console.error("Usage: node webio/generate-from-swagger.js <swagger-json-url> [output-dir]");
        process.exit(1);
    }

    const outDir = outDirArg
        ? path.isAbsolute(outDirArg)
            ? outDirArg
            : path.join(PROJECT_ROOT, outDirArg)
        : (() => {
            ensureLocatorStructure("api");
            return getGeneratedPaths("api").featuresDir;
        })();

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let resp;
    try {
        resp = await axios.get(swaggerUrl, { timeout: 30000 });
    } catch (err) {
        console.error("Failed to fetch Swagger/OpenAPI JSON:", err.message || String(err));
        process.exit(1);
    }

    const spec = resp.data;
    if (!spec || typeof spec !== "object") {
        console.error("Swagger/OpenAPI JSON did not return an object.");
        process.exit(1);
    }

    if (spec.openapi) {
        await generateFromOpenApi(spec, swaggerUrl, outDir);
    } else if (spec.swagger) {
        await generateFromSwagger2(spec, swaggerUrl, outDir);
    } else {
        console.error("Unknown spec format: missing 'openapi' or 'swagger' field.");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

