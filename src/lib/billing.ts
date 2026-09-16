import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { useAuth } from "./auth";

export type BillingPlan = "monthly" | "yearly";
export type EntitlementState =
  | "checking"
  | "free"
  | "active"
  | "cancelled_active"
  | "grace"
  | "expired"
  | "revoked"
  | "pending"
  | "unavailable";
export type PaywallReason = "upgrade" | "cloud_sync" | "license";

export interface BillingCatalogPlan {
  id: BillingPlan;
  product_id: number;
  variant_id: number;
  amount: number;
  currency: string;
  interval: "month" | "year";
  checkout_url: string;
}

interface CloudSyncEntitlement {
  allowed: boolean;
  state: Exclude<EntitlementState, "checking" | "unavailable">;
  plan?: BillingPlan | "transition";
  valid_until: string | null;
  revision: string;
}

interface EntitlementResponse {
  capabilities: { cloud_sync: CloudSyncEntitlement };
  server_time: string;
}

interface PlansResponse {
  plans: BillingCatalogPlan[];
  test_mode: boolean;
}

interface BillingState {
  state: EntitlementState;
  allowed: boolean;
  plan: BillingPlan | "transition" | null;
  validUntil: string | null;
  revision: string;
  error: string | null;
  busy: boolean;
  catalog: BillingCatalogPlan[];
  catalogState: "idle" | "loading" | "ready" | "error";
  catalogError: string | null;
  testMode: boolean | null;
  gateOpen: boolean;
  gateReason: PaywallReason;
  lastCheckoutPlan: BillingPlan | null;
  openGate: (reason?: PaywallReason) => void;
  closeGate: () => void;
  clearError: () => void;
  loadCatalog: () => Promise<void>;
  refresh: () => Promise<void>;
  checkout: (plan: BillingPlan) => Promise<void>;
  activate: (license: string) => Promise<void>;
  openPortal: () => Promise<void>;
}

const apiBase = (import.meta.env.VITE_TODOFY_API_URL ?? "").replace(/\/+$/, "");
export const billingConfigured = Boolean(apiBase);

