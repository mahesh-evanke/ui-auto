import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Only used by the explicit, user-triggered Run step (never during
 * generation) - installs what's needed to actually execute the already-
 * generated tests. Writes to the target repo's node_modules/package-lock,
 * nothing else.
 */
export function ensureNodeModulesInstalled(rootDir: string, onLog: (line: string) => void): void {
  const nodeModules = path.join(rootDir, "node_modules");
  if (fs.existsSync(nodeModules)) return;
  onLog(`Installing dependencies in ${rootDir}...\n`);
  const out = execFileSync("npm", ["install"], { cwd: rootDir, shell: true, encoding: "utf-8" });
  onLog(out);
}

export function ensurePackageInstalled(rootDir: string, packageName: string, devFlag: boolean, onLog: (line: string) => void): void {
  const pkgDir = path.join(rootDir, "node_modules", ...packageName.split("/"));
  if (fs.existsSync(pkgDir)) return;
  onLog(`Installing ${packageName} in ${rootDir}...\n`);
  const args = ["install", devFlag ? "-D" : "-S", packageName];
  const out = execFileSync("npm", args, { cwd: rootDir, shell: true, encoding: "utf-8" });
  onLog(out);
}

export function ensureChromiumInstalled(rootDir: string, onLog: (line: string) => void): void {
  const out = execFileSync("npx", ["playwright", "install", "--with-deps", "chromium"], {
    cwd: rootDir,
    shell: true,
    encoding: "utf-8",
  });
  onLog(out);
}
