import { invoke } from "@tauri-apps/api/core";

export interface VoiceStatus {
  enabled: boolean;
  ready: boolean;
  engineInstalled: boolean;
  modelsInstalled: Record<"tiny" | "base", boolean>;
  selectedModel: "tiny" | "base";
  catalogVersion: string | null;
  updateVersion: string | null;
  updateEngineInstalled: boolean;
  updateModelsInstalled: Record<"tiny" | "base", boolean>;
  platformSupported: boolean;
  developmentAssets: boolean;
}

export interface VoiceDownloadProgress {
  asset: string;
  received: number;
  total: number;
}

export const voiceApi = {
  status: () => invoke<VoiceStatus>("voice_status"),
  level: () => invoke<number>("voice_input_level"),
  refreshCatalog: () => invoke<VoiceStatus>("voice_catalog_refresh"),
  download: (kind: "engine" | "model", model?: "tiny" | "base") =>
    invoke<VoiceStatus>("voice_asset_download", { kind, model }),
  cancelDownload: () => invoke<void>("voice_asset_cancel"),
  remove: (kind: "engine" | "model" | "all", model?: "tiny" | "base") =>
    invoke<VoiceStatus>("voice_asset_remove", { kind, model }),
  setMode: (enabled: boolean) => invoke<VoiceStatus>("voice_mode_set", { enabled }),
  setModel: (model: "tiny" | "base") => invoke<VoiceStatus>("voice_model_set", { model }),
  start: (kind: "task" | "journal") => invoke<void>("voice_record_start", { kind }),
  stop: () => invoke<string>("voice_record_stop"),
  cancel: () => invoke<void>("voice_record_cancel"),
};

export function voiceError(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Voice input failed. Please try again.";
}

export function insertTranscript(value: string, transcript: string, start: number, end: number) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const left = before && !/\s$/.test(before) ? " " : "";
  const right = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${left}${transcript}${right}`;
  return { value: before + inserted + after, caret: start + inserted.length };
}
