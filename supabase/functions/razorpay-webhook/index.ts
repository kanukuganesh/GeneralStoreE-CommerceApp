// razorpay-webhook — step 3 (source of truth).
//
// Razorpay calls this server-to-server after a payment is captured or fails,
// even if the customer's app closed mid-payment. Signature is checked with
// RAZORPAY_WEBHOOK_SECRET; the order/payment rows are then updated from the
// gateway's own records.
import {
  adminDb,
  corsHeaders,
  hmacHex,
  json,
  razorpayCreds,
  razorpayGet,
  secureEquals,
} from "../_shared/razorpay.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  try {
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")
    if (!secret) {
      return json(
        { error: "RAZORPAY_WEBHOOK_SECRET is not set on the server." },
        500,
      )
    }
    const raw = await req.text()
    const signature = req.headers.get("x-razorpay-signature") ?? ""
    const expected = await hmacHex(secret, raw)
    if (!(await secureEquals(expected, signature))) {
      return json({ error: "Invalid webhook signature." }, 401)
    }

    const event = JSON.parse(raw)
    const eventName = String(event?.event ?? "")
    // deno-lint-ignore no-explicit-any
    const payment = (event?.payload as any)?.payment?.entity
    if (!payment?.id || !payment?.order_id) return json({ ok: true })

    const creds = razorpayCreds()
    const db = adminDb()
    if (!creds.ready || !db) {
      return json({ error: "Payment server is not configured." }, 500)
    }

    const gatewayOrder = await razorpayGet(
      `/v1/orders/${payment.order_id}`,
      creds.auth,
    )
    const localOrderId = String(gatewayOrder.data?.receipt ?? "")
    const amountRupees = Number(payment.amount ?? 0) / 100
    const method = String(payment.method ?? "")

    const { data: orderRow } = await db
      .from("orders")
      .select("id, customer, username")
      .eq("id", localOrderId)
      .maybeSingle()

    if (eventName === "payment.captured") {
      if (orderRow) {
        await db
          .from("orders")
          .update({
            payment_status: "paid",
            razorpay_order_id: String(payment.order_id),
            razorpay_payment_id: String(payment.id),
          })
          .eq("id", localOrderId)
      }
      await db.from("payments").upsert(
        {
          id: String(payment.id),
          order_id: localOrderId,
          customer: orderRow?.customer ?? "",
          username: orderRow?.username ?? "",
          amount: amountRupees,
          method: "Online",
          upi_app: method === "upi" ? "UPI via Razorpay" : null,
          status: "success",
          note: orderRow
            ? `Razorpay ${method} (webhook) · ${payment.id}`
            : `Razorpay ${method} (webhook, order pending) · ${payment.id}`,
          created_at: new Date(
            Number(payment.created_at ?? 0) * 1000,
          ).toISOString(),
        },
        { onConflict: "id" },
      )
      return json({ ok: true })
    }

    if (eventName === "payment.failed") {
      if (orderRow) {
        await db
          .from("orders")
          .update({ payment_status: "failed" })
          .eq("id", localOrderId)
        await db.from("payments").upsert(
          {
            id: String(payment.id),
            order_id: localOrderId,
            customer: orderRow.customer,
            username: orderRow.username,
            amount: amountRupees,
            method: "Online",
            status: "failed",
            note: `Razorpay ${method} failed · ${payment.error_description ?? ""}`,
            created_at: new Date(
              Number(payment.created_at ?? 0) * 1000,
            ).toISOString(),
          },
          { onConflict: "id" },
        )
      }
      return json({ ok: true })
    }

    return json({ ok: true })
  } catch (_error) {
    return json({ error: "Webhook processing failed." }, 500)
  }
})
