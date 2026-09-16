// Deletes the calling user's account. Billing cancellation must finish first;
// otherwise deleting auth.users would remove the only authenticated path to
// stop a recurring subscription. The content rows in the hosted `todofy`
// schema then disappear through their `on delete cascade` foreign keys.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // New clients send this explicit confirmation. An empty body remains
  // accepted so installed clients from before this coordination change still
  // use the safe billing-aware path.
  const rawBody = await req.text();
  if (rawBody.trim()) {
    try {
      const body = JSON.parse(rawBody) as { confirmation?: unknown };
      if (body.confirmation !== "DELETE") {
        return json({ error: "confirmation_required" }, 400);
      }
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization header." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid session." }, 401);

  const billingBase = Deno.env.get("TODOFY_API_URL")?.replace(/\/+$/, "");
  const billingRequired = Deno.env.get("TODOFY_BILLING_REQUIRED") !== "false";
  if (!billingBase && billingRequired) {
    return json({ error: "billing_service_not_configured" }, 503);
  }

  if (billingBase) {
    let deletionURL: URL;
    try {
      const base = new URL(billingBase);
      const local = base.hostname === "localhost" || base.hostname === "127.0.0.1" ||
        base.hostname === "::1";
      if (base.username || base.password || base.search || base.hash ||
        (base.protocol !== "https:" && !(base.protocol === "http:" && local))) {
        return json({ error: "billing_service_not_configured" }, 503);
      }
      deletionURL = new URL(`${base.pathname.replace(/\/$/, "")}/v1/account/deletion`, base);
    } catch {
      return json({ error: "billing_service_not_configured" }, 503);
    }

    let billingResponse: Response;
    try {
      billingResponse = await fetch(deletionURL, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
        signal: AbortSignal.timeout(55_000),
      });
    } catch {
      return json({ error: "subscription_cancellation_unavailable" }, 502);
    }
    if (!billingResponse.ok) {
      return json({ error: "subscription_cancellation_failed" }, 502);
    }
    const billingResult = await billingResponse.json().catch(() => null) as
      | { ready?: boolean }
      | null;
    if (billingResult?.ready !== true) {
      return json({ error: "subscription_cancellation_not_confirmed" }, 502);
    }
  }

  // Only now delete with admin privileges. Retrying is safe if this final step
  // fails: the backend remembers that cancellation has already completed.
  const admin = createClient(url, serviceKey);
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: "account_deletion_failed" }, 500);

  return json({ ok: true });
});
