import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";

export const RELEASES_URL = "https://github.com/salarzeidanlou/todofy/releases/latest";

const AUTO_CHECK_KEY = "update_auto_check";
const AUTO_INSTALL_KEY = "update_auto_install";
const LAST_CHECK_KEY = "update_last_check";
/** The version the user has already been told about, so a daily check that
 *  keeps finding the same release only announces it once. */
const NOTIFIED_KEY = "update_notified_version";

/** How long a silent check waits before running, so it never competes with
 *  the first paint or the initial sync. */
const STARTUP_DELAY_MS = 8_000;
/** Silent checks are rate-limited to this; a manual check always runs. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  state: UpdateState;
  /** The version on offer, once one has been found. */
  version: string | null;
  notes: string | null;
  error: string | null;
  downloaded: number;
  total: number;
  /**
   * False on a `.deb`/`.rpm` install, where the package manager owns the
   * files and the updater can't replace them. Such installs are sent to the
   * release page instead of downloading anything.
   */
  canSelfUpdate: boolean;
  autoCheck: boolean;
  /** Install a found update without a trip to Settings — after asking. */
  autoInstall: boolean;
  /** Set once the user waves away a specific version's banner. */
  dismissedVersion: string | null;
  /**
   * The version waiting on a yes/no from the user. Set by a background check
   * when automatic installs are on; downloading never starts without it.
   */
  promptVersion: string | null;
  /** The version whose restart prompt has been waved away. */
  restartDismissed: string | null;

  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  openReleases: () => void;
  dismiss: () => void;
  acceptPrompt: () => Promise<void>;
  declinePrompt: () => void;
  dismissRestart: () => void;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  setAutoInstall: (enabled: boolean) => Promise<void>;
}

/** The pending update object; kept out of the store because it is a handle,
 *  not state worth rendering. */
let pending: Update | null = null;

export const useUpdater = create<UpdaterState>((set, get) => ({
  state: "idle",
  version: null,
  notes: null,
  error: null,
  downloaded: 0,
  total: 0,
  canSelfUpdate: true,
  autoCheck: true,
  // Off unless asked for: an existing install must not start prompting to
  // update because this feature shipped.
  autoInstall: false,
  dismissedVersion: null,
  promptVersion: null,
  restartDismissed: null,

  check: async (manual = false) => {
    if (get().state === "checking" || get().state === "downloading") return;
    // An update that's already downloaded doesn't need looking for again.
    if (get().state === "ready") return;

    set({ state: "checking", error: null });
    try {
      const update = await check();
      api.setSetting(LAST_CHECK_KEY, String(Date.now())).catch(() => {});

      if (!update) {
        pending = null;
        set({ state: "idle", version: null, notes: null });
        return;
      }
      pending = update;
      set({
        state: "available",
        version: update.version,
        notes: update.body?.trim() || null,
        // Re-announce a version the user dismissed only if they asked.
        dismissedVersion: manual ? null : get().dismissedVersion,
      });

      // A manual check is its own answer — the result is already on screen.
      // A background one has to reach out, since the window may be in the tray.
      if (!manual) {
        void announce(update.version, get().canSelfUpdate);
        // Automatic installs still ask first. The dialog holds until the
        // window is actually on screen, so a check that lands while todofy
        // sits in the tray doesn't burn its one question unseen.
        if (get().autoInstall && get().canSelfUpdate) {
          set({ promptVersion: update.version });
        }
      }
    } catch (error) {
      pending = null;
      // A silent check that fails (offline, GitHub down) must stay silent.
      if (!manual) {
        set({ state: "idle" });
        return;
      }
      set({ state: "error", error: describe(error) });
    }
  },

  install: async () => {
    const update = pending;
    if (!update || get().state === "downloading") return;

    if (!get().canSelfUpdate) {
      get().openReleases();
      return;
    }

    set({ state: "downloading", downloaded: 0, total: 0, error: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({ total: event.data.contentLength ?? 0 });
        } else if (event.event === "Progress") {
          set({ downloaded: get().downloaded + event.data.chunkLength });
        }
      });
      set({ state: "ready" });
    } catch (error) {
      set({ state: "error", error: describe(error) });
    }
  },

  restart: async () => {
    try {
      await relaunch();
    } catch (error) {
      set({ state: "error", error: describe(error) });
    }
  },

  openReleases: () => {
    openUrl(RELEASES_URL).catch(() => {});
  },

  dismiss: () => set({ dismissedVersion: get().version }),

  acceptPrompt: async () => {
    set({ promptVersion: null });
    await get().install();
  },

  // Declining answers for this version only; the next release asks again.
  declinePrompt: () =>
    set({ promptVersion: null, dismissedVersion: get().promptVersion }),

  dismissRestart: () => set({ restartDismissed: get().version }),

  setAutoCheck: async (autoCheck) => {
    set({ autoCheck }); // optimistic
    try {
      await api.setSetting(AUTO_CHECK_KEY, autoCheck ? "true" : "false");
    } catch {
      set({ autoCheck: !autoCheck });
    }
  },

  setAutoInstall: async (autoInstall) => {
    set({ autoInstall }); // optimistic
    try {
      await api.setSetting(AUTO_INSTALL_KEY, autoInstall ? "true" : "false");
    } catch {
      set({ autoInstall: !autoInstall });
    }
  },
}));

