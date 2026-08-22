import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { JobPaths } from "../types.js";

export interface ResolvedRepo {
  rootDir: string;
  branch: string;
  clonedByTool: boolean;
}

function isGitUrl(input: string): boolean {
  return /^(https?:\/\/|git@)/i.test(input);
}

function currentBranch(dir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Resolves --repo into a local directory. The source repo is treated as
 * read-only: if it's a local path we use it in place (only ever adding
 * files under tests/e2e-generated/ later); if it's a git URL we clone a
 * fresh copy into the job workspace so the user's original checkout is
 * never touched.
 *
 * When githubToken is supplied (private repos accessed via the web UI's
 * GitHub sign-in), it's passed to git as a transient `-c http.extraHeader`
 * Basic-auth value (git's smart-HTTP transport requires Basic, not Bearer -
 * the GitHub REST API accepts Bearer but the git-over-HTTPS endpoint does
 * not) - never written to .git/config. If the clone fails, the thrown error
 * is re-thrown with a sanitized message: Node's execFileSync failure message
 * otherwise echoes back the full argv (including the extraHeader) verbatim,
 * which would leak the token into logs/UI - see the catch block below.
 */
export function resolveRepository(
  input: string,
  branch: string | undefined,
  paths: JobPaths,
  githubToken?: string
): ResolvedRepo {
  if (isGitUrl(input)) {
    const args = ["clone", "--depth", "1"];
    if (githubToken) {
      const basic = Buffer.from(`x-access-token:${githubToken}`).toString("base64");
      args.push("-c", `http.extraHeader=AUTHORIZATION: basic ${basic}`);
    }
    if (branch) args.push("--branch", branch);
    args.push(input, paths.repository);
    try {
      execFileSync("git", args, { stdio: "pipe" });
    } catch (err) {
      const stderr = err instanceof Error && "stderr" in err ? String((err as any).stderr ?? "") : "";
      throw new Error(`git clone failed for ${input} (branch: ${branch ?? "default"}).${stderr ? ` ${stderr.trim()}` : ""}`);
    }
    return {
      rootDir: paths.repository,
      branch: branch ?? currentBranch(paths.repository),
      clonedByTool: true,
    };
  }

  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) {
    throw new Error(`Repository path does not exist: ${abs}`);
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${abs}`);
  }
  const resolvedBranch = branch ?? currentBranch(abs);
  return { rootDir: abs, branch: resolvedBranch, clonedByTool: false };
}