class BillingAPIError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function currentToken(): string {
  const token = useAuth.getState().session?.access_token;
  if (!token) throw new BillingAPIError("invalid_session", 401);
  return token;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  authenticated = true,
): Promise<T> {
  if (!billingConfigured) throw new BillingAPIError("billing_not_configured", 503);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${currentToken()}` } : {}),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok) {
      throw new BillingAPIError(body?.error ?? "billing_unavailable", response.status);
    }
    if (!body) throw new BillingAPIError("billing_unavailable", 502);
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BillingAPIError("request_timeout", 504);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function cacheKey(userId: string) {
  return `todofy:cloud-sync-entitlement:${userId}`;
}

function cachedAccess(userId: string): Pick<BillingState, "allowed" | "plan" | "validUntil" | "revision"> {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "null") as {
      allowed?: boolean;
      plan?: BillingPlan | "transition";
      validUntil?: string;
      revision?: string;
    } | null;
    const valid = Boolean(parsed?.allowed && parsed.validUntil && Date.parse(parsed.validUntil) > Date.now());
    return {
      allowed: valid,
      plan: valid ? parsed?.plan ?? null : null,
      validUntil: valid ? parsed?.validUntil ?? null : null,
      revision: parsed?.revision ?? "0",
    };
  } catch {
    return { allowed: false, plan: null, validUntil: null, revision: "0" };
  }
}

function remember(userId: string, value: CloudSyncEntitlement) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({
      allowed: value.allowed,
      plan: value.plan,
      validUntil: value.valid_until,
      revision: value.revision,
    }));
  } catch {
    // The server remains authoritative if private storage is unavailable.
  }
}

function message(error: unknown): string {
  if (!(error instanceof BillingAPIError)) return "Could not reach the billing service.";
  const messages: Record<string, string> = {
    invalid_session: "Your session expired. Sign in again and retry.",
    invalid_license: "That license key is not valid.",
    invalid_license_instance: "That license activation could not be verified.",
    activation_rejected: "Lemon Squeezy rejected this license activation.",
    license_already_claimed: "That license is already linked to another Todofy account.",
    purchase_owned_by_another_account: "That purchase belongs to another Todofy account.",
    subscription_ownership_mismatch: "That subscription belongs to another Todofy account.",
    ambiguous_subscription: "The subscription could not be identified safely. Please contact support.",
    wrong_product: "That license is not for a Todofy Cloud Sync plan.",
    wrong_environment: "That license belongs to a different billing environment.",
    activation_pending: "Activation is still being confirmed. Please try again shortly.",
    subscription_pending: "The subscription is still being prepared. Please try again shortly.",
    no_subscription: "No managed subscription is linked to this account.",
    rate_limited: "Too many attempts. Please wait and try again.",
    operation_in_progress: "This account is already processing a billing change. Please retry shortly.",
    account_deletion_pending: "This account is being deleted, so a new checkout cannot be started.",
    provider_unavailable: "Lemon Squeezy is temporarily unavailable.",
    auth_unavailable: "Account verification is temporarily unavailable.",
    storage_unavailable: "The billing database is temporarily unavailable.",
    timeout: "The billing service took too long to finish. Please retry.",
    checkout_unavailable: "Checkout is temporarily unavailable.",
    billing_not_configured: "Todofy Pro is not configured in this build.",
    request_timeout: "The billing service took too long to respond. Please retry.",
  };
  return messages[error.code] ?? "Could not complete the billing request.";
}

function isCatalogPlan(value: BillingCatalogPlan): boolean {
  const expected = value.id === "monthly"
    ? { amount: 399, interval: "month" }
    : value.id === "yearly"
      ? { amount: 3900, interval: "year" }
      : null;
  return (
    expected !== null &&
    Number.isSafeInteger(value.amount) &&
    value.amount === expected.amount &&
    value.currency === "EUR" &&
    value.interval === expected.interval &&
    isLemonSqueezyUrl(value.checkout_url)
  );
}

function isLemonSqueezyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com"))
    );
  } catch {
    return false;
  }
}

export const useBilling = create<BillingState>((set, get) => ({
  state: "checking",
  allowed: false,
  plan: null,
  validUntil: null,
  revision: "0",
  error: null,
  busy: false,
  catalog: [],
  catalogState: "idle",
  catalogError: null,
  testMode: null,
  gateOpen: false,
  gateReason: "upgrade",
  lastCheckoutPlan: null,

  openGate: (reason = "upgrade") => {
    set({ gateOpen: true, gateReason: reason, error: null });
    if (get().catalogState !== "ready") void get().loadCatalog();
    if (useAuth.getState().session) void get().refresh();
  },
  closeGate: () => set({ gateOpen: false, error: null, lastCheckoutPlan: null }),
  clearError: () => set({ error: null }),

  loadCatalog: async () => {
    if (get().catalogState === "loading") return;
    if (!billingConfigured) {
      set({ catalogState: "error", catalogError: "Todofy Pro is not configured in this build." });
      return;
    }
    set({ catalogState: "loading", catalogError: null });
    try {
      const result = await request<PlansResponse>("/v1/plans", undefined, false);
      const plans = result.plans.filter(isCatalogPlan);
      if (!plans.some((plan) => plan.id === "monthly") || !plans.some((plan) => plan.id === "yearly")) {
        throw new BillingAPIError("checkout_unavailable", 502);
      }
      set({ catalog: plans, catalogState: "ready", catalogError: null, testMode: result.test_mode });
    } catch (error) {
      set({ catalogState: "error", catalogError: message(error) });
    }
  },

  refresh: async () => {
    const user = useAuth.getState().session?.user;
    if (!billingConfigured || !user) {
      set({ state: "free", allowed: false, plan: null, validUntil: null, revision: "0", error: null });
      return;
    }
    const cached = cachedAccess(user.id);
    set({ state: "checking", ...cached, error: null });
    try {
      const result = await request<EntitlementResponse>("/v1/me/entitlements");
      if (useAuth.getState().session?.user.id !== user.id) return;
      const access = result.capabilities.cloud_sync;
      remember(user.id, access);
      set({
        state: access.state,
        allowed: access.allowed,
        plan: access.plan ?? null,
        validUntil: access.valid_until,
        revision: access.revision,
        error: null,
      });
    } catch (error) {
      if (useAuth.getState().session?.user.id !== user.id) return;
      set({ state: "unavailable", ...cached, error: message(error) });
    }
  },

  checkout: async (plan) => {
    set({ busy: true, error: null });
    try {
      let url: string;
      if (useAuth.getState().session) {
        const result = await request<{ url: string }>("/v1/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan }),
        });
        url = result.url;
      } else {
        if (get().catalogState !== "ready") await get().loadCatalog();
        const selected = get().catalog.find((item) => item.id === plan);
        if (!selected) throw new BillingAPIError("checkout_unavailable", 503);
        url = selected.checkout_url;
      }
      if (!isLemonSqueezyUrl(url)) throw new BillingAPIError("checkout_unavailable", 502);
      await openUrl(url);
      set({ lastCheckoutPlan: plan });
    } catch (error) {
      set({ error: message(error) });
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  activate: async (license) => {
    if (!useAuth.getState().session) throw new BillingAPIError("invalid_session", 401);
    set({ busy: true, error: null });
    try {
      const result = await request<EntitlementResponse>("/v1/licenses/activate", {
        method: "POST",
        body: JSON.stringify({ license_key: license.trim() }),
      });
      const user = useAuth.getState().session?.user;
      const access = result.capabilities.cloud_sync;
      if (user) remember(user.id, access);
      set({
        state: access.state,
        allowed: access.allowed,
        plan: access.plan ?? null,
        validUntil: access.valid_until,
        revision: access.revision,
        error: null,
        lastCheckoutPlan: null,
      });
    } catch (error) {
      set({ error: message(error) });
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  openPortal: async () => {
    set({ busy: true, error: null });
    try {
      const result = await request<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        body: "{}",
      });
      if (!isLemonSqueezyUrl(result.url)) throw new BillingAPIError("billing_unavailable", 502);
      await openUrl(result.url);
    } catch (error) {
      set({ error: message(error) });
      throw error;
    } finally {
      set({ busy: false });
    }
  },
}));

let initialized = false;

export function initBilling() {
  if (initialized) return;
  initialized = true;
  void useBilling.getState().loadCatalog();

  let lastUser = useAuth.getState().session?.user.id ?? null;
  useAuth.subscribe((auth) => {
    const user = auth.session?.user.id ?? null;
    if (!auth.ready || user === lastUser) return;
    lastUser = user;
    if (user) void useBilling.getState().refresh();
    else {
      useBilling.setState({
        state: "free",
        allowed: false,
        plan: null,
        validUntil: null,
        revision: "0",
        error: null,
        busy: false,
      });
    }
  });

  const refreshOnReturn = () => {
    if (document.visibilityState === "visible" && useAuth.getState().session) {
      void useBilling.getState().refresh();
    }
  };
  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);

  if (lastUser) void useBilling.getState().refresh();
}
