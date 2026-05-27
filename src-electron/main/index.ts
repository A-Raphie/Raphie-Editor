import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { registerIpcHandlers } from "./ipc-handlers";
import { ensureProjectDirs } from "./services/paths";
import { runPeriodicCleanup } from "./services/cleanup";

if (app.isPackaged) {
  const origChmodSync = fs.chmodSync;
  fs.chmodSync = function (p: fs.PathLike, mode: fs.Mode) {
    try {
      return origChmodSync.call(this, p, mode);
    } catch (err: any) {
      if (err.code === "ENOTDIR") return;
      throw err;
    }
  };
}

ensureProjectDirs();

if (app.isPackaged) {
  const arch = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  process.env.ESBUILD_BINARY_PATH = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    `node_modules/@esbuild/${arch}/bin/esbuild`
  );
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("Renderer loaded successfully");
  });
}

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers(mainWindow!);

  try {
    const settingsPath = path.join(app.getPath("userData"), "settings.json");
    if (fs.existsSync(settingsPath)) {
      runPeriodicCleanup(
        JSON.parse(fs.readFileSync(settingsPath, "utf-8")).cleanupAfterDays ?? 0
      );
    }
  } catch {}

  app.on("activate", () => {
    if (mainWindow === null) {
      createWindow();
      registerIpcHandlers(mainWindow!);
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
