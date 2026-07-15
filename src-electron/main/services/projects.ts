import path from "path";
import fs from "fs";
import { app } from "electron";
import type { SavedProject } from "../../shared/types";
import { randomUUID } from "crypto";
import { getProjectDir, getProjectRoot, refreshSlugCache } from "../services/paths";

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
  refreshSlugCache(); // keep paths.ts id→slug cache fresh
}

// Slugify a name into a safe, readable folder name.
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → -
    .replace(/^-+|-+$/g, "") // trim leading/trailing -
    .slice(0, 60);
  return slug || "untitled-project";
}

// Ensure slug uniqueness against existing projects (excluding a given id).
function uniqueSlug(name: string, projects: SavedProject[], excludeId?: string): string {
  const base = slugify(name);
  const existing = new Set(
    projects.filter((p) => p.id !== excludeId && p.slug).map((p) => p.slug)
  );
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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
      const prev = projects[idx];
      // Recompute slug if the name changed.
      const newName = data.name ?? prev.name;
      const newSlug = uniqueSlug(newName, projects, prev.id);
      if (prev.slug && prev.slug !== newSlug) {
        // Folder rename: move the old folder to the new slug.
        try {
          const oldDir = getProjectDir(prev.id);
          // Temporarily clear the slug cache so getProjectDir returns the old folder.
          const newDir = path.join(path.dirname(oldDir), newSlug);
          if (fs.existsSync(oldDir) && oldDir !== newDir) {
            fs.renameSync(oldDir, newDir);
            clearStalePipelinePaths(newDir);
          }
        } catch {}
      }
      projects[idx] = { ...prev, ...data, slug: newSlug, updatedAt: now };
      writeProjects(projects);
      return projects[idx];
    }
  }

  const name = data.name || "Untitled Project";
  const slug = uniqueSlug(name, projects);

  // If this slug's directory already exists (from a deleted project), wipe
  // the old pipeline_state.json and scene_plan.json so stale assets from a
  // previous video don't contaminate the new one.
  const projectDir = path.join(getProjectRoot(), "projects", slug);
  const outputDir = path.join(projectDir, "output");
  if (fs.existsSync(outputDir)) {
    try {
      const stateFile = path.join(outputDir, "pipeline_state.json");
      if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
      const scenePlanFile = path.join(outputDir, "scene_plan.json");
      if (fs.existsSync(scenePlanFile)) fs.unlinkSync(scenePlanFile);
    } catch {}
  }

  const project: SavedProject = {
    id: randomUUID(),
    name,
    slug,
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
    beatCandidates: data.beatCandidates,
    selectedCandidateIndex: data.selectedCandidateIndex,
    assets: data.assets,
  };
  projects.push(project);
  writeProjects(projects);
  return project;
}

// Clear stale absolute paths in pipeline_state.json so the recovery logic
// (ipc-handlers.ts) rebuilds them relative to the new folder on next open.
function clearStalePipelinePaths(projectDir: string): void {
  const statePath = path.join(projectDir, "output", "pipeline_state.json");
  if (!fs.existsSync(statePath)) return;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    if (state.assets) state.assets = {};
    if (state.renderSegments) state.renderSegments.segmentDir = undefined;
    state.outputPath = undefined;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

export function deleteProject(id: string): boolean {
  const projects = readProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  writeProjects(filtered);
  try {
    const dir = getProjectDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  return true;
}

export function renameProject(id: string, name: string): SavedProject | undefined {
  // Delegate to saveProject so the folder moves + slug updates happen centrally.
  return saveProject({ id, name });
}

// One-time migration: rename existing UUID folders to slugs.
export function migrateSlugs(): void {
  const projects = readProjects();
  if (projects.length === 0) return;
  const projectsRoot = path.join(path.dirname(getProjectDir("__probe__")), "");
  let changed = false;

  for (const p of projects) {
    // Skip if already has a slug AND the slug folder exists.
    if (p.slug && fs.existsSync(path.join(projectsRoot, p.slug))) continue;

    // Determine the source folder: the slug folder if it exists, else the UUID folder.
    const uuidDir = path.join(projectsRoot, p.id);
    // Prefer the name; fall back to scenePlan.title if name is generic.
    let name = p.name;
    if ((!name || name === "Untitled Project") && p.scenePlan?.title) {
      name = p.scenePlan.title;
    }
    const slug = uniqueSlug(name, projects, p.id);
    const slugDir = path.join(projectsRoot, slug);

    // If the UUID folder exists, rename it to the slug.
    if (fs.existsSync(uuidDir) && !fs.existsSync(slugDir)) {
      try {
        fs.renameSync(uuidDir, slugDir);
        clearStalePipelinePaths(slugDir);
      } catch {}
    }
    p.slug = slug;
    changed = true;
  }

  if (changed) {
    writeProjects(projects);
  }
}
