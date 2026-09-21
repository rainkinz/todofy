import { useEffect, useState } from "preact/hooks";
import { useUpdater } from "../lib/updater";
import { DownloadIcon, RotateIcon } from "./Icons";

/** True while the window is actually on screen rather than sitting in the tray. */
function useOnScreen(): boolean {
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

/**
 * Asks before an automatic update downloads, and again before it restarts.
 *
 * Both questions are deliberately never answered on the user's behalf: a
 * download eats bandwidth they may be paying for, and a relaunch would throw
 * away whatever is half-typed in a task or note.
 *
 * Rendered from the app shell rather than Settings so a background check can
 * reach the user wherever they are, and so the answer survives navigation.
 */
export function UpdateDialog() {
  const {
    state,
    version,
    notes,
    promptVersion,
    restartDismissed,
    acceptPrompt,
    declinePrompt,
    dismissRestart,
    restart,
  } = useUpdater();
  const onScreen = useOnScreen();

  const asking = !!promptVersion && state === "available";
  const finished = state === "ready" && restartDismissed !== version;
  // Holding both until the window is on screen keeps a prompt from being
  // spent while todofy is in the tray, where nobody would ever see it.
  const open = onScreen && (asking || finished);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (asking) declinePrompt();
      else dismissRestart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, asking]);

  if (!open) return null;

  const close = () => (asking ? declinePrompt() : dismissRestart());

  return (
    <div
      class="fixed inset-0 z-110 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
      role="dialog"
      aria-modal="true"
      aria-label={asking ? "Update available" : "Update installed"}
    >
      <div class="w-full max-w-md animate-fade-rise rounded-xl border border-border-strong bg-elevated p-5 shadow-2xl shadow-black/50">
        <div class="flex items-start gap-3">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-(--color-accent)">
            {asking ? (
              <DownloadIcon width={18} height={18} />
            ) : (
              <RotateIcon width={18} height={18} />
            )}
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-text">
              {asking
                ? `todofy v${promptVersion} is available`
                : `todofy v${version} is installed`}
            </h3>
            <p class="mt-1.5 text-sm leading-relaxed text-muted">
              {asking
                ? "Download and install it now? todofy keeps running while it downloads."
                : "Restart to start using it. Your tasks and timers are saved either way."}
            </p>
          </div>
        </div>

        {asking && notes && (
          <div class="mt-4 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface p-3">
            <p class="text-xs font-semibold text-faint uppercase">What's new</p>
            <p class="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-muted">
              {notes}
            </p>
          </div>
        )}

        <div class="mt-5 flex justify-end gap-2">
          <button
            onClick={close}
            class="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            {asking ? "Not now" : "Later"}
          </button>
          <button
            onClick={() => void (asking ? acceptPrompt() : restart())}
            autoFocus
            class="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {asking ? "Update now" : "Restart now"}
          </button>
        </div>
      </div>
    </div>
  );
}
