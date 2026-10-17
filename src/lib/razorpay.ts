// Flipkart/BigBasket-style online payments on top of Razorpay.
//
// The heavy lifting happens in Supabase Edge Functions (see
// supabase/functions/): create-order locks the amount server-side, verify
// checks Razorpay's signature, and the webhook acts as the source of truth.
// This file is only the browser side of that flow.

import { supabase } from "./supabase"

// ---------- Checkout script ----------
let rzpScript: Promise<boolean> | null = null

export function loadRazorpayScript(): Promise<boolean> {
  const w = window as unknown as { Razorpay?: unknown }
  if (w.Razorpay) return Promise.resolve(true)
  if (rzpScript) return rzpScript
  rzpScript = new Promise<boolean>((resolve) => {
    const s = document.createElement("script")
    s.src = "https://checkout.razorpay.com/v1/checkout.js"
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
  return rzpScript
}

// ---------- Server round-trips ----------
export type PayableItem = {
  name: string
  unit: string
  qty: number
  price: number
}

export type PayableOrder = {
  id: string
  customer: string
  username: string
  items: PayableItem[]
  subtotal: number
  delivery: number
  discount: number
  total: number
  address: string
  payment: string
  placedAt: string
  status: string
  lat?: number
  lng?: number
}

export type CreatedOrder = {
  ok: true
  razorpayOrderId: string
  keyId: string
  amount: number
}

// Multi-member literals stay in named multi-line types on purpose: oxfmt 0.2.0
// strips separators from literals it collapses onto one line (TS1005).
type PaymentFailure = {
  ok: false
  error: string
}

export type PaymentResult<T> = { ok: true } & T | PaymentFailure

type InvokeResult = {
  data: Record<string, unknown> | null
  error: string | null
}

async function invoke(
  fn: string,
  body: Record<string, unknown>,
): Promise<InvokeResult> {
  if (!supabase) return { data: null, error: "Payments are offline." }
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body })
    if (error) return { data: null, error: await describe(error) }
    return { data: (data ?? null) as InvokeResult["data"], error: null }
  } catch (error) {
    return { data: null, error: await describe(error) }
  }
}

// Turn Supabase function errors into something a shopper can act on.
async function describe(error: unknown): Promise<string> {
  const e = error as {
    message?: string
    context?: Response
  }
  try {
    if (e?.context && typeof e.context.json === "function") {
      const body = await e.context.json()
      // Custom errors use { error }, platform errors (e.g. 404 not deployed)
      // use { message }.
      const detail = body?.error ?? body?.message
      if (detail) return String(detail)
    }
  } catch {
    /* body already consumed */
  }
  const message = String(e?.message ?? "")
  if (/not.?found|non-2xx|404/i.test(message)) {
    return "Online payments are not set up on the server yet. Pay by cash on delivery."
  }
  if (
    /Failed to send a request|Failed to fetch|NetworkError|fetch/i.test(message)
  ) {
    return "Could not reach the payment server. Check your connection and try again."
  }
  if (/Relay/i.test(message)) return "Payment server unreachable. Try again."
  return message || "Payment server unreachable. Try again."
}

export type CartLine = {
  id: number
  qty: number
}

/** Step 1 — the server recomputes the amount and creates the Razorpay order. */
export async function createRazorpayOrder(input: {
  orderId: string
  items: CartLine[]
  discount: number
}): Promise<PaymentResult<CreatedOrder>> {
  const { data, error } = await invoke("razorpay-create-order", input)
  if (error) return { ok: false, error }
  if (!data?.razorpayOrderId || !data?.keyId) {
    return { ok: false, error: "Could not start the payment. Try again." }
  }
  return {
    ok: true,
    razorpayOrderId: String(data.razorpayOrderId),
    keyId: String(data.keyId),
    amount: Number(data.amount),
  }
}

// Payload the verify function returns on success (named so oxfmt cannot
// collapse the multi-member literal inside the union).
type VerifyResult = {
  amount: number
  payerVpa: string | null
}

/** Step 2 — verify Razorpay's signature, then the order is marked paid. */
export async function verifyRazorpayPayment(input: {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
  order: PayableOrder
}): Promise<PaymentResult<VerifyResult>> {
  const { data, error } = await invoke("razorpay-verify", input)
  if (error) return { ok: false, error }
  if (!data?.ok) return { ok: false, error: "Payment could not be verified." }
  return {
    ok: true,
    amount: Number(data.amount ?? input.order.total),
    payerVpa: data.payerVpa ? String(data.payerVpa) : null,
  }
}

// Payload the recovery check returns (named so oxfmt cannot collapse it).
type RecoveredPayment = {
  paid: boolean | null
  paymentId: string | null
  amount: number | null
  payerVpa: string | null
  error: string
}

/**
 * Recovery — paying through a real UPI app (webview_intent) can lose
 * Checkout's success callback on the way back to the app. Ask the server to
 * look the payment up on Razorpay by order id; if it is captured, the server
 * marks the order paid and returns the transaction id.
 */
