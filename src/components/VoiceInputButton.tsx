import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { listen } from "@tauri-apps/api/event";
import { CloseIcon, MicrophoneIcon, StopIcon } from "./Icons";
import { voiceApi, voiceError, type VoiceStatus } from "../lib/voice";

const WAVE_BARS = 58;
const EMPTY_WAVE = Array<number>(WAVE_BARS).fill(0);

interface Props {
  kind: "task" | "journal";
  onTranscript: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
  getPanelHost: () => HTMLElement | null;
  compactWindow?: boolean;
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceInputButton({
  kind,
  onTranscript,
  onBusyChange,
  getPanelHost,
  compactWindow = false,
}: Props) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "transcribing" | "cancelling"
  >("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [waveform, setWaveform] = useState(EMPTY_WAVE);
  const phaseRef = useRef(phase);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const cancelledRef = useRef(false);
  onTranscriptRef.current = onTranscript;

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (meterRef.current) clearInterval(meterRef.current);
    meterRef.current = null;
  };

  const updatePhase = (next: typeof phase) => {
    phaseRef.current = next;
    setPhase(next);
    onBusyChange?.(next !== "idle");
  };

  useEffect(() => {
    let active = true;
    const load = () =>
      void voiceApi
        .status()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {});
    load();
    window.addEventListener("focus", load);
    const unlisten = listen("voice-settings-changed", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      void unlisten.then((dispose) => dispose());
      clearTimer();
      if (phaseRef.current !== "idle") {
        cancelledRef.current = true;
        void voiceApi.cancel().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (status && !status.ready && phaseRef.current !== "idle") {
      cancelledRef.current = true;
      clearTimer();
      setWaveform(EMPTY_WAVE);
      void voiceApi.cancel().catch(() => {});
      updatePhase("idle");
    }
  }, [status?.ready]);

  const finish = async () => {
    if (phaseRef.current !== "recording") return;
    clearTimer();
    updatePhase("transcribing");
    try {
      const text = await voiceApi.stop();
      if (!cancelledRef.current) onTranscriptRef.current(text);
    } catch (e) {
      if (!cancelledRef.current) setError(voiceError(e));
    } finally {
      setWaveform(EMPTY_WAVE);
      updatePhase("idle");
    }
  };

  const cancel = () => {
    const interrupted = phaseRef.current;
    if (interrupted === "idle" || interrupted === "cancelling") return;
    cancelledRef.current = true;
    clearTimer();
    updatePhase("cancelling");
    void voiceApi
      .cancel()
      .catch(() => {})
      .finally(() => {
        if (interrupted === "recording" && phaseRef.current === "cancelling") {
          setWaveform(EMPTY_WAVE);
          updatePhase("idle");
        }
      });
  };

  useEffect(() => {
    if (phase === "idle" || phase === "cancelling") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [phase]);

  const action = async () => {
    if (
      phaseRef.current === "starting" ||
      phaseRef.current === "transcribing" ||
      phaseRef.current === "cancelling"
    )
      return;
    setError("");
    if (phaseRef.current === "idle") {
      cancelledRef.current = false;
      setElapsed(0);
      setWaveform(EMPTY_WAVE);
      updatePhase("starting");
      try {
        await voiceApi.start(kind);
        if (cancelledRef.current) {
          await voiceApi.cancel();
          updatePhase("idle");
          return;
        }
        updatePhase("recording");
        const began = Date.now();
        const limit = kind === "task" ? 45 : 180;
        timerRef.current = setInterval(() => {
          const seconds = Math.floor((Date.now() - began) / 1000);
          setElapsed(seconds);
          if (seconds >= limit && phaseRef.current === "recording")
            void finish();
        }, 1000);
        meterRef.current = setInterval(() => {
          void voiceApi
            .level()
            .then((next) => {
              if (phaseRef.current === "recording") {
                const amplitude =
                  next < 0.012 ? 0 : Math.min(1, Math.sqrt(next) * 1.8);
                setWaveform((samples) => [...samples.slice(1), amplitude]);
              }
            })
            .catch(() => {});
        }, 110);
      } catch (e) {
        if (!cancelledRef.current) setError(voiceError(e));
        updatePhase("idle");
      }
      return;
    }
    await finish();
  };

  if (!status?.ready) return null;
  const panelHost = getPanelHost();

  return (
    <>
      <span class="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void action()}
          disabled={phase !== "idle"}
          aria-label={
            phase === "idle" ? "Start dictation" : "Voice dictation in progress"
          }
          title={
            phase === "idle" ? "Dictate locally" : "Voice dictation in progress"
          }
          class="voice-trigger"
        >
          <MicrophoneIcon width={18} height={18} />
        </button>
        {error && (
          <span
            role="alert"
            class="max-w-48 text-xs text-(--color-danger)"
            title={error}
          >
            {error}
          </span>
        )}
      </span>
      {phase !== "idle" &&
        panelHost &&
        createPortal(
          <div
            class={`voice-capture voice-capture--${phase} ${compactWindow ? "voice-capture--compact" : ""}`}
            role="region"
            aria-label="Voice dictation"
          >
            <button
              type="button"
              class="voice-capture-action voice-capture-cancel"
              onClick={cancel}
              disabled={phase === "cancelling"}
              aria-label="Cancel dictation"
              title="Cancel dictation (Esc)"
            >
              <CloseIcon width={18} height={18} />
            </button>
            {phase === "recording" ? (
              <>
                <div class="voice-capture-track">
                  <div class="voice-capture-bars" aria-hidden="true">
                    {waveform.map((amplitude, index) => (
                      <span
                        key={index}
                        class="voice-capture-bar"
                        style={{
                          height: `${3 + amplitude * 34}px`,
                          opacity: amplitude ? 1 : 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <span
                  class="voice-capture-time"
                  aria-label={`Recording time ${formatElapsed(elapsed)}`}
                >
                  {formatElapsed(elapsed)}
                </span>
                <button
                  type="button"
                  class="voice-capture-action voice-capture-finish"
                  onClick={() => void finish()}
                  aria-label="Stop and transcribe"
                  title="Stop and insert editable text"
                >
                  <StopIcon width={18} height={18} />
                </button>
              </>
            ) : (
              <>
                <span class="voice-capture-message" role="status">
                  {phase === "starting"
                    ? "Opening microphone…"
                    : phase === "transcribing"
                      ? "Transcribing"
                      : "Cancelling…"}
                </span>
                <span
                  class="voice-capture-action voice-capture-wait"
                  aria-hidden="true"
                >
                  <span class="voice-capture-spinner" />
                </span>
              </>
            )}
          </div>,
          panelHost,
        )}
    </>
  );
}
