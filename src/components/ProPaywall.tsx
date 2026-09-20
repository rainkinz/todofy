import { useEffect, useState } from "preact/hooks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../lib/auth";
import {
  type BillingCatalogPlan,
  type BillingPlan,
  billingConfigured,
  useBilling,
} from "../lib/billing";
import { useSync } from "../lib/sync";
import {
  CheckIcon,
  CloseIcon,
  CrownIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LemonSqueezyIcon,
} from "./Icons";

const FEATURES = [
  "Tasks, labels, journal, and focus history",
  "The same Todofy account on every device",
  "A calm, local-first workflow that works offline",
];

export function ProPaywall() {
  const {
    gateOpen,
    gateReason,
    closeGate,
    state,
    allowed,
    plan,
    validUntil,
    error,
    busy,
    catalog,
    catalogState,
    catalogError,
    testMode,
    lastCheckoutPlan,
    loadCatalog,
    checkout,
    activate,
    openPortal,
    refresh,
  } = useBilling();
  const { session, email, openDialog } = useAuth();
  const { status: syncStatus, syncNow } = useSync();
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("yearly");
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [license, setLicense] = useState("");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (gateOpen) {
      setLicenseOpen(gateReason === "license");
      return;
    }
    setSelectedPlan("yearly");
    setLicenseOpen(false);
    setLicense("");
    setReveal(false);
  }, [gateOpen, gateReason]);

  useEffect(() => {
    if (gateOpen && lastCheckoutPlan) setLicenseOpen(true);
  }, [gateOpen, lastCheckoutPlan]);

  useEffect(() => {
    if (!gateOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !useAuth.getState().dialogOpen)
        closeGate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gateOpen, closeGate, busy]);

  if (!billingConfigured || !gateOpen) return null;

  const buy = async () => {
    try {
      await checkout(selectedPlan);
    } catch {
      // A safe, normalized error is rendered from the billing store.
    }
  };

  const submitLicense = async (event: Event) => {
    event.preventDefault();
    if (!session || license.trim().length < 10 || busy) return;
    try {
      await activate(license);
      setLicense("");
      setReveal(false);
    } catch {
      // A safe, normalized error is rendered from the billing store.
    }
  };

  const selectedCatalogPlan = catalog.find((item) => item.id === selectedPlan);
  const checkoutUnavailable = !session && catalogState !== "ready";
  const showPlanPicker = !allowed || plan === "transition";

  return (
    <div
      class="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && closeGate()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-dialog-title"
        class="relative my-auto w-full max-w-[590px] animate-fade-rise overflow-hidden rounded-[22px] border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl shadow-black/55"
      >
        <div class="pointer-events-none absolute inset-x-16 -top-28 h-52 rounded-full bg-[var(--color-accent)] opacity-[0.09] blur-3xl" />

        <button
          type="button"
          onClick={closeGate}
          disabled={busy}
          title="Close"
          aria-label="Close Todofy Pro"
          class="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          <CloseIcon width={17} height={17} />
        </button>

        <div class="relative max-h-[calc(100vh-2rem)] overflow-y-auto px-6 py-7 sm:px-10 sm:py-9">
          <header class="mx-auto max-w-md text-center">
            <span class="mx-auto grid h-11 w-11 place-items-center rounded-[14px] border border-(--color-accent)/20 bg-accent-soft text-(--color-accent) shadow-lg shadow-black/10">
              <CrownIcon width={22} height={22} />
            </span>
            <p class="mt-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-(--color-accent)">
              Todofy Pro
            </p>
            <h2
              id="pro-dialog-title"
              class="mt-2 text-[27px] font-semibold leading-[1.18] tracking-[-0.035em] text-text sm:text-[30px]"
            >
              Sync without changing how you work.
            </h2>
            <p class="mx-auto mt-3 max-w-sm text-[13px] leading-5 text-muted">
              Carry your Todofy system between devices while keeping the quiet,
              local-first experience you already know.
            </p>
          </header>

          {testMode && (
            <Notice tone="warning" className="mt-6">
              Test checkout is enabled. Test purchases do not grant live
              production access.
            </Notice>
          )}

          {!showPlanPicker ? (
            <ActivePlan
              state={state}
              plan={plan}
              validUntil={validUntil}
              busy={busy}
              syncBusy={syncStatus === "syncing"}
              canManage={plan === "monthly" || plan === "yearly"}
              onRefresh={() => void refresh()}
              onManage={() => void openPortal().catch(() => {})}
              onSync={() => void syncNow(true)}
            />
          ) : (
            <div class="mt-7">
              <AccessNotice
                state={state}
                allowed={allowed}
                plan={plan}
                validUntil={validUntil}
              />

              <div
                role="group"
                aria-label="Billing period"
                class="mx-auto grid max-w-[330px] grid-cols-2 rounded-xl border border-border bg-[var(--color-bg)] p-1"
              >
                <PlanToggle
                  active={selectedPlan === "monthly"}
                  onClick={() => setSelectedPlan("monthly")}
                >
                  Monthly
                </PlanToggle>
                <PlanToggle
                  active={selectedPlan === "yearly"}
                  onClick={() => setSelectedPlan("yearly")}
                >
                  Yearly
                  <span
                    class={`ml-1.5 text-[9px] font-semibold ${selectedPlan === "yearly" ? "text-(--color-accent)" : "text-faint"}`}
                  >
                    SAVE
                  </span>
                </PlanToggle>
              </div>

              <SelectedPlanPrice
                plan={selectedPlan}
                catalogPlan={selectedCatalogPlan}
              />

              <div class="mx-auto mt-5 max-w-[390px] space-y-2.5">
                {FEATURES.map((feature) => (
                  <p
                    key={feature}
                    class="flex items-start gap-2.5 text-[12px] leading-5 text-muted"
                  >
                    <span class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent-soft text-(--color-accent)">
                      <CheckIcon width={10} height={10} stroke-width={3} />
                    </span>
                    {feature}
                  </p>
                ))}
              </div>

              <button
                type="button"
                disabled={busy || checkoutUnavailable}
                onClick={() => void buy()}
                class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/15 transition-[background-color,transform] hover:bg-[var(--color-accent-hover)] active:translate-y-px disabled:opacity-55"
              >
                <LemonSqueezyIcon width={17} height={17} />
                {busy
                  ? "Opening secure checkout…"
                  : "Continue to secure checkout"}
                {!busy && (
                  <ExternalLinkIcon width={14} height={14} class="opacity-70" />
                )}
              </button>
              <p class="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-faint">
                <LemonSqueezyIcon width={12} height={12} />
                Secure checkout and billing by Lemon Squeezy
              </p>

              {catalogState === "loading" && !session && (
                <p class="mt-3 text-center text-[11px] text-muted">
                  Loading secure checkout…
                </p>
              )}
              {catalogError && (
                <div
                  role="alert"
                  class="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2.5 text-xs text-(--color-danger)"
                >
                  <span>{catalogError}</span>
                  <button
                    type="button"
                    onClick={() => void loadCatalog()}
                    class="shrink-0 font-semibold underline underline-offset-2"
                  >
                    Retry
                  </button>
                </div>
              )}
              {lastCheckoutPlan && (
                <Notice tone="accent" className="mt-4">
                  Checkout opened. After purchase, return here and activate the
                  license key Lemon Squeezy sends you.
                </Notice>
              )}

              <div class="my-6 h-px bg-[var(--color-border)]" />

              <button
                type="button"
                aria-expanded={licenseOpen}
                aria-controls="pro-license-panel"
                onClick={() => setLicenseOpen((value) => !value)}
                class="mx-auto flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text"
              >
                <KeyIcon width={15} height={15} class="text-(--color-accent)" />
                Have a license key?
                <span
                  class={`text-[10px] transition-transform ${licenseOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </button>

              {licenseOpen && (
                <div id="pro-license-panel" class="mt-3 animate-fade-rise">
                  {!session ? (
                    <SignedOutActivation onSignIn={() => openDialog("pro")} />
                  ) : (
                    <LicenseForm
                      email={email}
                      license={license}
                      reveal={reveal}
                      busy={busy}
                      onLicenseChange={setLicense}
                      onReveal={() => setReveal((value) => !value)}
                      onSubmit={submitLicense}
                    />
                  )}
                </div>
              )}

              {session && (plan === "monthly" || plan === "yearly") && (
                <div class="mt-5 flex items-center justify-center gap-4 text-[11px]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openPortal().catch(() => {})}
                    class="font-medium text-muted hover:text-text disabled:opacity-50"
                  >
                    Manage previous plan
                  </button>
                  <span class="h-3 w-px bg-[var(--color-border)]" />
                  <button
                    type="button"
                    disabled={state === "checking" || busy}
                    onClick={() => void refresh()}
                    class="font-medium text-muted hover:text-text disabled:opacity-50"
                  >
                    {state === "checking" ? "Checking…" : "Refresh access"}
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              class="mt-4 rounded-lg bg-[var(--color-danger)]/10 px-3 py-2.5 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <footer class="mt-7 text-center text-[10px] leading-4 text-faint">
            <p>
              Local features remain free. Cancel anytime, with a 14-day refund.
            </p>
            <p class="mt-1.5 flex items-center justify-center gap-2">
              <LegalLink href="https://unifybrowse.com/products/todofy/terms">
                Terms
              </LegalLink>
              <span aria-hidden="true">·</span>
              <LegalLink href="https://unifybrowse.com/products/todofy/privacy">
                Privacy
              </LegalLink>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function PlanToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      class={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
        active
          ? "bg-surface-2 text-text shadow-sm"
          : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function SelectedPlanPrice({
  plan,
  catalogPlan,
}: {
  plan: BillingPlan;
  catalogPlan?: BillingCatalogPlan;
}) {
  const amount = catalogPlan?.amount ?? (plan === "monthly" ? 399 : 3900);
  const period = plan === "monthly" ? "month" : "year";
  return (
    <div class="mt-6 text-center">
      <p class="flex items-end justify-center gap-2 text-text">
        <span class="text-[38px] font-semibold leading-none tracking-[-0.045em]">
          {formatMoney(amount, catalogPlan?.currency ?? "EUR")}
        </span>
        <span class="pb-0.5 text-xs text-muted">/ {period}</span>
      </p>
      <p class="mt-2 min-h-4 text-[11px] font-medium text-(--color-accent)">
        {plan === "yearly" ? "Save €8.88 every year" : "Simple monthly billing"}
      </p>
    </div>
  );
}

function AccessNotice({
  state,
  allowed,
  plan,
  validUntil,
}: {
  state: string;
  allowed: boolean;
  plan: BillingPlan | "transition" | null;
  validUntil: string | null;
}) {
  // An entitled account only reaches the picker on transition access, and that
  // stays true while the entitlement is re-verified in the background.
  if (allowed) {
    if (plan !== "transition") return null;
    return (
      <Notice tone="accent" className="mb-5">
        {validUntil
          ? `Your transition access remains active through ${formatDate(validUntil)}. Choose a plan to keep Cloud Sync afterward.`
          : "Your transition access is active. Choose a plan to keep Cloud Sync afterward."}
      </Notice>
    );
  }
  if (state === "checking") {
    return <Notice className="mb-5">Checking your current Pro access…</Notice>;
  }
  if (state === "pending") {
    return (
      <Notice tone="accent" className="mb-5">
        Your purchase is still being confirmed. You can refresh access in a
        moment.
      </Notice>
    );
  }
  if (state === "expired") {
    return (
      <Notice className="mb-5">
        Your previous Pro plan has ended. Choose a plan to restore Cloud Sync.
      </Notice>
    );
  }
  if (state === "revoked") {
    return (
      <Notice className="mb-5">
        This account no longer has Pro access. Choose a plan or activate a valid
        license.
      </Notice>
    );
  }
  return null;
}

function SignedOutActivation({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div class="rounded-xl border border-border bg-[var(--color-surface)] p-4 text-center">
      <p class="text-xs leading-5 text-muted">
        Sign in or create an account first. Your license will be linked to that
        account on all your devices.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        class="mt-3 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
      >
        Sign in or create account
      </button>
    </div>
  );
}

function LicenseForm({
  email,
  license,
  reveal,
  busy,
  onLicenseChange,
  onReveal,
  onSubmit,
}: {
  email: string | null;
  license: string;
  reveal: boolean;
  busy: boolean;
  onLicenseChange: (value: string) => void;
  onReveal: () => void;
  onSubmit: (event: Event) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      class="rounded-xl border border-border bg-[var(--color-surface)] p-4"
    >
      <p class="text-center text-[11px] leading-5 text-muted">
        Activate for{" "}
        <strong class="font-medium text-text">{email ?? "this account"}</strong>
        . A license can belong to only one Todofy account.
      </p>
      <label class="mt-3 block">
        <span class="sr-only">Lemon Squeezy license key</span>
        <div class="relative">
          <input
            type={reveal ? "text" : "password"}
            value={license}
            onInput={(event) => onLicenseChange(event.currentTarget.value)}
            placeholder="Paste your license key"
            autocomplete="off"
            spellcheck={false}
            class="w-full rounded-lg border border-border bg-[var(--color-bg)] py-2.5 pl-3 pr-10 font-mono text-xs text-text outline-none transition-colors placeholder:font-sans placeholder:text-faint focus:border-(--color-accent)"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={onReveal}
            title={reveal ? "Hide license" : "Show license"}
            aria-label={reveal ? "Hide license" : "Show license"}
            class="absolute inset-y-0 right-0 grid w-10 place-items-center text-faint hover:text-text"
          >
            {reveal ? (
              <EyeOffIcon width={16} height={16} />
            ) : (
              <EyeIcon width={16} height={16} />
            )}
          </button>
        </div>
      </label>
      <button
        type="submit"
        disabled={busy || license.trim().length < 10}
        class="mt-2.5 w-full rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {busy ? "Verifying license…" : "Activate Todofy Pro"}
      </button>
    </form>
  );
}

function ActivePlan({
  state,
  plan,
  validUntil,
  busy,
  syncBusy,
  canManage,
  onRefresh,
  onManage,
  onSync,
}: {
  state: string;
  plan: BillingPlan | "transition" | null;
  validUntil: string | null;
  busy: boolean;
  syncBusy: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onManage: () => void;
  onSync: () => void;
}) {
  const cancelled = state === "cancelled_active";
  const grace = state === "grace";
  const heading = grace
    ? "Your payment needs attention"
    : cancelled
      ? "Your subscription is cancelled"
      : plan === "transition"
        ? "Transition access is active"
        : "Todofy Pro is active";
  const detail = grace
    ? validUntil
      ? `Cloud Sync remains available during billing recovery through ${formatDate(validUntil)}.`
      : "Cloud Sync remains available while Lemon Squeezy retries your payment."
    : cancelled
      ? validUntil
        ? `Renewal is off. Cloud Sync remains available through ${formatDate(validUntil)}.`
        : "Renewal is off. Cloud Sync remains available until the end of your paid period."
      : validUntil
        ? `Cloud Sync access is verified through ${formatDate(validUntil)}.`
        : "Your account can use Cloud Sync.";

  return (
    <div class="mt-8 text-center">
      <span
        class={`mx-auto grid h-12 w-12 place-items-center rounded-full ${
          grace
            ? "bg-[var(--color-warning)]/12 text-[var(--color-warning)]"
            : cancelled
              ? "bg-accent-soft text-(--color-accent)"
              : "bg-[var(--color-success)]/12 text-[var(--color-success)]"
        }`}
      >
        <CheckIcon width={23} height={23} stroke-width={2.5} />
      </span>
      <p class="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">
        {plan === "monthly"
          ? "Monthly plan"
          : plan === "yearly"
            ? "Yearly plan"
            : "Cloud Sync"}
      </p>
      <h3 class="mt-1.5 text-xl font-semibold tracking-tight text-text">
        {heading}
      </h3>
      <p class="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted">{detail}</p>

      <div class="mt-6 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onSync}
          disabled={syncBusy}
          class="rounded-xl bg-[var(--color-accent)] px-3 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {syncBusy ? "Syncing…" : "Sync now"}
        </button>
        {canManage ? (
          <button
            type="button"
            onClick={onManage}
            disabled={busy}
            class="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-[var(--color-bg)] px-3 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {grace
              ? "Fix payment"
              : cancelled
                ? "View subscription"
                : "Manage subscription"}
            <ExternalLinkIcon width={13} height={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            class="rounded-xl border border-border bg-[var(--color-bg)] px-3 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Refresh access
          </button>
        )}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          class="mt-3 text-[11px] font-medium text-muted hover:text-text disabled:opacity-50"
        >
          {state === "checking" ? "Checking…" : "Refresh access"}
        </button>
      )}
    </div>
  );
}

function LegalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href).catch(() => {})}
      class="underline underline-offset-2 transition-colors hover:text-text"
    >
      {children}
    </button>
  );
}

function Notice({
  children,
  tone = "neutral",
  className = "",
}: {
  children: preact.ComponentChildren;
  tone?: "neutral" | "accent" | "warning";
  className?: string;
}) {
  const color =
    tone === "accent"
      ? "border-(--color-accent)/25 bg-accent-soft text-muted"
      : tone === "warning"
        ? "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
        : "border-border bg-[var(--color-surface)] text-muted";
  return (
    <p
      class={`rounded-xl border px-3.5 py-3 text-center text-[11px] leading-5 ${color} ${className}`}
    >
      {children}
    </p>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
