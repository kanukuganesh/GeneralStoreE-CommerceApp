// Shared helpers for the Razorpay payment backend (Flipkart/BigBasket-style:
// create order on the server → verify signature → webhook as source of truth).
import { createClient } from "npm:@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

export function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

export type RazorpayCreds = {
  keyId: string
  keySecret: string
  ready: boolean
  auth: string
}

// Key ID + Key Secret are Supabase secrets — never shipped to the browser.
export function razorpayCreds(): RazorpayCreds {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? ""
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? ""
  return {
    keyId,
    keySecret,
    ready: keyId !== "" && keySecret !== "",
    auth: "Basic " + btoa(`${keyId}:${keySecret}`),
  }
}

type RazorpayResponse = {
  ok: boolean
  status: number
  // deno-lint-ignore no-explicit-any
  data: any
}

async function razorpayCall(
  method: string,
  path: string,
  auth: string,
  body?: any,
)// deno-lint-ignore no-explicit-any
: Promise<RazorpayResponse> {
  const res = await fetch("https://api.razorpay.com" + path, {
    method,
    headers: {
      Authorization: auth,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

export const razorpayGet = (path: string, auth: string) =>
  razorpayCall("GET", path, auth)

export const razorpayPost = (
  path: string,
  auth: string,
  // deno-lint-ignore no-explicit-any
  body: any,
) => razorpayCall("POST", path, auth, body)

// HMAC-SHA256 as lowercase hex (used for signature + webhook verification).
export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  )
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Constant-time string compare (hash first so lengths can differ safely).
export async function secureEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const digest = (s: string) =>
    crypto.subtle
      .digest("SHA-256", enc.encode(s))
      .then((buf) => new Uint8Array(buf))
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i]
  return diff === 0
}

// Service-role client: bypasses RLS for server-side writes.
export function adminDb() {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) return null
  return createClient(url, key)
}

// Confirms the caller really is a signed-in user (Supabase passes their JWT).
export async function requireUser(req: Request): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  const authHeader = req.headers.get("Authorization")
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}
