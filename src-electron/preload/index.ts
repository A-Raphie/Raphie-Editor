import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNELS } from "../shared/types";
import type { AppSettings, PipelineProgress, SavedProject, CandidatePreview } from "../shared/types";

const api = {
  runPipeline: (args: { scriptPath?: string; voPath: string; musicPath?: string; srtPath?: string; scenePlan?: any; projectId?: string; previewResolution?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.RUN_PIPELINE, args),

  resumePipeline: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESUME_PIPELINE, projectId),

  previewScenePlan: (scriptPath: string, voPath: string, projectId?: string, srtPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_SCENE_PLAN, scriptPath, voPath, projectId, srtPath),

  cancelPipeline: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PIPELINE),

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),

  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_SETTINGS, settings),

  selectFiles: (options?: { filters?: any[]; multiple?: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILES, options ?? {}),

  openInFinder: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_FINDER, filePath),

  generateThumbnail: (videoPath: string, projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GENERATE_THUMBNAIL, videoPath, projectId),

  exportSrt: (beats: any[], projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SRT, beats, projectId),

  getAssetPaths: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_ASSET_PATHS, projectId),

  getBeatThumbnail: (beatId: string, assetPath: string, projectId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_BEAT_THUMBNAIL, beatId, assetPath, projectId),

  reDownloadBeat: (beatId: string, searchQuery: string, beatType: string, projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RE_DOWNLOAD_BEAT, beatId, searchQuery, beatType, projectId),

  searchBeatCandidates: (beatId: string, searchQuery: string, beatType: string, projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SEARCH_BEAT_CANDIDATES, beatId, searchQuery, beatType, projectId),

  downloadSelectedCandidate: (beatId: string, candidate: CandidatePreview, projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_SELECTED_CANDIDATE, beatId, candidate, projectId),

  getBeatTextSegments: (beats: any[], scriptPath?: string, srtPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_BEAT_TEXT_SEGMENTS, beats, scriptPath, srtPath),

  getModelUptime: (model: string): Promise<number | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MODEL_UPTIME, model),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  onProgress: (callback: (progress: PipelineProgress) => void) => {
    const handler = (_: any, data: PipelineProgress) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PIPELINE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PIPELINE_PROGRESS, handler);
  },

  onLog: (callback: (entry: string) => void) => {
    const handler = (_: any, data: string) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PIPELINE_LOG, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PIPELINE_LOG, handler);
  },

  onComplete: (callback: (outputPath: string) => void) => {
    const handler = (_: any, path: string) => callback(path);
    ipcRenderer.on(IPC_CHANNELS.PIPELINE_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PIPELINE_COMPLETE, handler);
  },

  onError: (callback: (error: string) => void) => {
    const handler = (_: any, error: string) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.PIPELINE_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PIPELINE_ERROR, handler);
  },

  onScenePlanReady: (callback: (plan: any) => void) => {
    const handler = (_: any, plan: any) => callback(plan);
    ipcRenderer.on(IPC_CHANNELS.SCENE_PLAN_READY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SCENE_PLAN_READY, handler);
  },

  onAssetDownloaded: (callback: (assets: Record<string, string>) => void) => {
    const handler = (_: any, assets: Record<string, string>) => callback(assets);
    ipcRenderer.on(IPC_CHANNELS.ASSET_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ASSET_DOWNLOADED, handler);
  },

  onBeatStatus: (callback: (beatId: string, status: string, downloadPercent?: number, error?: string, errorDetails?: string) => void) => {
    const handler = (_: any, beatId: string, status: string, downloadPercent?: number, error?: string, errorDetails?: string) => callback(beatId, status, downloadPercent, error, errorDetails);
    ipcRenderer.on(IPC_CHANNELS.BEAT_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BEAT_STATUS, handler);
  },

  validateAllAssets: (beats: any[], assets: Record<string, string>, projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_ALL_ASSETS, beats, assets, projectId),

  recoverAssets: (beats: any[], projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RECOVER_ASSETS, beats, projectId),

  updatePipelineStatus: (projectId: string, status: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_PIPELINE_STATUS, projectId, status),

  renderVideo: (projectId: string, scriptPath: string, voPath: string, musicPath: string, mode: string, srtPath: string, previewResolution?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.RENDER_VIDEO, projectId, scriptPath, voPath, musicPath, mode, srtPath, previewResolution),

  sourceAllAssets: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCE_ALL_ASSETS, projectId),

  cleanAssets: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CLEAN_ASSETS, projectId),

  previewClean: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_CLEAN, projectId),

  getScriptText: (scriptPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SCRIPT_TEXT, scriptPath),

  saveScenePlan: (projectId: string, scenePlan: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_SCENE_PLAN, projectId, scenePlan),

  listProjects: (): Promise<SavedProject[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_PROJECTS),

  getProject: (id: string): Promise<SavedProject | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_PROJECT, id),

  saveProject: (data: Partial<SavedProject>): Promise<SavedProject> =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROJECT, data),

  deleteProject: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_PROJECT, id),

  renameProject: (id: string, name: string): Promise<SavedProject | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.RENAME_PROJECT, id, name),

  getPipelineState: (projectId: string, scriptPath: string, voPath: string, srtPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_PIPELINE_STATE, projectId, scriptPath, voPath, srtPath),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("api", api);
