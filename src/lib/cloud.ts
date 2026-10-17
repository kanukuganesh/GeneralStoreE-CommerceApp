import { supabase, isCloud } from "./supabase"

// ---------- App-facing shapes (structural mirrors of App.tsx types) ----------
export type CloudProfile = {
  username: string
  name: string
  phone: string
  isAdmin: boolean
}

export type CloudProduct = {
  id: number
  name: string
  unit: string
  price: number
  old: number
  discount: string
  image: string
  emoji: string
  category: string
  stock: number
  sku: string
}

export type CloudOrderItem = {
  name: string
  unit: string
  qty: number
  price: number
}

export type CloudOrder = {
  id: string
  userId: string | null
  customer: string
  username: string
  items: CloudOrderItem[]
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

export type CloudAddress = {
  id: number
  label: string
  name: string
  phone: string
  line: string
  pincode: string
  isDefault: boolean
  lat?: number
  lng?: number
  house?: string
  colony?: string
  city?: string
  mandal?: string
  district?: string
  state?: string
}

// Synthetic email so Supabase Auth (email-based) can represent a username login.
// The domain must resolve on the public DNS or Supabase rejects the address.
const toEmail = (username: string) =>
  `${username.trim().toLowerCase()}@greeno.store`

const num = (value: unknown) => Number(value ?? 0)

// ---------- AUTH ----------
export async function cloudSignUp(
  username: string,
  name: string,
  password: string,
): Promise<string | null> {
  if (!supabase) return "Cloud not configured."
  const { error } = await supabase.auth.signUp({
    email: toEmail(username),
    password,
    options: { data: { username: username.trim(), name: name.trim() } },
  })
  if (error) return friendlyAuthError(error.message, username)
  return null
}

export async function cloudSignIn(username: string, password: string): Promise<{
  error: string | null
  username: string | null
}> {
  if (!supabase) return { error: "Cloud not configured.", username: null }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: toEmail(username),
    password,
  })
  if (error)
    return { error: friendlyAuthError(error.message, username), username: null }
  const profile = await cloudFetchProfile(data.user?.id ?? "")
  return { error: null, username: profile?.username ?? username.trim() }
}

export async function cloudSignOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut().catch(() => undefined)
}

export async function cloudCurrentUsername(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return null
  const profile = await cloudFetchProfile(userId)
  return profile?.username ?? null
}

export async function cloudUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

export async function cloudFetchProfile(
  userId: string,
): Promise<CloudProfile | null> {
  if (!supabase || !userId) return null
  const { data } = await supabase
    .from("profiles")
    .select("username, name, phone, is_admin")
    .eq("id", userId)
    .maybeSingle()
  if (!data) return null
  return {
    username: String(data.username ?? ""),
    name: String(data.name ?? ""),
    phone: String(data.phone ?? ""),
    isAdmin: Boolean(data.is_admin),
  }
}

export async function cloudUpdateProfile(
  name: string,
  phone: string,
): Promise<string | null> {
  if (!supabase) return "Cloud not configured."
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return "Please sign in again."
  const { error } = await supabase
    .from("profiles")
    .update({ name, phone })
    .eq("id", userId)
  return error ? error.message : null
}

export async function cloudUpdatePassword(
  newPassword: string,
): Promise<string | null> {
  if (!supabase) return "Cloud not configured."
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return error ? error.message : null
}

function friendlyAuthError(message: string, username: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("already registered") || lower.includes("already exists"))
    return "This username already exists. Please choose another one."
  if (lower.includes("invalid login"))
    return "Incorrect username or password. Try again."
  if (lower.includes("password"))
    return "Password must be at least 6 characters."
  return message || `Could not sign in as ${username}.`
}

// ---------- PRODUCTS ----------
function rowToProduct(row: Record<string, unknown>): CloudProduct {
  return {
    id: num(row.id),
    name: String(row.name ?? ""),
    unit: String(row.unit ?? ""),
    price: num(row.price),
    old: num(row.old),
    discount: String(row.discount ?? ""),
    image: String(row.image ?? ""),
    emoji: String(row.emoji ?? ""),
    category: String(row.category ?? ""),
    stock: num(row.stock),
    sku: String(row.sku ?? ""),
  }
}

