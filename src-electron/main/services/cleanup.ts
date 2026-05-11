import path from "path";
import fs from "fs";
import { getProjectRoot } from "./paths";

export function runPeriodicCleanup(cleanupAfterDays: number): void {
  if (!cleanupAfterDays || cleanupAfterDays <= 0) return;

  const maxAgeMs = cleanupAfterDays * 86400000;
  const now = Date.now();
  const root = getProjectRoot();
  const projectsDir = path.join(root, "projects");

  if (!fs.existsSync(projectsDir)) return;

  let deletedCount = 0;
  const entries = fs.readdirSync(projectsDir);

  for (const entry of entries) {
    const outputDir = path.join(projectsDir, entry, "output");
    if (!fs.existsSync(outputDir)) continue;

    for (const subDir of ["clips", "images"]) {
      const dirPath = path.join(outputDir, subDir);
      if (!fs.existsSync(dirPath)) continue;

      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {}
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[Cleanup] Deleted ${deletedCount} file(s) older than ${cleanupAfterDays} day(s)`);
  }
}