/**
 * Notify the user about a version, at most once per version. Goes through the
 * same route reminders use, so it lands even when todofy is in the tray.
 */
async function announce(version: string, canInstall: boolean): Promise<void> {
  try {
    if ((await api.getSetting(NOTIFIED_KEY)) === version) return;
    await invoke("notify_update", { version, canInstall });
    await api.setSetting(NOTIFIED_KEY, version);
  } catch {
    // The in-app marker still carries the news if this couldn't be delivered.
  }
}

/**
 * Wire up the updater: learn what kind of install this is, then keep a quiet
 * daily check running — never when automatic checks are switched off.
 *
 * The cadence has to be a repeating one, not a single look at startup: todofy
 * lives in the tray and an install can stay open for weeks, which is exactly
 * the case automatic updates exist to serve.
 */
export function initUpdater(): void {
  void (async () => {
    const [canSelfUpdate, auto, install, last] = await Promise.all([
      invoke<boolean>("can_self_update").catch(() => true),
      api.getSetting(AUTO_CHECK_KEY).catch(() => null),
      api.getSetting(AUTO_INSTALL_KEY).catch(() => null),
      api.getSetting(LAST_CHECK_KEY).catch(() => null),
    ]);
    const autoCheck = auto !== "false";
    useUpdater.setState({
      canSelfUpdate,
      autoCheck,
      autoInstall: install === "true",
    });
    if (!autoCheck) return;

    const checkedAt = Number(last);
    const due =
      !Number.isFinite(checkedAt) || Date.now() - checkedAt >= CHECK_INTERVAL_MS;

    setTimeout(() => {
      if (due) void useUpdater.getState().check();
      // Re-read the setting each time, so switching automatic checks off in
      // Settings takes effect without a restart.
      setInterval(() => {
        if (useUpdater.getState().autoCheck) void useUpdater.getState().check();
      }, CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  })();
}

/** The updater's own errors are written for developers; these aren't. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error("update failed:", message);

  if (/network|dns|connect|timeout|resolve|fetch/i.test(message)) {
    return "Couldn't reach the update server. Check your connection and try again.";
  }
  if (/signature|verify|pubkey|minisign/i.test(message)) {
    return "That update couldn't be verified as genuine, so it was not installed.";
  }
  if (/platforms|was not found on the response/i.test(message)) {
    return "That release doesn't include a build for this platform yet.";
  }
  if (/appimage/i.test(message)) {
    return "Only the AppImage build can update itself. Install the new version from the release page.";
  }
  return "The update couldn't be completed. Try again, or download the new version from the release page.";
}