export async function cloudListProducts(): Promise<CloudProduct[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("id", { ascending: false })
  if (error) return null
  return (data ?? []).map(rowToProduct)
}

export async function cloudUpsertProduct(
  product: CloudProduct,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from("products").upsert({
    id: product.id,
    name: product.name,
    unit: product.unit,
    price: product.price,
    old: product.old,
    discount: product.discount,
    image: product.image,
    emoji: product.emoji,
    category: product.category,
    stock: product.stock,
    sku: product.sku,
  })
  return !error
}

export async function cloudDeleteProduct(id: number): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from("products").delete().eq("id", id)
  return !error
}

export async function cloudSeedProducts(
  products: CloudProduct[],
): Promise<boolean> {
  if (!supabase || !products.length) return false
  const { error } = await supabase.from("products").upsert(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      price: p.price,
      old: p.old,
      discount: p.discount,
      image: p.image,
      emoji: p.emoji,
      category: p.category,
      stock: p.stock,
      sku: p.sku,
    })),
  )
  return !error
}

// Live realtime updates for products + orders. Returns an unsubscribe fn.
export function cloudSubscribe(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const channel = supabase
    .channel("greeno-live")
    .on("postgres_changes", { event: "*", schema: "public" }, onChange)
    .subscribe()
  return () => {
    void supabase?.removeChannel(channel)
  }
}

// ---------- ORDERS ----------
function rowToOrder(row: Record<string, unknown>): CloudOrder {
  return {
    id: String(row.id ?? ""),
    userId: row.user_id as string ?? null,
    customer: String(row.customer ?? ""),
    username: String(row.username ?? ""),
    items: row.items as CloudOrderItem[] ?? [],
    subtotal: num(row.subtotal),
    delivery: num(row.delivery),
    discount: num(row.discount),
    total: num(row.total),
    address: String(row.address ?? ""),
    payment: String(row.payment ?? ""),
    placedAt: String(row.placed_at ?? new Date().toISOString()),
    status: String(row.status ?? "Placed"),
    lat: row.lat == null ? undefined : num(row.lat),
    lng: row.lng == null ? undefined : num(row.lng),
  }
}

export async function cloudListOrders(): Promise<CloudOrder[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("placed_at", { ascending: false })
  if (error) return null
  return (data ?? []).map(rowToOrder)
}

export async function cloudInsertOrder(
  order: CloudOrder,
  userId?: string | null,
): Promise<boolean> {
  if (!supabase) return false
  const owner = userId ?? (await cloudUserId())
  // Upsert: the payment server may have written this order already
  // (razorpay-verify marks it paid) — never clobber that with a plain insert.
  const { error } = await supabase.from("orders").upsert(
    {
      id: order.id,
      user_id: owner,
      customer: order.customer,
      username: order.username,
      items: order.items,
      subtotal: order.subtotal,
      delivery: order.delivery,
      discount: order.discount,
      total: order.total,
      address: order.address,
      payment: order.payment,
      status: order.status,
      lat: order.lat ?? null,
      lng: order.lng ?? null,
    },
    { onConflict: "id" },
  )
  return !error
}

// Admin updates an order's fulfilment status (Placed → Packed → Out for
// delivery → Delivered). Requires the caller's session to be an admin
// (enforced by the orders_admin_update RLS policy). Realtime broadcasts the
// change so the customer sees it immediately.
export async function cloudUpdateOrderStatus(
  id: string,
  status: string,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", id)
  return !error
}

