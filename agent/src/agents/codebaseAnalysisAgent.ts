import fs from "node:fs";
import path from "node:path";
import type { CandidateFile, PackageJsonInfo, RepoAnalysis } from "../types.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "qa-output",
  "tests/e2e-generated",
  ".turbo",
  ".cache",
]);

const MAX_FILES = 4000;

function walk(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length && results.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        results.push(path.relative(root, full).split(path.sep).join("/"));
        if (results.length >= MAX_FILES) break;
      }
    }
  }
  return results;
}

function readPackageJson(root: string): PackageJsonInfo | null {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return {
      name: raw.name,
      scripts: raw.scripts ?? {},
      dependencies: raw.dependencies ?? {},
      devDependencies: raw.devDependencies ?? {},
    };
  } catch {
    return null;
  }
}

function detectPackageManager(root: string): "npm" | "pnpm" | "yarn" {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectFramework(pkg: PackageJsonInfo | null, files: string[]): string {
  if (!pkg) return "unknown (no package.json found)";
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps["next"]) return "Next.js";
  if (deps["nuxt"]) return "Nuxt";
  if (deps["@remix-run/react"]) return "Remix";
  if (deps["vite"] && deps["react"]) return "React + Vite";
  if (deps["vite"] && deps["vue"]) return "Vue + Vite";
  if (deps["react"]) return "React";
  if (deps["vue"]) return "Vue";
  if (deps["@angular/core"]) return "Angular";
  if (deps["express"]) return "Express";
  if (files.some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) return ".NET";
  return "unknown";
}

function pickScript(pkg: PackageJsonInfo | null, candidates: string[]): string | null {
  if (!pkg) return null;
  for (const c of candidates) {
    if (pkg.scripts[c]) return c;
  }
  return null;
}

function classifyFile(rel: string): CandidateFile["kind"] {
  const lower = rel.toLowerCase();
  if (/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(lower)) return "test";

  // Path-segment matching, not substring matching: `lower.includes("/components/")`
  // requires a slash BEFORE "components", which is never true when components/
  // is a repo-root directory (the path starts "components/...", no leading
  // slash) - a very common layout (this exact bug hid a real login form: it
  // scored as "other" instead of "component" and got out-ranked in retrieval
  // by unrelated files). Splitting into segments handles root-level and
  // nested directories identically.
  const segments = lower.split("/");
  if (segments.includes("pages") || segments.includes("app")) return "page";
  if (segments.includes("routes") || segments.includes("api")) return "route";
  if (segments.includes("components")) return "component";
  if (/\.(config)\.(ts|js|mjs|cjs)$/.test(lower) || lower.endsWith(".config.ts")) return "config";
  // A UI file doesn't have to live under a components/ (or pages/) directory
  // at all - plenty of apps (create-react-app being the obvious one) put the
  // whole UI in src/App.js. Treat a PascalCase source file as a component so
  // it still ranks as UI rather than being written off as noise; kebab-case
  // component files (login-form.tsx) are already caught above as long as
  // they sit under *some* components/ directory, which is the overwhelmingly
  // common case for that naming convention.
  if (/(^|\/)[A-Z][A-Za-z0-9]*\.(tsx|jsx|ts|js|vue|svelte)$/.test(rel)) return "component";
  return "other";
}

export function analyzeRepository(rootDir: string): RepoAnalysis {
  const fileTree = walk(rootDir);
  const packageJson = readPackageJson(rootDir);
  const packageManager = detectPackageManager(rootDir);
  const framework = detectFramework(packageJson, fileTree);

  const devScript = pickScript(packageJson, ["dev", "start", "serve"]);
  const buildScript = pickScript(packageJson, ["build"]);
  const lintScript = pickScript(packageJson, ["lint"]);
  const testScript = pickScript(packageJson, ["test", "test:unit"]);

  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const hasPlaywright = Boolean(deps["@playwright/test"] ?? deps["playwright"]);
  const hasPlaywrightConfig = fileTree.some((f) => /playwright\.config\.(ts|js|mjs)$/.test(f));

  // Every source file is a candidate. Previously anything classified "other"
  // was dropped here, which silently emptied the candidate list for any repo
  // not using pages/ or components/ directories (e.g. create-react-app's
  // src/App.js) - retrieval then found nothing and the model wrote the
  // feature from the requirement text alone, never reading the repo.
  // Irrelevant files score 0 in retrieval and fall out there instead.
  const candidateFiles: CandidateFile[] = fileTree
    .filter((f) => /\.(ts|tsx|js|jsx|vue|svelte|html)$/.test(f))
    .map((f) => ({ path: f, kind: classifyFile(f) }));

  return {
    rootDir,
    framework,
    language: fileTree.some((f) => f.endsWith(".ts") || f.endsWith(".tsx")) ? "TypeScript" : "JavaScript",
    packageManager,
    packageJson,
    devScript,
    buildScript,
    lintScript,
    testScript,
    hasPlaywright,
    hasPlaywrightConfig,
    fileTree,
    candidateFiles,
  };
}
