import { createClient } from "@supabase/supabase-js";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { secureStorage } from "./secureStorage";

// Sync is opt-in: the URL and publishable key are injected at build time from
// `.env` (see `.env.example`). No hardcoded fallback — a build without them
// simply ships with sync disabled rather than pointing at someone else's project.
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

/** True only when a build was configured with a Supabase project to sync against. */
export const syncConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || "http://localhost", anonKey || "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Native OAuth callbacks return an authorization code. The matching
    // verifier is persisted in secureStorage, binding the callback to the
    // sign-in attempt that originated on this device.
    flowType: "pkce",
    storage: secureStorage,
  },
  // Open-source deployments use `public` by default. A private deployment can
  // select an app-specific schema through its uncommitted local environment.
  db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA || "public" },
  // Tauri's native fetch has no origin, so requests skip the CORS preflight
  // that otherwise doubles their count. Scoped in `capabilities/default.json`.
  global: { fetch: nativeFetch as unknown as typeof fetch },
});
