// razorpay-verify — step 2 of the Flipkart/BigBasket-style flow.
//
// The client's "payment succeeded" callback is never trusted on its own:
// the Razorpay signature is verified with the Key Secret, the payment is
// re-fetched from Razorpay, and only then is the order marked paid and the
// transaction recorded (transaction id + order details into the database).
//
// Recovery mode: paying through a real UPI app (webview_intent) can lose
// Checkout's success callback on the way back to the app. In that case the
// client sends only the Razorpay order id — we look the payment up on
// Razorpay directly and, if it is captured, complete the same checks and
// record the order. Razorpay is the authority in both paths.
import {
  adminDb,
  corsHeaders,
  hmacHex,
  json,
  razorpayCreds,
  razorpayGet,
  requireUser,
  secureEquals,
} from "../_shared/razorpay.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  try {
    const userId = await requireUser(req)
    if (!userId) return json({ error: "Please sign in to pay online." }, 401)

    const creds = razorpayCreds()
    const db = adminDb()
    if (!creds.ready || !db) {
      return json({ error: "Payment server is not configured." }, 503)
    }

    const body = await req.json()
    const razorpayOrderId = String(body.razorpayOrderId ?? "")
    const razorpayPaymentId = String(body.razorpayPaymentId ?? "")
    const signature = String(body.razorpaySignature ?? "")
    const order = body.order
    if (!razorpayOrderId || !order?.id) {
      return json({ error: "Missing payment details." }, 400)
    }

    // 1. Signature proves Razorpay issued this payment for this order id —
    //    unless we are in recovery mode (no signature), where the payment is
    //    looked up on Razorpay by order id instead. Both paths end with the
    //    payment re-fetched from the gateway below.
    let paymentId = razorpayPaymentId
    if (paymentId && signature) {
      const expected = await hmacHex(
        creds.keySecret,
        `${razorpayOrderId}|${paymentId}`,
      )
      if (!(await secureEquals(expected, signature))) {
        return json({ error: "Payment signature verification failed." }, 400)
      }
    } else if (!paymentId) {
      const listRes = await razorpayGet(
        `/v1/payments?order_id=${encodeURIComponent(razorpayOrderId)}&count=10`,
        creds.auth,
      )
      if (!listRes.ok) {
        return json(
          { error: "Could not check the payment with Razorpay." },
          502,
        )
      }
      // deno-lint-ignore no-explicit-any
      const payments: any[] = Array.isArray(listRes.data?.items)
        ? listRes.data.items
        : []
      const captured =
        payments.find((p) => String(p.status) === "captured") ??
        payments.find((p) => String(p.status) === "authorized")
      if (!captured) {
        return json({
          ok: false,
          paid: false,
          error: "No payment was found for this order — no money was received.",
        })
      }
      paymentId = String(captured.id)
    } else {
      return json({ error: "Missing payment details." }, 400)
    }

    // 2. Re-fetch both records from Razorpay — the gateway is the authority.
    const paymentRes = await razorpayGet(
      `/v1/payments/${paymentId}`,
      creds.auth,
    )
    const orderRes = await razorpayGet(
      `/v1/orders/${razorpayOrderId}`,
      creds.auth,
    )
    if (!paymentRes.ok || !orderRes.ok) {
      return json(
        { error: "Could not confirm the payment with Razorpay." },
        502,
      )
    }
    const payment = paymentRes.data
    const gatewayOrder = orderRes.data
    if (
      payment.order_id !== razorpayOrderId ||
      gatewayOrder.id !== razorpayOrderId ||
      !["captured", "authorized"].includes(String(payment.status)) ||
      Number(payment.amount) !== Number(gatewayOrder.amount)
    ) {
      return json({ error: "Payment could not be confirmed." }, 400)
    }

    // 3. The order on screen must be the order that was paid, for the same
    //    amount that was locked at create-order time.
    const totalRupees = Math.round(Number(order.total))
    if (
      String(gatewayOrder.receipt) !== String(order.id) ||
      Number(gatewayOrder.amount) !== totalRupees * 100
    ) {
      return json({ error: "Order and payment do not match." }, 400)
    }

    const amountRupees = Number(payment.amount) / 100
    const method = String(payment.method ?? "")
    // deno-lint-ignore no-explicit-any
    const acquirer = (payment as any).acquirer_data ?? {}
    const paidAt = new Date(
      Number(payment.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
    ).toISOString()

    // 4. Mark the order paid + record the transaction (idempotent upserts).
    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
    await db.from("orders").upsert(
      {
        id: String(order.id),
        user_id: profile ? userId : null,
        customer: String(order.customer ?? ""),
        username: String(order.username ?? ""),
        items: order.items ?? [],
        subtotal: Number(order.subtotal ?? 0),
        delivery: Number(order.delivery ?? 0),
        discount: Number(order.discount ?? 0),
        total: totalRupees,
        address: String(order.address ?? ""),
        payment: String(order.payment ?? "Online · Razorpay"),
        status: "Placed",
        lat: order.lat ?? null,
        lng: order.lng ?? null,
        placed_at: order.placedAt ?? paidAt,
        payment_status: "paid",
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: paymentId,
      },
      { onConflict: "id" },
    )
    await db.from("payments").upsert(
      {
        id: paymentId, // the transaction id
        order_id: String(order.id),
        customer: String(order.customer ?? ""),
        username: String(order.username ?? ""),
        amount: amountRupees,
        method: "Online",
        upi_app: method === "upi" ? "UPI via Razorpay" : null,
        payer_vpa: acquirer.upi_vpa ?? null,
        status: "success",
        note: `Razorpay ${method || "payment"} · ${paymentId}`,
        created_at: paidAt,
      },
      { onConflict: "id" },
    )

    return json({
      ok: true,
      paid: true,
      amount: amountRupees,
      paymentId: paymentId,
      payerVpa: acquirer.upi_vpa ?? null,
    })
  } catch (_error) {
    return json({ error: "Could not verify the payment. Try again." }, 500)
  }
})
