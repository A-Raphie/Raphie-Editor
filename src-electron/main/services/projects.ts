import path from "path";
import fs from "fs";
import { app } from "electron";
import type { SavedProject } from "../../shared/types";
import { randomUUID } from "crypto";

function getProjectsPath(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function readProjects(): SavedProject[] {
  const p = getProjectsPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeProjects(projects: SavedProject[]): void {
  fs.writeFileSync(getProjectsPath(), JSON.stringify(projects, null, 2), "utf-8");
}

export function listProjects(): SavedProject[] {
  return readProjects().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getProject(id: string): SavedProject | undefined {
  return readProjects().find((p) => p.id === id);
}

export function saveProject(data: Partial<SavedProject> & { id?: string }): SavedProject {
  const projects = readProjects();
  const now = new Date().toISOString();

  if (data.id) {
    const idx = projects.findIndex((p) => p.id === data.id);
    if (idx !== -1) {
      projects[idx] = { ...projects[idx], ...data, updatedAt: now };
      writeProjects(projects);
      return projects[idx];
    }
  }

  const project: SavedProject = {
    id: randomUUID(),
    name: data.name || "Untitled Project",
    createdAt: now,
    updatedAt: now,
    scriptPath: data.scriptPath || "",
    voPath: data.voPath || "",
    musicPath: data.musicPath,
    srtPath: data.srtPath,
    scenePlan: data.scenePlan,
    status: data.status || "planning",
    outputPath: data.outputPath,
    modelTier: data.modelTier,
  };
  projects.push(project);
  writeProjects(projects);
  return project;
}

export function deleteProject(id: string): boolean {
  const projects = readProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  writeProjects(filtered);
  return true;
}

export function renameProject(id: string, name: string): SavedProject | undefined {
  const projects = readProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  project.name = name;
  project.updatedAt = new Date().toISOString();
  writeProjects(projects);
  return project;
}
