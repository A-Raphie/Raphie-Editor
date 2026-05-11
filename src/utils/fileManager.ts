import fs from "fs/promises";
import path from "path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function cleanDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    await fs.mkdir(dirPath, { recursive: true });
  } catch {}
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {}
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getFreeDiskSpace(dirPath: string): Promise<number> {
  const { execFile } = require("child_process");
  const { promisify } = require("util");
  const execFileAsync = promisify(execFile);

  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      const { stdout } = await execFileAsync("df", ["-k", dirPath]);
      const lines = stdout.trim().split("\n");
      const parts = lines[1]?.split(/\s+/);
      return parseFloat(parts?.[3] ?? "0") * 1024;
    }
    return Infinity;
  } catch {
    return Infinity;
  }
}

export async function fileToBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

export async function getMimeType(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeMap[ext] ?? "image/jpeg";
}

export async function cleanupTempFiles(tempDir: string, except?: string[]): Promise<void> {
  try {
    const files = await fs.readdir(tempDir);
    for (const file of files) {
      const fullPath = path.join(tempDir, file);
      if (except?.includes(fullPath)) continue;
      await deleteFile(fullPath);
    }
  } catch {}
}