// Best-effort: mirror a payment/transaction to the payments table so the admin
// can review them. Silently no-ops if the table doesn't exist yet (the local
// ledger in App.tsx is the source of truth until the migration is applied).
export async function cloudInsertPayment(payment: {
  id: string
  orderId: string
  customer: string
  username: string
  amount: number
  method: string
  upiApp?: string
  merchantVpa?: string
  payerVpa?: string
  status: string
  timestamp: string
  note?: string
}): Promise<boolean> {
  if (!supabase) return false
  // Upsert on the transaction id: razorpay-verify/webhook may have already
  // written this row, and the local ledger must not duplicate it.
  const { error } = await supabase.from("payments").upsert(
    {
      id: payment.id,
      order_id: payment.orderId,
      customer: payment.customer,
      username: payment.username,
      amount: payment.amount,
      method: payment.method,
      upi_app: payment.upiApp ?? null,
      merchant_vpa: payment.merchantVpa ?? null,
      payer_vpa: payment.payerVpa ?? null,
      status: payment.status,
      note: payment.note ?? null,
      created_at: payment.timestamp,
    },
    { onConflict: "id" },
  )
  return !error
}

// ---------- ADDRESSES ----------
function rowToAddress(row: Record<string, unknown>): CloudAddress {
  return {
    id: num(row.id),
    label: String(row.label ?? "Home"),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    line: String(row.line ?? ""),
    pincode: String(row.pincode ?? ""),
    isDefault: Boolean(row.is_default),
    lat: row.lat == null ? undefined : num(row.lat),
    lng: row.lng == null ? undefined : num(row.lng),
    house: String(row.house ?? ""),
    colony: String(row.colony ?? ""),
    city: String(row.city ?? ""),
    mandal: String(row.mandal ?? ""),
    district: String(row.district ?? ""),
    state: String(row.state ?? ""),
  }
}

export async function cloudListAddresses(
  userId: string,
): Promise<CloudAddress[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
  if (error) return null
  return (data ?? []).map(rowToAddress)
}

export async function cloudSaveAddress(
  userId: string,
  address: Omit<CloudAddress, "id"> & { id?: number },
): Promise<number | null> {
  if (!supabase) return null
  const payload = {
    user_id: userId,
    label: address.label,
    name: address.name,
    phone: address.phone,
    line: address.line,
    pincode: address.pincode,
    is_default: address.isDefault,
    lat: address.lat ?? null,
    lng: address.lng ?? null,
    house: address.house ?? "",
    colony: address.colony ?? "",
    city: address.city ?? "",
    mandal: address.mandal ?? "",
    district: address.district ?? "",
    state: address.state ?? "",
  }
  if (address.id && address.id > 0) {
    const { error } = await supabase
      .from("addresses")
      .update(payload)
      .eq("id", address.id)
      .eq("user_id", userId)
    return error ? null : address.id
  }
  const { data, error } = await supabase
    .from("addresses")
    .insert(payload)
    .select("id")
    .single()
  return error ? null : num(data?.id)
}

export async function cloudDeleteAddress(
  userId: string,
  id: number,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from("addresses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
  return !error
}

export async function cloudSetDefaultAddress(
  userId: string,
  id: number,
): Promise<boolean> {
  if (!supabase) return false
  await supabase
    .from("addresses")
    .update({ is_default: false })
    .eq("user_id", userId)
  const { error } = await supabase
    .from("addresses")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", userId)
  return !error
}

// ---------- WISHLIST ----------
export async function cloudListWishlist(
  userId: string,
): Promise<number[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("wishlist")
    .select("product_id")
    .eq("user_id", userId)
  if (error) return null
  return (data ?? []).map((row) => num(row.product_id))
}

export async function cloudSetWishlist(
  userId: string,
  productIds: number[],
): Promise<boolean> {
  if (!supabase) return false
  await supabase.from("wishlist").delete().eq("user_id", userId)
  if (!productIds.length) return true
  const { error } = await supabase.from("wishlist").upsert(
    productIds.map((productId) => ({
      user_id: userId,
      product_id: productId,
    })),
  )
  return !error
}

// ---------- SITE SETTINGS (shared payment config) ----------
// The admin's Razorpay Key ID / UPI settings live here so every phone sees
// the same payment options — not just the device where the admin typed them.
export async function cloudGetSetting<T>(key: string): Promise<T | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle()
  if (error || !data?.value) return null
  return data.value as T
}

export async function cloudSetSetting(
  key: string,
  value: Record<string, unknown>,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from("site_settings").upsert(
    {
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  )
  return !error
}

export { isCloud }
