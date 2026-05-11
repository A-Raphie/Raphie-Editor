import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("src-electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("src-electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve("src-electron/renderer"),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: resolve("src-electron/renderer/index.html"),
      },
    },
    resolve: {
      alias: {
        "@": resolve("src-electron/renderer/src"),
      },
    },
  },
});
