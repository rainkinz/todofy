import { useEffect, useState } from "preact/hooks";
import { emit, listen } from "@tauri-apps/api/event";
import {
  CheckCircleIcon,
  DownloadIcon,
  MicrophoneIcon,
  TrashIcon,
} from "./Icons";
import {
  voiceApi,
  voiceError,
  type VoiceDownloadProgress,
  type VoiceStatus,
} from "../lib/voice";

const MODELS = [
  {
    id: "base",
    label: "Base · multilingual",
    size: "About 142 MB",
    detail: "Recommended for better accuracy across supported languages.",
  },
  {
    id: "tiny",
    label: "Tiny · multilingual",
    size: "About 75 MB",
    detail: "Smaller and faster, with lower accuracy.",
  },
] as const;

export function VoiceSettingsSection() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<VoiceDownloadProgress | null>(null);

  useEffect(() => {
    void voiceApi
      .status()
      .then(setStatus)
      .catch((e) => setError(voiceError(e)));
    const unlisten = listen<VoiceDownloadProgress>(
      "voice-download-progress",
      (event) => setProgress(event.payload),
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const run = async (name: string, action: () => Promise<VoiceStatus>) => {
    setBusy(name);
    setError("");
    setProgress(null);
    try {
      setStatus(await action());
      await emit("voice-settings-changed");
    } catch (e) {
      setError(voiceError(e));
      void voiceApi
        .status()
        .then(setStatus)
        .catch(() => {});
    } finally {
      setBusy("");
      setProgress(null);
    }
  };

  const buttonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50";
  const installed = status?.modelsInstalled[status.selectedModel] ?? false;
  const updateAvailable = !!status?.updateVersion;
  const targetEngineInstalled = updateAvailable
    ? status.updateEngineInstalled
    : status?.engineInstalled;
  const downloadLabel =
    busy === "engine"
      ? "Voice engine"
      : busy === "base"
        ? "Base model"
        : "Tiny model";
  const downloadPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((100 * progress.received) / progress.total))
      : 0;
  const downloadProgress = busy && progress && (
    <div class="voice-download-progress">
      <div class="flex items-center justify-between gap-3">
        <span>
          {downloadLabel} · {downloadPercent}% ·{" "}
          {Math.round(progress.received / 1024 / 1024)} /{" "}
          {Math.round(progress.total / 1024 / 1024)} MB
        </span>
        <button
          type="button"
          onClick={() => void voiceApi.cancelDownload()}
          class="shrink-0 font-medium text-(--color-accent) hover:underline"
        >
          Cancel
        </button>
      </div>
      <div
        class="voice-download-track"
        role="progressbar"
        aria-label={`${downloadLabel} download`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={downloadPercent}
      >
        <div style={{ width: `${downloadPercent}%` }} />
      </div>
    </div>
  );

  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        Voice
      </h3>
      <div class="overflow-hidden rounded-xl border border-border bg-surface">
        <div class="flex items-start gap-3 px-4 py-4">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-color-accent">
            <MicrophoneIcon width={18} height={18} />
          </span>
          <div>
            <p class="mt-1 text-xs text-muted">
              Optional and off by default. Download the engine and a
              multilingual model only if you want to dictate tasks or journal
              entries. Speech stays on this device, the spoken language is
              detected automatically, and drafts stay editable before you save.
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted">
          <span>
            {status?.developmentAssets
              ? "Using local test files in this debug build."
              : status?.updateVersion
                ? `Voice update v${status.updateVersion} available. Your current voice setup stays active while it downloads.`
                : status?.catalogVersion
                  ? `Voice catalog v${status.catalogVersion}`
                  : "Voice catalog loads when you choose a download."}
          </span>
          {!status?.developmentAssets && (
            <button
              class={buttonClass}
              disabled={!!busy}
              onClick={() => void run("catalog", voiceApi.refreshCatalog)}
            >
              Check for updates
            </button>
          )}
        </div>

        {status?.developmentAssets && (
          <p class="border-t border-border px-4 py-3 text-xs text-muted">
            Choose Tiny below, then enable Voice Mode. Local files are used only
            for testing; download and removal controls are available with a
            published voice catalog.
          </p>
        )}

        {!status?.platformSupported && status && (
          <p class="border-t border-border px-4 py-3 text-xs text-(--color-danger)">
            Voice downloads are not available for this platform yet.
          </p>
        )}

        <div class="voice-engine-row">
          <span class="voice-engine-mark" aria-hidden="true">
            <DownloadIcon width={18} height={18} />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-text">Voice engine</p>
            <p class="mt-0.5 text-xs text-muted">
              Local speech processing by whisper.cpp · separate optional
              download
            </p>
          </div>
          <div class="voice-engine-actions">
            {targetEngineInstalled ? (
              <span class="voice-engine-installed">
                <CheckCircleIcon width={16} height={16} /> Installed
              </span>
            ) : (
              <button
                type="button"
                class="voice-engine-download"
                disabled={
                  !!busy ||
                  !status?.platformSupported ||
                  status?.developmentAssets
                }
                onClick={() =>
                  void run("engine", () => voiceApi.download("engine"))
                }
              >
                <DownloadIcon width={17} height={17} />
                <span>
                  {busy === "engine"
                    ? "Downloading…"
                    : status?.engineInstalled
                      ? "Update voice engine"
                      : "Download voice engine"}
                </span>
              </button>
            )}
            {!status?.developmentAssets &&
              (status?.engineInstalled || status?.updateEngineInstalled) && (
                <button
                  type="button"
                  class={buttonClass}
                  disabled={!!busy}
                  onClick={() =>
                    void run("remove-engine", () => voiceApi.remove("engine"))
                  }
                  aria-label="Remove voice engine"
                  title="Remove voice engine"
                >
                  <TrashIcon width={14} height={14} />
                </button>
              )}
          </div>
        </div>
        {busy === "engine" && downloadProgress}

        <div class="border-t border-border px-4 py-3.5">
          <p class="mb-2 text-sm font-medium">Speech model</p>
          <div class="flex flex-col gap-2">
            {MODELS.map((model) => (
              <div
                key={model.id}
                class="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="radio"
                  name="voice-model"
                  value={model.id}
                  checked={(status?.selectedModel ?? "base") === model.id}
                  disabled={!!busy || !status}
                  onChange={() =>
                    void run(`select-${model.id}`, () =>
                      voiceApi.setModel(model.id),
                    )
                  }
                  aria-label={`Select ${model.label}`}
                />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium">
                    {model.label}{" "}
                    <span class="font-normal text-faint">
                      · {status?.developmentAssets ? "Local file" : model.size}
                    </span>
                  </p>
                  <p class="text-[11px] text-muted">{model.detail}</p>
                </div>
                {(
                  updateAvailable
                    ? status?.updateModelsInstalled[model.id]
                    : status?.modelsInstalled[model.id]
                ) ? (
                  <span class="text-[11px] text-(--color-accent)">
                    Installed
                  </span>
                ) : (
                  <button
                    class={buttonClass}
                    disabled={
                      !!busy ||
                      !status?.platformSupported ||
                      status?.developmentAssets
                    }
                    onClick={() =>
                      void run(model.id, () =>
                        voiceApi.download("model", model.id),
                      )
                    }
                  >
                    {busy === model.id
                      ? "Downloading…"
                      : status?.modelsInstalled[model.id]
                        ? "Update"
                        : "Download"}
                  </button>
                )}
                {!status?.developmentAssets &&
                  (status?.modelsInstalled[model.id] ||
                    status?.updateModelsInstalled[model.id]) && (
                    <button
                      class={buttonClass}
                      disabled={!!busy}
                      onClick={() =>
                        void run(`remove-${model.id}`, () =>
                          voiceApi.remove("model", model.id),
                        )
                      }
                      aria-label={`Remove ${model.label}`}
                    >
                      <TrashIcon width={13} height={13} />
                    </button>
                  )}
              </div>
            ))}
          </div>
        </div>

        {busy !== "engine" && downloadProgress}

        <div class="flex items-center gap-3 border-t border-border px-4 py-3.5">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">Voice Mode</p>
            <p class="text-xs text-muted">
              Show microphone controls in task capture and journal editors.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status?.enabled ?? false}
            disabled={
              !!busy ||
              (!status?.enabled && (!status?.engineInstalled || !installed))
            }
            onClick={() =>
              void run("mode", () => voiceApi.setMode(!status?.enabled))
            }
            class={`relative inline-flex h-6 w-11 items-center rounded-full disabled:opacity-50 ${status?.enabled ? "bg-(--color-accent)" : "bg-surface-2"}`}
          >
            <span
              class={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${status?.enabled ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>
        {status?.engineInstalled && !installed && !status.enabled && (
          <p class="border-t border-border px-4 py-3 text-xs text-muted">
            Select an installed speech model above to enable Voice Mode.
          </p>
        )}

        {!status?.developmentAssets &&
          (status?.engineInstalled ||
            status?.modelsInstalled.base ||
            status?.modelsInstalled.tiny ||
            status?.updateEngineInstalled ||
            status?.updateModelsInstalled.base ||
            status?.updateModelsInstalled.tiny) && (
            <div class="border-t border-border px-4 py-3">
              <button
                class="text-xs text-(--color-danger) hover:underline disabled:opacity-50"
                disabled={!!busy}
                onClick={() =>
                  void run("remove-all", () => voiceApi.remove("all"))
                }
              >
                Remove all voice downloads
              </button>
            </div>
          )}
        {error && (
          <p
            role="alert"
            class="border-t border-border px-4 py-3 text-xs text-(--color-danger)"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
