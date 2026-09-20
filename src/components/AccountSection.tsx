import { useEffect, useState } from "preact/hooks";
import { useAuth, type AuthResult } from "../lib/auth";
import { useSync, type SyncStatus } from "../lib/sync";
import { syncConfigured } from "../lib/supabase";
import { billingConfigured, useBilling } from "../lib/billing";
import { CloudIcon, CrownIcon, TrashIcon, UserIcon } from "./Icons";
import { Checkbox } from "./Checkbox";

export function AccountSection() {
  const { ready, session, email, openDialog, signOut, deleteAccount } =
    useAuth();
  const { openGate } = useBilling();

  if (!syncConfigured) {
    return (
      <section class="mb-6">
        <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
          Account
        </h3>
        <div class="overflow-hidden rounded-xl border border-border bg-[var(--color-surface)]">
          <div class="px-4 py-3.5 text-sm text-muted">
            Account sync isn't configured in this build.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        Account
      </h3>
      <div class="overflow-hidden rounded-xl border border-border bg-[var(--color-surface)]">
        {!ready ? (
          <div class="px-4 py-3.5 text-sm text-muted">Loading…</div>
        ) : session ? (
          <SignedInRow
            email={email}
            onSignOut={signOut}
            deleteAccount={deleteAccount}
          />
        ) : (
          <SignInRow
            onSignIn={() => openDialog("account")}
            onExplorePro={() => openGate("upgrade")}
          />
        )}
      </div>
    </section>
  );
}

function SignInRow({
  onSignIn,
  onExplorePro,
}: {
  onSignIn: () => void;
  onExplorePro: () => void;
}) {
  return (
    <div class="flex items-center gap-3 px-4 py-3.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <UserIcon width={18} height={18} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-text">Cloud Sync account</p>
        <p class="mt-0.5 text-xs text-muted">
          Local Todofy stays free. Sign in when you want Pro sync.
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        {billingConfigured && (
          <button
            type="button"
            onClick={onExplorePro}
            class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-(--color-accent) transition-colors hover:bg-accent-soft"
          >
            View Pro
          </button>
        )}
        <button
          type="button"
          onClick={onSignIn}
          class="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

function SignedInRow({
  email,
  onSignOut,
  deleteAccount,
}: {
  email: string | null;
  onSignOut: () => Promise<void>;
  deleteAccount: (wipeLocal: boolean) => Promise<AuthResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <div class="flex items-center gap-3 px-4 py-3.5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          <UserIcon width={18} height={18} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">
            {email ?? "Signed in"}
          </p>
          <p class="mt-0.5 text-xs text-muted">
            This is the account your license and cloud data belong to.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              await onSignOut();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {billingConfigured && <CloudSyncPlanRow />}
      <SyncStatusRow />
      <div class="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p class="text-xs text-muted">
          Delete your account, cloud data, and cancel linked billing.
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          class="shrink-0 rounded-lg border border-[var(--color-danger)]/40 px-3 py-1.5 text-xs font-medium text-(--color-danger) transition-colors hover:bg-[var(--color-danger)]/10"
        >
          Delete account
        </button>
      </div>
      {deleteOpen && (
        <DeleteAccountModal
          deleteAccount={deleteAccount}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}

function CloudSyncPlanRow() {
  const { state, allowed, plan, validUntil, openGate } = useBilling();
  const title =
    state === "checking"
      ? "Checking Todofy Pro…"
      : state === "cancelled_active"
        ? "Subscription cancelled"
        : state === "grace"
          ? "Payment issue — temporary access"
          : allowed
            ? plan === "transition"
              ? "Cloud Sync transition access"
              : "Todofy Pro active"
            : state === "unavailable"
              ? "Could not verify Todofy Pro"
              : "Cloud Sync needs Todofy Pro";
  const formattedEnd = validUntil
    ? new Date(validUntil).toLocaleDateString()
    : null;
  const detail =
    state === "cancelled_active" && formattedEnd
      ? `Renewal is off. Cloud Sync remains available through ${formattedEnd}.`
      : state === "grace" && formattedEnd
        ? `Update your billing details. Temporary access ends ${formattedEnd}.`
        : allowed && formattedEnd
          ? `Access verified through ${formattedEnd}.`
          : "€3.99 monthly or €39 yearly. You can also activate an existing license.";

  return (
    <div class="flex items-center gap-3 border-t border-border px-4 py-3.5">
      <span
        class={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${allowed ? "bg-accent-soft text-(--color-accent)" : "bg-surface-2 text-muted"}`}
      >
        {allowed ? (
          <CrownIcon width={18} height={18} />
        ) : (
          <CloudIcon width={18} height={18} />
        )}
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-text">{title}</p>
        <p class="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
      <button
        type="button"
        onClick={() => openGate(allowed ? "upgrade" : "license")}
        class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-(--color-accent) transition-colors hover:bg-accent-soft"
      >
        {allowed ? "View plan" : "Unlock sync"}
      </button>
    </div>
  );
}

const STATUS_META: Record<SyncStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-[var(--color-success)]", label: "Synced" },
  syncing: { dot: "bg-[var(--color-warning)]", label: "Syncing…" },
  offline: { dot: "bg-[var(--color-faint)]", label: "Offline — will retry" },
  error: { dot: "bg-[var(--color-danger)]", label: "Sync failed" },
  paused: { dot: "bg-[var(--color-faint)]", label: "Cloud Sync paused" },
};

function SyncStatusRow() {
  const { status, lastSyncedAt, error, syncNow } = useSync();
  const { allowed, openGate } = useBilling();
  const meta = STATUS_META[status];
  const gated = billingConfigured && !allowed;
  const detail =
    status === "error" || status === "paused"
      ? (error ??
        (gated
          ? "Activate Todofy Pro to begin syncing."
          : "Something went wrong."))
      : status === "idle" && !lastSyncedAt
        ? "Not synced yet"
        : lastSyncedAt
          ? `Last synced ${relativeTime(lastSyncedAt)}`
          : "";

  return (
    <div class="flex items-center gap-3 border-t border-border bg-[var(--color-surface)] px-4 py-3">
      <span class={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-text">{meta.label}</p>
        {detail && (
          <p class="mt-0.5 truncate text-[11px] text-muted">{detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => (gated ? openGate("cloud_sync") : void syncNow(true))}
        disabled={status === "syncing"}
        class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
      >
        {status === "syncing" ? "Syncing…" : gated ? "Unlock sync" : "Sync now"}
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DeleteAccountModal({
  deleteAccount,
  onClose,
}: {
  deleteAccount: (wipeLocal: boolean) => Promise<AuthResult>;
  onClose: () => void;
}) {
  const [wipeLocal, setWipeLocal] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDelete = confirm.trim().toUpperCase() === "DELETE";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const run = async () => {
    if (!canDelete || busy) return;
    setError(null);
    setBusy(true);
    const result = await deleteAccount(wipeLocal);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-[130] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        class="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50"
      >
        <div class="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-danger)]/10 text-(--color-danger)">
            <TrashIcon width={24} height={24} />
          </span>
          <h3 id="delete-account-title" class="text-lg font-semibold text-text">
            Delete account
          </h3>
          <p class="text-xs leading-5 text-muted">
            This permanently deletes your Todofy account and cloud data. Any
            linked recurring subscription is cancelled first. This can't be
            undone.
          </p>
        </div>

        <div class="flex flex-col gap-3 px-6 pt-3 pb-6">
          <button
            type="button"
            role="checkbox"
            aria-checked={wipeLocal}
            onClick={() => setWipeLocal((value) => !value)}
            class={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              wipeLocal
                ? "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5"
                : "border-border bg-[var(--color-bg)] hover:bg-surface-2"
            }`}
          >
            <span class="mt-0.5">
              <Checkbox
                checked={wipeLocal}
                interactive={false}
                color="var(--color-danger)"
              />
            </span>
            <span class="text-xs text-text">
              Also delete app data stored on this device.
              <span class="mt-0.5 block text-muted">
                Leave unchecked to keep your local tasks, journal, and calendar
                events.
              </span>
            </span>
          </button>

          <label class="flex flex-col gap-1 text-left">
            <span class="text-[10px] font-medium uppercase tracking-wider text-faint">
              Type{" "}
              <code class="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] normal-case tracking-normal text-(--color-danger)">
                DELETE
              </code>{" "}
              to confirm
            </span>
            <input
              value={confirm}
              placeholder="DELETE"
              onInput={(event) => setConfirm(event.currentTarget.value)}
              class="w-full rounded-lg border border-border bg-[var(--color-bg)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--color-danger)]"
            />
          </label>

          {error && (
            <p
              role="alert"
              class="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <div class="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              class="flex-1 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canDelete || busy}
              class="flex-1 rounded-lg bg-[var(--color-danger)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Cancelling and deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
