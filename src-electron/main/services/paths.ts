import path from "path";
import fs from "fs";
import { app } from "electron";

function getBinaryPath(name: string): string {
  if (app.isPackaged) {
    const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
    const bundled = path.join(process.resourcesPath, arch, name);
    if (fs.existsSync(bundled)) return bundled;
  }
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return require("child_process").execSync(`which ${name}`, { encoding: "utf-8" }).trim() || name;
}

export function getFfmpegPath(): string {
  return getBinaryPath("ffmpeg");
}

export function getFfprobePath(): string {
  return getBinaryPath("ffprobe");
}

export function getProjectRoot(): string {
  if (app.isPackaged) {
    return path.join(app.getPath("home"), "Raphie's Editor");
  }
  return path.resolve(__dirname, "../..");
}

export function getProjectDir(projectId: string): string {
  return path.join(getProjectRoot(), "projects", projectId);
}

export function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function getOutputDir(projectId?: string): string {
  if (projectId) return path.join(getProjectDir(projectId), "output");
  return path.join(getProjectRoot(), "output");
}

export function getTempDir(projectId?: string): string {
  if (projectId) return path.join(getProjectDir(projectId), "output", "temp");
  return path.join(getProjectRoot(), "output", "temp");
}

export function getClipsDir(projectId?: string): string {
  if (projectId) return path.join(getProjectDir(projectId), "output", "clips");
  return path.join(getProjectRoot(), "output", "clips");
}

export function getImagesDir(projectId?: string): string {
  if (projectId) return path.join(getProjectDir(projectId), "output", "images");
  return path.join(getProjectRoot(), "output", "images");
}

export function getLogDir(projectId?: string): string {
  if (projectId) return path.join(getProjectDir(projectId), "output", "logs");
  return path.join(getProjectRoot(), "output", "logs");
}

export function getAssetsDir(): string {
  return path.join(getProjectRoot(), "assets");
}

export function getInputDir(): string {
  return path.join(getProjectRoot(), "input");
}

export function getAppSourceBase(): string {
  if (app.isPackaged) {
    return app.getAppPath().replace(/\.asar$/, ".asar.unpacked");
  }
  return path.resolve(__dirname, "../..");
}

export function getRemotionEntryPath(): string {
  return path.resolve(getAppSourceBase(), "src/remotion/index.ts");
}

export function getRemotionPublicDir(): string {
  return path.resolve(getAppSourceBase(), "assets");
}

export function getVfxPath(): string {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, "vfx", "subscribe.mp4");
    if (fs.existsSync(p)) return p;
  }
  const devPath = path.resolve(__dirname, "../../../assets/vfx/subscribe.mp4");
  if (fs.existsSync(devPath)) return devPath;
  return "";
}

export function ensureProjectDirs(projectId?: string): void {
  const dirs = [
    getProjectRoot(),
    getInputDir(),
    getAssetsDir(),
    ...(projectId
      ? [
          getProjectDir(projectId),
          getOutputDir(projectId),
          getTempDir(projectId),
          getClipsDir(projectId),
          getImagesDir(projectId),
          getLogDir(projectId),
        ]
      : [
          getOutputDir(),
          getTempDir(),
          getClipsDir(),
          getImagesDir(),
          getLogDir(),
        ]),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
