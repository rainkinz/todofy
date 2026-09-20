import { useEffect, useState } from "preact/hooks";
import { useAuth } from "../lib/auth";
import { CloseIcon, EyeIcon, EyeOffIcon, GoogleIcon, UserIcon } from "./Icons";

type Mode = "signin" | "signup";

export function AuthDialog() {
  const {
    dialogOpen,
    dialogIntent,
    session,
    closeDialog,
    signIn,
    signUp,
    signInWithGoogle,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (!dialogOpen) {
      setPassword("");
      setError(null);
      setNotice(null);
      setBusy(false);
      setGoogleBusy(false);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (session) closeDialog();
  }, [session, closeDialog]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        if (!busy && !googleBusy) closeDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, closeDialog, busy, googleBusy]);

  if (!dialogOpen) return null;

  const signup = mode === "signup";
  const proIntent = dialogIntent === "pro";

  const google = async () => {
    if (googleBusy) return;
    setError(null);
    setNotice(null);
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) setError(result.error);
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = signup
        ? await signUp(email, password)
        : await signIn(email, password);
      if (!result.ok) {
        setError(result.error);
      } else if (result.message) {
        setNotice(result.message);
        setMode("signin");
        setPassword("");
      } else {
        closeDialog();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget &&
        !busy &&
        !googleBusy &&
        closeDialog()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        class="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          onClick={closeDialog}
          disabled={busy || googleBusy}
          title="Close"
          aria-label="Close account dialog"
          class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          <CloseIcon width={16} height={16} />
        </button>

        <div class="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-(--color-accent)">
            <UserIcon width={24} height={24} />
          </span>
          <h3 id="auth-dialog-title" class="text-lg font-semibold text-text">
            {signup
              ? "Create your Todofy account"
              : proIntent
                ? "Sign in to activate Pro"
                : "Welcome back"}
          </h3>
          <p class="text-xs text-muted">
            {proIntent
              ? "Your license is linked to the account you choose here."
              : "An account is only needed for optional Cloud Sync."}
          </p>
        </div>

        <div class="flex flex-col gap-3 px-6 pt-4">
          <button
            type="button"
            onClick={() => void google()}
            disabled={googleBusy || busy}
            class="flex items-center justify-center gap-2.5 rounded-lg border border-border bg-[var(--color-bg)] px-3 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <GoogleIcon width={18} height={18} />
            {googleBusy ? "Waiting for browser…" : "Continue with Google"}
          </button>
          <div class="flex items-center gap-3">
            <span class="h-px flex-1 bg-[var(--color-border)]" />
            <span class="text-[10px] font-medium uppercase tracking-wider text-faint">
              or
            </span>
            <span class="h-px flex-1 bg-[var(--color-border)]" />
          </div>
        </div>

        <form onSubmit={submit} class="flex flex-col gap-3 px-6 pt-3 pb-6">
          <Field
            label="Email"
            type="email"
            value={email}
            autocomplete="email"
            placeholder="you@example.com"
            onInput={setEmail}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            autocomplete={signup ? "new-password" : "current-password"}
            placeholder={signup ? "At least 6 characters" : "••••••••"}
            onInput={setPassword}
            revealable
          />

          {notice && (
            <p
              role="status"
              class="rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-xs text-[var(--color-success)]"
            >
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              class="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={
              busy || googleBusy || !email.trim() || password.length < 6
            }
            class="mt-1 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {busy
              ? signup
                ? "Creating account…"
                : "Signing in…"
              : signup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <div class="border-t border-border px-6 py-3.5 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setError(null);
              setNotice(null);
              setPassword("");
            }}
            class="group text-xs text-muted"
          >
            {signup ? "Already have an account? " : "New to Todofy? "}
            <span class="font-medium text-(--color-accent) transition-colors group-hover:text-[var(--color-accent-hover)]">
              {signup ? "Sign in" : "Create an account"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  placeholder,
  autocomplete,
  onInput,
  revealable,
}: {
  label: string;
  type: string;
  value: string;
  placeholder?: string;
  autocomplete?: string;
  onInput: (value: string) => void;
  revealable?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const inputType = revealable && reveal ? "text" : type;
  return (
    <label class="flex flex-col gap-1 text-left">
      <span class="text-[10px] font-medium uppercase tracking-wider text-faint">
        {label}
      </span>
      <div class="relative">
        <input
          type={inputType}
          value={value}
          placeholder={placeholder}
          autocomplete={autocomplete}
          onInput={(event) => onInput(event.currentTarget.value)}
          class={`w-full rounded-lg border border-border bg-[var(--color-bg)] py-2 pl-3 text-sm outline-none transition-colors focus:border-(--color-accent) ${revealable ? "pr-10" : "pr-3"}`}
        />
        {revealable && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((value) => !value)}
            title={reveal ? "Hide password" : "Show password"}
            aria-label={reveal ? "Hide password" : "Show password"}
            class="absolute inset-y-0 right-0 grid w-10 place-items-center text-faint transition-colors hover:text-text"
          >
            {reveal ? (
              <EyeOffIcon width={16} height={16} />
            ) : (
              <EyeIcon width={16} height={16} />
            )}
          </button>
        )}
      </div>
    </label>
  );
}
