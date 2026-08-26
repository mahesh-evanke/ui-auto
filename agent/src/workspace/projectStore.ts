import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_WORKSPACE_DIR } from "../config.js";

/**
 * A Project groups every analysis run against one repository under a single
 * name, shown in the sidebar and at the top of the wizard - "every run will
 * be under one project" (per the enterprise-tool framing this app is being
 * built toward: many users, each adding their own repos, one project per
 * repo they add). One repo per project for now; `repo`/`cloneUrl` are single
 * fields rather than an array so a future multi-repo project is a additive
 * schema change, not a breaking one.
 */
export interface Project {
  id: string;
  name: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
  createdAt: string;
  /** Every analysis job (agent-workspace/<jobId>/) started against this project, most recent last. */
  jobIds: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..", "..");
const PROJECTS_DIR = path.join(toolRoot, AGENT_WORKSPACE_DIR, "projects");

function projectFilePath(id: string): string {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function timestampId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `proj_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

export function createProject(input: {
  name?: string;
  owner: string;
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
}): Project {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const project: Project = {
    id: timestampId(),
    name: input.name?.trim() || input.repo,
    owner: input.owner,
    repo: input.repo,
    cloneUrl: input.cloneUrl,
    defaultBranch: input.defaultBranch,
    createdAt: new Date().toISOString(),
    jobIds: [],
  };
  fs.writeFileSync(projectFilePath(project.id), JSON.stringify(project, null, 2), "utf-8");
  return project;
}

export function getProject(id: string): Project {
  const file = projectFilePath(id);
  if (!fs.existsSync(file)) {
    throw new Error(`No project found with id "${id}"`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Project;
}

/** Newest first - the sidebar's project list order. */
export function listProjects(): Project[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), "utf-8")) as Project)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addJobToProject(projectId: string, jobId: string): void {
  const project = getProject(projectId);
  if (!project.jobIds.includes(jobId)) {
    project.jobIds.push(jobId);
    fs.writeFileSync(projectFilePath(projectId), JSON.stringify(project, null, 2), "utf-8");
  }
}

export function renameProject(id: string, name: string): Project {
  const project = getProject(id);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name cannot be empty");
  project.name = trimmed;
  fs.writeFileSync(projectFilePath(id), JSON.stringify(project, null, 2), "utf-8");
  return project;
}

/**
 * Removes the project record only - the analysis jobs it grouped
 * (agent-workspace/<jobId>/, with their generated tests/reports/logs) are
 * left untouched on disk. A project is just a grouping label; deleting one
 * is meant to be a safe, low-stakes "tidy up the sidebar" action, not a
 * destructive data-loss one.
 */
export function deleteProject(id: string): void {
  const file = projectFilePath(id);
  if (!fs.existsSync(file)) {
    throw new Error(`No project found with id "${id}"`);
  }
  fs.unlinkSync(file);
}
