// razorpay-create-order — step 1 of the Flipkart/BigBasket-style flow.
//
// The browser never decides what it pays: the payable amount is recomputed
// here from the store's own product prices, then locked into a Razorpay
// order. The client receives only { razorpayOrderId, keyId, amount } and
// opens Razorpay Checkout with that order id.
import {
  adminDb,
  corsHeaders,
  json,
  razorpayCreds,
  razorpayPost,
  requireUser,
} from "../_shared/razorpay.ts"

// Keep in sync with src/App.tsx.
const FREE_DELIVERY_OVER = 499
const DELIVERY_FEE = 40
const MAX_PROMO_PCT = 0.1

type Line = {
  id?: number
  qty?: number
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  try {
    const userId = await requireUser(req)
    if (!userId) {
      return json({ error: "Please sign in to pay online." }, 401)
    }
    const creds = razorpayCreds()
    if (!creds.ready) {
      return json(
        {
          error:
            "Online payments are not configured yet. Use cash on delivery.",
        },
        503,
      )
    }
    const db = adminDb()
    if (!db) return json({ error: "Payment server is not configured." }, 503)

    const body = await req.json()
    const orderId = String(body.orderId ?? "")
    const items: Line[] = Array.isArray(body.items) ? body.items : []
    const clientDiscount = Number(body.discount ?? 0)
    if (!/^GRN-\d{4,}$/.test(orderId)) {
      return json({ error: "Invalid checkout request." }, 400)
    }
    if (items.length === 0) {
      return json(
        { error: "Your cart is empty — add items before checkout." },
        400,
      )
    }

    // --- Recompute the total from the products table (client cannot tamper). ---
    const ids = [...new Set(items.map((line) => Number(line.id)))]
    const { data: rows, error: priceError } = await db
      .from("products")
      .select("id, price")
      .in("id", ids)
    if (priceError || !rows) {
      return json({ error: "Could not read product prices. Try again." }, 502)
    }
    const priceById = new Map(rows.map((r) => [Number(r.id), Number(r.price)]))
    let subtotal = 0
    for (const line of items) {
      const price = priceById.get(Number(line.id))
      const qty = Number(line.qty)
      if (price == null || !Number.isFinite(qty) || qty < 1 || qty > 999) {
        return json(
          { error: "Your cart changed. Refresh the page and try again." },
          409,
        )
      }
      subtotal += price * qty
    }
    const discount = Math.min(
      Math.max(0, Number.isFinite(clientDiscount) ? clientDiscount : 0),
      Math.round(subtotal * MAX_PROMO_PCT),
    )
    const delivery = subtotal > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE
    const amount = Math.round(subtotal - discount + delivery)
    if (!(amount > 0)) return json({ error: "Invalid amount." }, 400)

    // --- Create the gateway order; amount is locked at this point. ---
    const created = await razorpayPost("/v1/orders", creds.auth, {
      amount: amount * 100,
      currency: "INR",
      receipt: orderId,
      notes: { order_id: orderId },
    })
    if (!created.ok || !created.data?.id) {
      return json(
        {
          error:
            created.data?.error?.description ??
            "Payment gateway is unreachable. Try again.",
        },
        502,
      )
    }

    return json({
      razorpayOrderId: String(created.data.id),
      keyId: creds.keyId,
      amount,
      userId,
    })
  } catch (_error) {
    return json({ error: "Could not start the payment. Try again." }, 500)
  }
})