export async function checkRazorpayPayment(input: {
  razorpayOrderId: string
  order: PayableOrder
}): Promise<RecoveredPayment> {
  const { data, error } = await invoke("razorpay-verify", input)
  if (error) {
    return { paid: null, paymentId: null, amount: null, payerVpa: null, error }
  }
  if (data?.ok) {
    return {
      paid: true,
      paymentId: data.paymentId ? String(data.paymentId) : null,
      amount: Number(data.amount ?? input.order.total),
      payerVpa: data.payerVpa ? String(data.payerVpa) : null,
      error: "",
    }
  }
  return {
    paid: data?.paid === false ? false : null,
    paymentId: null,
    amount: null,
    payerVpa: null,
    error: String(data?.error ?? "Payment could not be confirmed."),
  }
}

// True when the payment server is simply missing/not deployed — the only case
// where falling back to a Key-ID-only checkout is safe to attempt.
export const isPaymentServerSetupError = (message: string): boolean =>
  /offline|not set up|not configured|not found|unreachable|reach the payment/i.test(
    message,
  )

// ---------- Checkout sheet ----------
export type RazorpaySuccess = {
  paymentId: string
  orderId: string
  signature: string
}

// Named so oxfmt cannot collapse the multi-member literal (TS1005).
type RazorpayInstance = {
  open: () => void
  close?: () => void
  on?: (event: string, callback: () => void) => void
}

export async function openRazorpay(opts: {
  keyId: string
  razorpayOrderId?: string
  amount: number
  upiOnly?: boolean
  orderNote: string
  customerName: string
  customerEmail: string
  customerContact: string
  onSuccess: (result: RazorpaySuccess) => void
  onDismiss: () => void
}): Promise<void> {
  const ok = await loadRazorpayScript()
  const w = window as unknown as {
    Razorpay?: new (
      o: Record<string, unknown>,
    ) => RazorpayInstance
  }
  if (!ok || !w.Razorpay) {
    opts.onDismiss()
    return
  }
  let rzp: RazorpayInstance | null = null
  // A Razorpay checkout settles exactly once. The success handler and every
  // failure/cancel path (dismiss button, payment.error, back-navigation that
  // returns without a payment id) all funnel through this guard, so a
  // cancelled payment can never be reported as a success and a success can
  // never be overwritten by a late dismiss. Whichever fires first wins; any
  // later callback is ignored.
  let settled = false
  const closeSheet = () => {
    try {
      rzp?.close?.()
    } catch {
      /* already closed */
    }
  }
  const settleDismiss = () => {
    if (settled) return
    settled = true
    closeSheet()
    opts.onDismiss()
  }
  const settleSuccess = (response: {
    razorpay_order_id?: string
    razorpay_payment_id?: string
    razorpay_signature?: string
  }) => {
    if (settled) return
    // Some Android UPI flows bounce back with an empty payment id after a
    // cancelled intent — that is a cancel, never a success.
    if (!response?.razorpay_payment_id) {
      settleDismiss()
      return
    }
    settled = true
    closeSheet()
    opts.onSuccess({
      paymentId: String(response.razorpay_payment_id ?? ""),
      orderId: String(response.razorpay_order_id ?? ""),
      signature: String(response.razorpay_signature ?? ""),
    })
  }
  const options: Record<string, unknown> = {
    key: opts.keyId,
    amount: Math.round(opts.amount * 100), // paise — matches the server order
    currency: "INR",
    name: "GS",
    description: opts.orderNote,
    image: "icon-512.png",
    prefill: {
      name: opts.customerName,
      email: opts.customerEmail,
      contact: opts.customerContact,
    },
    theme: { color: "#087f5b" },
    // UPI intent (handing off to the customer's real UPI app) only works with
    // a LIVE key — a test key's VPA is rejected by real UPI apps ("UPI ID is
    // invalid"). With a test key the payment stays inside the Razorpay sheet,
    // where success@razorpay / failure@razorpay complete the test.
    webview_intent: !opts.keyId.startsWith("rzp_test_"),
    handler: settleSuccess,
    modal: { ondismiss: settleDismiss },
  }
  if (opts.razorpayOrderId) options.order_id = opts.razorpayOrderId
  if (opts.upiOnly) {
    // UPI-only sheet: it shows the UPI app list — no extra screen between the
    // customer and paying.
    options.method = {
      netbanking: false,
      card: false,
      wallet: false,
      emi: false,
      paylater: false,
      upi: true,
    }
  } else {
    // Full "Pay online" sheet: cards, netbanking and wallet only — the store
    // never offers EMI or Pay Later.
    options.method = {
      emi: false,
      paylater: false,
    }
  }
  rzp = new w.Razorpay(options)
  // A payment that fails inside the sheet returns the customer to the
  // payment step — never looks like a success.
  rzp.on?.("payment.error", settleDismiss)
  rzp.open()
}
