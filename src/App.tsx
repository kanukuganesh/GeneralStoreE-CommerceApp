import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Geolocation } from "@capacitor/geolocation"
import { App as CapApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { categories, products } from "./catalog"
import type { Product } from "./catalog"
import { searchProducts } from "./search"
import {
  isCloud,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  cloudUserId,
  cloudUpdateProfile,
  cloudUpdatePassword,
  cloudListProducts,
  cloudUpsertProduct,
  cloudDeleteProduct,
  cloudSeedProducts,
  cloudListOrders,
  cloudInsertOrder,
  cloudUpdateOrderStatus,
  cloudInsertPayment,
  cloudListAddresses,
  cloudSaveAddress,
  cloudDeleteAddress,
  cloudListWishlist,
  cloudSetWishlist,
  cloudGetSetting,
  cloudSetSetting,
  cloudSubscribe,
} from "./lib/cloud"
import {
  checkRazorpayPayment,
  createRazorpayOrder,
  isPaymentServerSetupError,
  openRazorpay,
  verifyRazorpayPayment,
} from "./lib/razorpay"

// Live-key UPI payments hand off to the real UPI app — Checkout's success
// callback can be lost on the way back to the app. This pending state powers
// the "Yes, I paid — check" recovery card on the payment step.
type PayRecovery = {
  order: Order
  rzpOrderId: string
  note: string
  busy: boolean
}

type IconName = "home" | "grid" | "tag" | "cart" | "user" | "search" | "map" | "bell" | "chevron" | "arrow" | "back" | "plus" | "minus" | "check" | "package" | "orders" | "users" | "settings" | "menu" | "close" | "edit" | "trash" | "trend" | "alert" | "heart" | "wallet" | "ticket" | "pin" | "card" | "gift" | "help" | "phone" | "chat" | "copy" | "star" | "lock" | "truck" | "eye" | "eye-off"

type Account = {
  name: string
  username: string
  password: string
  phone: string
}

type Address = {
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

type OrderItem = {
  id?: number
  name: string
  unit: string
  qty: number
  price: number
}

type Order = {
  id: string
  customer: string
  username: string
  items: OrderItem[]
  subtotal: number
  delivery: number
  discount: number
  total: number
  address: string
  payment: string
  placedAt: string
  status: OrderStatus
  lat?: number
  lng?: number
  statusHistory?: OrderStatusEvent[]
}

const ORDER_STAGES = [
  "Placed",
  "Packed",
  "Out for delivery",
  "Delivered",
] as const

type OrderStatus = typeof ORDER_STAGES[number]

type OrderStatusEvent = {
  status: OrderStatus
  at: string
}

const stageIndexOf = (status: string) => {
  const index = ORDER_STAGES.indexOf(status as OrderStatus)
  return index === -1 ? 0 : index
}

// Timestamp for a stage: from history if present, else placedAt for the first
// stage, else the most recent known time (best-effort).
const stageTime = (order: Order, stage: OrderStatus) => {
  const fromHistory = order.statusHistory?.find((e) => e.status === stage)
  if (fromHistory) return fromHistory.at
  if (stage === "Placed") return order.placedAt
  return undefined
}

const formatINR = (value: number) =>
  "₹" +
  value.toLocaleString("en-IN", { maximumFractionDigits: value % 1 ? 2 : 0 })

const FREE_DELIVERY_OVER = 499
const DELIVERY_FEE = 40
const ADMIN_USERNAME = "Ganesh"
const ADMIN_PASSWORD = "Ganesh@7780"

type AddressParts = {
  house: string
  colony: string
  city: string
  pincode: string
  mandal: string
  district: string
  state: string
}

type GeoResult = {
  lat: number
  lng: number
  accuracy: number | null
  parts: AddressParts
  line: string
}

const EMPTY_PARTS: AddressParts = {
  house: "",
  colony: "",
  city: "",
  pincode: "",
  mandal: "",
  district: "",
  state: "",
}

const mapsLink = (lat: number, lng: number) =>
  `https://maps.google.com/?q=${lat},${lng}`

const composeAddressLine = (parts: Partial<AddressParts>): string => {
  const raw = [
    parts.house,
    parts.colony,
    parts.city,
    parts.mandal,
    parts.district,
    parts.state,
    parts.pincode,
  ].filter((piece): piece is string => !!piece && piece.trim() !== "")
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw) {
    const key = piece.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(piece.trim())
    }
  }
  return out.join(", ")
}

async function getGpsPosition(): Promise<{
  lat: number
  lng: number
  accuracy: number | null
}> {
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
    })
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy:
        typeof position.coords.accuracy === "number"
          ? Math.round(position.coords.accuracy)
          : null,
    }
  } catch {
    const position = await new Promise<GeolocationPosition>(
      (resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Location is not available on this device."))
          return
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        })
      },
    ).catch((error: GeolocationPositionError | Error) => {
      if (error instanceof GeolocationPositionError) {
        if (error.code === error.PERMISSION_DENIED)
          throw new Error(
            "Location permission denied. Allow location access, or pin your address on the map instead.",
          )
        if (error.code === error.TIMEOUT)
          throw new Error(
            "Could not get your location in time. Try again, or pin your address on the map.",
          )
      }
      throw new Error(
        "Could not get your location. Try again, or pin your address on the map.",
      )
    })
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy:
        typeof position.coords.accuracy === "number"
          ? Math.round(position.coords.accuracy)
          : null,
    }
  }
}

async function reverseGeocode(lat: number, lng: number): Promise<AddressParts> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`,
      { headers: { Accept: "application/json" } },
    )
    const data = (await response.json()) as {
      display_name?: string
      address?: Record<string, string>
    }
    const area = data.address ?? {}
    return {
      house: [area.house_number, area.building]
        .filter(Boolean)
        .join(" ")
        .trim(),
      colony: [
        area.road,
        area.neighbourhood ||
          area.suburb ||
          area.quarter ||
          area.locality ||
          area.hamlet,
      ]
        .filter(Boolean)
        .join(", "),
      city:
        area.city || area.town || area.municipality || area.city_district || "",
      pincode: area.postcode ?? "",
      mandal: area.taluk || area.tehsil || area.mandal || area.siy || "",
      district: area.state_district || area.district || area.county || "",
      state: area.state ?? "",
    }
  } catch {
    return EMPTY_PARTS
  }
}

async function detectLocation(): Promise<GeoResult> {
  const gps = await getGpsPosition()
  const parts = await reverseGeocode(gps.lat, gps.lng)
  const line =
    composeAddressLine(parts) ||
    `Pinned location, ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
  return { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, parts, line }
}

function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function saveState<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable — state stays in memory
  }
}

// ---- UPI payment config (set by the admin, shared with checkout) ----
type UpiConfig = {
  vpa: string
  enabled: boolean
}
// No default VPA — the admin adds their own real bank UPI ID in Admin → Payments.
// UPI is only offered at checkout when the admin toggle is on and a Razorpay
// Key ID is saved (Razorpay settles to the store's own account, so the admin
// VPA is only kept as a reference on the payment record).
const DEFAULT_UPI: UpiConfig = { vpa: "", enabled: true }
const loadUpi = () => loadState<UpiConfig>("greeno_upi", DEFAULT_UPI)
const saveUpi = (cfg: UpiConfig) => saveState("greeno_upi", cfg)

// ---------- Payment gateway (Razorpay) ----------
// Both "Pay online" and "UPI" run Flipkart/BigBasket-style: a Supabase Edge
// Function (razorpay-create-order) locks the amount into a Razorpay order,
// Razorpay Checkout collects the money (UPI-only sheet for UPI — it opens the
// chosen UPI app directly and reports success/failure back), and only a
// verified signature — or the gateway's webhook — marks the order paid. Until
// the payment server is deployed, a saved Key ID alone opens Checkout in
// client-only mode and the server path takes over automatically once it is.
// The Key Secret never leaves the server. See src/lib/razorpay.ts.
type GatewayConfig = {
  razorpayKeyId: string
  enabled: boolean
}
// `enabled` is the admin's master switch: when off, no phone shows UPI or
// Pay online — the store takes orders by cash on delivery only.
const loadGateway = (): GatewayConfig => {
  const stored = loadState<Partial<GatewayConfig>>("greeno_gateway", {})
  return {
    razorpayKeyId: String(stored.razorpayKeyId ?? ""),
    enabled: stored.enabled !== false,
  }
}
const saveGateway = (cfg: GatewayConfig) => saveState("greeno_gateway", cfg)

// ---------- Payments / transactions (Flipkart-style ledger) ----------
type Payment = {
  id: string // transaction id, e.g. TXN-8F3K2Q
  orderId: string
  customer: string
  username: string
  amount: number
  method: "UPI" | "Online" | "Cash on delivery"
  upiApp?: string
  merchantVpa?: string
  payerVpa?: string
  status: "success" | "pending" | "failed" | "cod"
  timestamp: string
  note?: string
}

const newTxnId = () =>
  "TXN-" + Math.random().toString(36).slice(2, 8).toUpperCase()

const loadPayments = () => loadState<Payment[]>("greeno_payments", [])
const savePayments = (list: Payment[]) => saveState("greeno_payments", list)

const paymentStatusLabel: Record<Payment["status"], string> = {
  success: "Paid",
  pending: "Pending",
  failed: "Failed",
  cod: "Cash on delivery",
}

type IconProps = {
  name: IconName
  size?: number
}

function Icon({ name, size = 20 }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    tag: (
      <>
        <path d="M20 13 11 22l-9-9V4h9z" />
        <path d="M7 8h.01" />
      </>
    ),
    cart: (
      <>
        <path d="M3 3h2l2.4 11h10.8l2-7H6" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    map: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <path d="m19 12-7-7v4H5v6h7v4z" />,
    back: (
      <>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    minus: <path d="M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    package: (
      <>
        <path d="m4 7 8-4 8 4-8 4z" />
        <path d="M4 7v10l8 4 8-4V7" />
        <path d="M12 11v10" />
      </>
    ),
    orders: (
      <>
        <path d="M6 3h12v18H6z" />
        <path d="M9 7h6M9 11h6M9 15h4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21h-3.6v-.2A2 2 0 0 0 9 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.6 15a2 2 0 0 0-1.8-1.2H3v-3.6h.2A2 2 0 0 0 5 9a2 2 0 0 0-.4-2.2l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 9 4.6a2 2 0 0 0 1.2-1.8V3h3.6v.2A2 2 0 0 0 15 5a2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.2v3.6h-.2A2 2 0 0 0 19.4 15Z" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    edit: (
      <>
        <path d="m4 16-1 5 5-1L19 9l-4-4z" />
        <path d="m13 7 4 4" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" />
      </>
    ),
    trend: (
      <>
        <path d="m3 17 6-6 4 4 8-9" />
        <path d="M15 6h6v6" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2 21h20z" />
        <path d="M12 9v5M12 18h.01" />
      </>
    ),
    heart: (
      <path d="M12 20s-7-4.6-9.2-9C1.3 8 3 4.8 6.2 4.8c2 0 3.3 1.2 4.1 2.4l1.7 2 1.7-2c.8-1.2 2.1-2.4 4.1-2.4 3.2 0 4.9 3.2 3.4 6.2C19 15.4 12 20 12 20Z" />
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M3 10h18M16 14h2" />
      </>
    ),
    ticket: (
      <>
        <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
        <path d="M12 8v1.5M12 14.5V16" />
      </>
    ),
    pin: (
      <>
        <path d="M6 4h12v17l-6-4-6 4Z" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
    gift: (
      <>
        <rect x="4" y="9" width="16" height="12" rx="1" />
        <path d="M4 13h16M12 9v12M12 9c-4 0-5-5-2-5 1.5 0 2 2 2 5Zm0 0c4 0 5-5 2-5-1.5 0-2 2-2 5Z" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.7.3-.9.7-.9 1.4v.4M12 17h.01" />
      </>
    ),
    phone: (
      <path d="M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z" />
    ),
    chat: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />,
    copy: (
      <>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
      </>
    ),
    star: (
      <path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9Z" />
    ),
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    "eye-off": (
      <>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M6.61 6.61A18.15 18.15 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="m2 2 20 20" />
      </>
    ),
    truck: (
      <>
        <rect x="2" y="7" width="12" height="9" rx="1" />
        <path d="M14 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

const categoryNames = ["All", ...categories.map((category) => category.name)]

function Img({
  src,
  alt,
  className = "",
  emoji,
}: {
  src: string
  alt: string
  className?: string
  emoji: string
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className={`art-fallback ${className}`} aria-label={alt} role="img">
        {emoji}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function AppButton({
  children,
  variant = "primary",
  className = "",
  onClick,
  disabled = false,
  type = "button",
}: React.PropsWithChildren<{
  variant?: "primary" | "secondary" | "ghost" | "danger"
  className?: string
  onClick?: () => void
  disabled?: boolean
  type?: "button" | "submit"
}>) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
      </span>
      <strong>GS</strong>
    </div>
  )
}

function ProductCard({
  product,
  quantity,
  wished,
  onAdd,
  onOpen,
  onWish,
}: {
  product: Product
  quantity: number
  wished: boolean
  onAdd: (id: number, delta: number) => void
  onOpen: () => void
  onWish: (id: number) => void
}) {
  return (
    <article className="product-card">
      <button
        className="product-image"
        onClick={onOpen}
        aria-label={`View ${product.name}`}
      >
        <Img src={product.image} alt={product.name} emoji={product.emoji} />
        <span className="discount">{product.discount}</span>
      </button>
      <button
        className={`heart${wished ? " on" : ""}`}
        aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
        onClick={() => onWish(product.id)}
      >
        {wished ? "♥" : "♡"}
      </button>
      <div className="product-body">
        <button className="product-title" onClick={onOpen}>
          {product.name}
        </button>
        <p>{product.unit}</p>
        <div className="price-row">
          <div>
            <strong>{formatINR(product.price)}</strong>
            <del>{formatINR(product.old)}</del>
          </div>
          {quantity === 0 ? (
            <AppButton
              variant="secondary"
              onClick={() => onAdd(product.id, 1)}
              disabled={product.stock === 0}
            >
              <Icon name="plus" size={16} />{" "}
              {product.stock === 0 ? "Sold out" : "Add"}
            </AppButton>
          ) : (
            <div className="quantity">
              <button
                onClick={() => onAdd(product.id, -1)}
                aria-label="Remove one"
              >
                <Icon name="minus" size={15} />
              </button>
              <span>{quantity}</span>
              <button onClick={() => onAdd(product.id, 1)} aria-label="Add one">
                <Icon name="plus" size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

const ACCOUNT_NAV: [string, IconName][] = [
  ["Profile", "user"],
  ["My Orders", "orders"],
  ["Wallet", "wallet"],
  ["Coupons", "ticket"],
  ["Addresses", "pin"],
  ["Payments", "card"],
  ["My Lists", "heart"],
  ["Refer & Earn", "gift"],
  ["Help & Support", "help"],
  ["Settings", "settings"],
]

const AVAILABLE_COUPONS = [
  {
    code: "GREENER10",
    title: "10% off on orders above ₹499",
    terms: "Max discount ₹100. Valid this month.",
  },
  {
    code: "FIRST50",
    title: "₹50 off your first order",
    terms: "Minimum order ₹299. New users only.",
  },
  {
    code: "WEEKEND15",
    title: "15% off on weekends",
    terms: "Saturday & Sunday only. Max discount ₹150.",
  },
  {
    code: "FRESH20",
    title: "20% off fruits & vegetables",
    terms: "Minimum 5 items. Max discount ₹80.",
  },
]

const FAQS = [
  {
    q: "How do I track my order?",
    a: "Open My Orders and tap Track on any order to follow its live status: Placed, Packed, Out for delivery and Delivered.",
  },
  {
    q: "What are the delivery charges?",
    a: `Orders above ${formatINR(
      FREE_DELIVERY_OVER,
    )} are delivered free. Below that a flat ${formatINR(DELIVERY_FEE)} applies.`,
  },
  {
    q: "How do refunds work?",
    a: "Refunds start instantly to the original payment method and usually reflect in 3-5 business days.",
  },
  {
    q: "Can I save multiple addresses?",
    a: "Yes. Add Home, Work and other addresses under Addresses and mark one as default for faster checkout.",
  },
  {
    q: "How does GS Cash work?",
    a: "Cashback and wallet money are adjusted automatically on your next order, before coupon discounts.",
  },
]

const PAY_METHODS = [
  { label: "UPI", detail: "ganesh@okhdfcbank" },
  { label: "Card", detail: "HDFC Bank •••• 4521" },
  { label: "Netbanking", detail: "HDFC Bank savings account" },
  { label: "Cash on Delivery", detail: "Pay when your order arrives" },
]

type Prefs = {
  push: boolean
  email: boolean
  sms: boolean
  whatsapp: boolean
}

const DEFAULT_PREFS: Prefs = {
  push: true,
  email: true,
  sms: false,
  whatsapp: true,
}

function MyAccount({
  user,
  orders,
  payments,
  products,
  wishedIds,
  addresses,
  onUpdateProfile,
  onUpdatePassword,
  onDeleteAccount,
  onSignOut,
  onAddAddress,
  onRemoveAddress,
  onDefaultAddress,
  onWish,
  onReorder,
  onGoCart,
  isAdmin,
  onOpenAdmin,
  acctMenu,
  onAcctMenu,
}: {
  user: Account
  orders: Order[]
  payments: Payment[]
  products: Product[]
  wishedIds: number[]
  addresses: Address[]
  onUpdateProfile: (name: string, phone: string) => Promise<string | null>
  onUpdatePassword: (current: string, next: string) => Promise<string | null>
  onDeleteAccount: () => Promise<void>
  onSignOut: () => Promise<void> | void
  onAddAddress: (address: Omit<Address, "id"> & { id?: number }) => void
  onRemoveAddress: (id: number) => void
  onDefaultAddress: (id: number) => void
  onWish: (id: number) => void
  onReorder: (items: OrderItem[]) => void
  onGoCart: () => void
  isAdmin: boolean
  onOpenAdmin: () => void
  acctMenu: boolean
  onAcctMenu: (v: boolean) => void
}) {
  const [section, setSection] = useState("Profile")
  const [editProfile, setEditProfile] = useState(false)
  const [pname, setPname] = useState(user.name)
  const [pphone, setPphone] = useState(user.phone)
  const [profileMsg, setProfileMsg] = useState("")
  const [curPass, setCurPass] = useState("")
  const [newPass, setNewPass] = useState("")
  const [passMsg, setPassMsg] = useState("")
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrEditId, setAddrEditId] = useState<number | null>(null)
  const [addrDraft, setAddrDraft] = useState<{
    label: string
    name: string
    phone: string
    house: string
    colony: string
    city: string
    pincode: string
    mandal: string
    district: string
    state: string
    lat?: number
    lng?: number
  }>({
    label: "Home",
    name: user.name,
    phone: user.phone,
    ...EMPTY_PARTS,
  })
  const [addrLocBusy, setAddrLocBusy] = useState(false)
  const [addrLocMsg, setAddrLocMsg] = useState("")
  const [addrMapOpen, setAddrMapOpen] = useState(false)
  const [copied, setCopied] = useState("")
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [expandedOrder, setExpandedOrder] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [prefs, setPrefs] = useState<Record<string, Prefs>>(() =>
    loadState("greeno_prefs", {}),
  )
  const [payDefault, setPayDefault] = useState<Record<string, string>>(() =>
    loadState("greeno_pay_default", {}),
  )

  useEffect(() => saveState("greeno_prefs", prefs), [prefs])
  useEffect(() => saveState("greeno_pay_default", payDefault), [payDefault])

  const myOrders = orders.filter((order) => order.username === user.username)
  const delivered = myOrders.filter((order) => order.status === "Delivered")
  const cashback = delivered.reduce(
    (total, order) => total + Math.round(order.total * 0.05),
    0,
  )
  const wallet = 100 + cashback
  const wishedProducts = products.filter((product) =>
    wishedIds.includes(product.id),
  )
  const prefsFor = prefs[user.username] ?? DEFAULT_PREFS
  const payMethod = payDefault[user.username] ?? "UPI"
  const memberSince = myOrders.length
    ? new Date(myOrders[myOrders.length - 1].placedAt).toLocaleDateString(
        "en-IN",
        { month: "long", year: "numeric" },
      )
    : "New member"
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const copyText = (text: string, key: string) => {
    try {
      navigator.clipboard?.writeText(text).catch(() => undefined)
    } catch {
      // clipboard unavailable — code stays visible on screen
    }
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1600)
  }

  const setPref = (key: keyof Prefs, value: boolean) =>
    setPrefs((current) => ({
      ...current,
      [user.username]: { ...prefsFor, [key]: value },
    }))

  const startEditAddress = (address: Address) => {
    setAddrEditId(address.id)
    setAddrDraft({
      label: address.label,
      name: address.name,
      phone: address.phone,
      house: address.house ?? "",
      colony: address.colony ?? "",
      city: address.city ?? "",
      pincode: address.pincode,
      mandal: address.mandal ?? "",
      district: address.district ?? "",
      state: address.state ?? "",
      lat: address.lat,
      lng: address.lng,
    })
    setAddrLocMsg("")
    setAddrOpen(true)
  }

  const detectAddressLocation = async () => {
    setAddrLocBusy(true)
    setAddrLocMsg("")
    try {
      const loc = await detectLocation()
      setAddrDraft((d) => ({
        ...d,
        ...loc.parts,
        house: loc.parts.house || d.house,
        lat: loc.lat,
        lng: loc.lng,
      }))
      setAddrLocMsg(
        loc.accuracy
          ? `Location captured (accurate to about ${loc.accuracy} m). You can edit the details below.`
          : "Location captured. You can edit the details below.",
      )
    } catch (error) {
      setAddrLocMsg(
        error instanceof Error
          ? error.message
          : "Could not get your location. Fill the address manually or pin it on the map.",
      )
    } finally {
      setAddrLocBusy(false)
    }
  }

  const addressForm = (
    <form
      className="stack-form addr-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!addrDraft.house.trim() || !addrDraft.pincode.trim()) return
        onAddAddress({
          label: addrDraft.label,
          name: addrDraft.name,
          phone: addrDraft.phone,
          line: composeAddressLine(addrDraft),
          pincode: addrDraft.pincode,
          house: addrDraft.house,
          colony: addrDraft.colony,
          city: addrDraft.city,
          mandal: addrDraft.mandal,
          district: addrDraft.district,
          state: addrDraft.state,
          lat: addrDraft.lat,
          lng: addrDraft.lng,
          isDefault: addresses.length === 0,
          id: addrEditId ?? undefined,
        })
        setAddrOpen(false)
        setAddrEditId(null)
        setAddrLocMsg("")
        setAddrDraft({
          label: "Home",
          name: user.name,
          phone: user.phone,
          ...EMPTY_PARTS,
        })
      }}
    >
      <div className="addr-grid">
        <div className="loc-actions wide">
          <button
            type="button"
            className="loc-btn"
            disabled={addrLocBusy}
            onClick={detectAddressLocation}
          >
            <Icon name="pin" size={16} />
            {addrLocBusy ? "Detecting your location…" : "Use my GPS location"}
          </button>
          <button
            type="button"
            className="loc-btn alt"
            onClick={() => setAddrMapOpen(true)}
          >
            <Icon name="map" size={16} /> Choose on map
          </button>
        </div>
        {addrLocMsg && (
          <p
            className={
              addrLocMsg.includes("denied") || addrLocMsg.includes("Could not")
                ? "form-error wide"
                : "loc-note wide"
            }
          >
            {addrLocMsg}
          </p>
        )}
        <label>
          Save as
          <select
            value={addrDraft.label}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, label: event.target.value }))
            }
          >
            <option>Home</option>
            <option>Work</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Name
          <input
            required
            value={addrDraft.name}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, name: event.target.value }))
            }
          />
        </label>
        <label>
          Phone
          <input
            required
            value={addrDraft.phone}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, phone: event.target.value }))
            }
          />
        </label>
        <label>
          Pincode *
          <input
            required
            inputMode="numeric"
            maxLength={6}
            placeholder="6 digits"
            value={addrDraft.pincode}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, pincode: event.target.value }))
            }
          />
        </label>
        <label className="wide">
          House / Flat / Apartment *
          <input
            required
            placeholder="e.g. 5-1-2, Sai Residency"
            value={addrDraft.house}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, house: event.target.value }))
            }
          />
        </label>
        <label className="wide">
          Colony / Area / Village *
          <input
            required
            placeholder="e.g. Banjara Hills Road No. 1"
            value={addrDraft.colony}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, colony: event.target.value }))
            }
          />
        </label>
        <label>
          City
          <input
            placeholder="Hyderabad"
            value={addrDraft.city}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, city: event.target.value }))
            }
          />
        </label>
        <label>
          Mandal / Taluk
          <input
            placeholder="Mandal"
            value={addrDraft.mandal}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, mandal: event.target.value }))
            }
          />
        </label>
        <label>
          District
          <input
            placeholder="District"
            value={addrDraft.district}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, district: event.target.value }))
            }
          />
        </label>
        <label>
          State
          <input
            placeholder="State"
            value={addrDraft.state}
            onChange={(event) =>
              setAddrDraft((d) => ({ ...d, state: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="row-actions">
        <AppButton type="submit">
          <Icon name="check" size={15} /> {addrEditId ? "Update" : "Save"}{" "}
          address
        </AppButton>
        <AppButton
          variant="ghost"
          type="button"
          onClick={() => {
            setAddrOpen(false)
            setAddrEditId(null)
          }}
        >
          Cancel
        </AppButton>
      </div>
      {addrMapOpen && (
        <MapPickerModal
          initialLat={addrDraft.lat}
          initialLng={addrDraft.lng}
          onPick={(result) => {
            setAddrDraft((d) => ({
              ...d,
              ...result.parts,
              house: result.parts.house || d.house,
              name: d.name,
              phone: d.phone,
              label: d.label,
              lat: result.lat,
              lng: result.lng,
            }))
            setAddrMapOpen(false)
            setAddrLocMsg(
              "Location pinned on the map. You can edit the details below.",
            )
          }}
          onClose={() => setAddrMapOpen(false)}
        />
      )}
    </form>
  )

  return (
    <section
      className={`account-page acct-layout ${
        acctMenu ? "show-menu" : "show-section"
      }`}
    >
      <aside className="acct-nav">
        <div className="acct-nav-head">
          <div className="prof-avatar">{initials}</div>
          <div className="acct-nav-id">
            <strong>{user.name}</strong>
            <small>@{user.username}</small>
          </div>
          <button
            className="acct-edit"
            onClick={() => {
              setSection("Profile")
              onAcctMenu(false)
            }}
            aria-label="Edit profile"
          >
            <Icon name="edit" size={13} /> Edit
          </button>
        </div>
        <div className="acct-nav-meta">
          {user.phone && (
            <span>
              <Icon name="phone" size={12} /> {user.phone}
            </span>
          )}
          <span>
            <Icon name="user" size={12} /> Member since {memberSince}
          </span>
        </div>
        {(isAdmin
          ? [
              ...ACCOUNT_NAV,
              ["Admin dashboard", "lock"],
            ] as [string, IconName][]
          : ACCOUNT_NAV
        ).map(([label, icon]) => (
          <button
            key={label}
            className={
              section === label
                ? "active"
                : label === "Admin dashboard"
                  ? "admin-nav"
                  : ""
            }
            onClick={() => {
              setSection(label)
              onAcctMenu(false)
            }}
          >
            <Icon name={icon} size={17} /> {label}
            <Icon name="chevron" size={14} />
          </button>
        ))}
        <button className="acct-signout" onClick={onSignOut}>
          <Icon name="back" size={17} /> Sign out
        </button>
      </aside>

      <div className="acct-main">
        <button
          className="acct-back"
          onClick={() => onAcctMenu(true)}
          aria-label="Back to account menu"
        >
          <Icon name="back" size={18} /> Account menu
        </button>
        {section === "Profile" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>PROFILE</p>
                <h2>My profile</h2>
              </div>
              {!editProfile && (
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setPname(user.name)
                    setPphone(user.phone)
                    setProfileMsg("")
                    setEditProfile(true)
                  }}
                >
                  <Icon name="edit" size={15} /> Edit profile
                </AppButton>
              )}
            </div>
            <div className="profile-hero">
              <div className="prof-avatar big">{initials}</div>
              <div>
                <h3>{user.name}</h3>
                <span>@{user.username}</span>
                <small>
                  <Icon name="star" size={13} /> GS member since {memberSince}
                </small>
              </div>
            </div>
            {editProfile ? (
              <form
                className="stack-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const problem = await onUpdateProfile(pname, pphone)
                  if (problem) {
                    setProfileMsg(problem)
                  } else {
                    setProfileMsg("")
                    setEditProfile(false)
                  }
                }}
              >
                <label>
                  Full name
                  <input
                    required
                    value={pname}
                    onChange={(event) => setPname(event.target.value)}
                  />
                </label>
                <label>
                  Phone
                  <input
                    inputMode="tel"
                    placeholder="10 digit mobile number"
                    value={pphone}
                    onChange={(event) => setPphone(event.target.value)}
                  />
                </label>
                {profileMsg && (
                  <p className="form-error">
                    <Icon name="alert" size={14} /> {profileMsg}
                  </p>
                )}
                <div className="row-actions">
                  <AppButton type="submit">Save changes</AppButton>
                  <AppButton
                    variant="ghost"
                    type="button"
                    onClick={() => setEditProfile(false)}
                  >
                    Cancel
                  </AppButton>
                </div>
              </form>
            ) : (
              <div className="info-list">
                <div>
                  <Icon name="user" size={18} />
                  <span>
                    <small>Full name</small>
                    <strong>{user.name}</strong>
                  </span>
                </div>
                <div>
                  <Icon name="phone" size={18} />
                  <span>
                    <small>Phone</small>
                    <strong>{user.phone || "Not added yet"}</strong>
                  </span>
                </div>
                <div>
                  <Icon name="chat" size={18} />
                  <span>
                    <small>Username</small>
                    <strong>@{user.username}</strong>
                  </span>
                </div>
              </div>
            )}
            <div className="panel-block">
              <h3>
                <Icon name="lock" size={16} /> Change password
              </h3>
              <form
                className="stack-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (newPass.length < 4) {
                    setPassMsg("New password needs at least 4 characters.")
                    return
                  }
                  const problem = await onUpdatePassword(curPass, newPass)
                  setPassMsg(problem ?? "")
                  if (!problem) {
                    setCurPass("")
                    setNewPass("")
                  }
                }}
              >
                <div className="addr-grid">
                  <label>
                    Current password
                    <PasswordInput
                      required
                      value={curPass}
                      onChange={setCurPass}
                      autoComplete="current-password"
                    />
                  </label>
                  <label>
                    New password
                    <PasswordInput
                      required
                      minLength={4}
                      value={newPass}
                      onChange={setNewPass}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                {passMsg && (
                  <p className="form-error">
                    <Icon name="alert" size={14} /> {passMsg}
                  </p>
                )}
                <div className="row-actions">
                  <AppButton type="submit">Update password</AppButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {section === "My Orders" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>ORDERS</p>
                <h2>My orders</h2>
              </div>
              <span className="stat-pill">{myOrders.length} total</span>
            </div>
            {myOrders.length === 0 ? (
              <div className="empty">
                <Icon name="orders" size={28} />
                <h3>No orders yet</h3>
                <p>Your order history, invoices and tracking live here.</p>
                <AppButton onClick={onGoCart}>Start shopping</AppButton>
              </div>
            ) : (
              <div className="order-stack">
                {myOrders.map((order) => {
                  const stepIndex = stageIndexOf(order.status)
                  const isOpen = expandedOrder === order.id
                  return (
                    <article className="order-card-full" key={order.id}>
                      <div className="order-top">
                        <div>
                          <strong>{order.id}</strong>
                          <small>
                            {new Date(order.placedAt).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </div>
                        <span
                          className={
                            "active-pill" + (stepIndex >= 3 ? " done" : "")
                          }
                        >
                          <i /> {order.status}
                        </span>
                        <b>{formatINR(order.total)}</b>
                      </div>
                      <div className="order-items-line">
                        {order.items
                          .map((item) => `${item.name} ×${item.qty}`)
                          .join(" · ")}
                      </div>
                      <div className="order-actions">
                        <button
                          onClick={() =>
                            setExpandedOrder(isOpen ? "" : order.id)
                          }
                        >
                          <Icon name={isOpen ? "minus" : "orders"} size={15} />{" "}
                          {isOpen ? "Hide details" : "Track order"}
                        </button>
                        <button onClick={() => onReorder(order.items)}>
                          <Icon name="cart" size={15} /> Reorder
                        </button>
                        <button onClick={() => window.print()}>
                          <Icon name="package" size={15} /> Invoice
                        </button>
                      </div>
                      {isOpen && (
                        <div className="order-detail">
                          <TrackingTimeline order={order} />
                          {(() => {
                            const txn = payments.find(
                              (p) => p.orderId === order.id,
                            )
                            if (!txn) return null
                            return (
                              <div className="txn-card">
                                <div className="txn-card-head">
                                  <strong>Payment</strong>
                                  <span
                                    className={
                                      "active-pill" +
                                      (txn.status === "success" ||
                                      txn.status === "cod"
                                        ? " done"
                                        : "")
                                    }
                                  >
                                    <i /> {paymentStatusLabel[txn.status]}
                                  </span>
                                </div>
                                <dl className="invoice">
                                  <div>
                                    <dt>Transaction ID</dt>
                                    <dd>
                                      <code>{txn.id}</code>
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Method</dt>
                                    <dd>
                                      {txn.method}
                                      {txn.upiApp ? ` · ${txn.upiApp}` : ""}
                                    </dd>
                                  </div>
                                  {txn.merchantVpa && (
                                    <div>
                                      <dt>Paid to</dt>
                                      <dd>{txn.merchantVpa}</dd>
                                    </div>
                                  )}
                                  {txn.payerVpa && (
                                    <div>
                                      <dt>Your UPI ID</dt>
                                      <dd>{txn.payerVpa}</dd>
                                    </div>
                                  )}
                                  <div>
                                    <dt>Amount</dt>
                                    <dd>{formatINR(txn.amount)}</dd>
                                  </div>
                                </dl>
                              </div>
                            )
                          })()}
                          <dl className="invoice">
                            <div>
                              <dt>Items</dt>
                              <dd>
                                {order.items.reduce((t, i) => t + i.qty, 0)}
                              </dd>
                            </div>
                            <div>
                              <dt>Deliver to</dt>
                              <dd>
                                {order.address}
                                {order.lat != null && order.lng != null && (
                                  <a
                                    className="order-map"
                                    href={mapsLink(order.lat, order.lng)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Icon name="pin" size={12} /> View on map
                                  </a>
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Paid via</dt>
                              <dd>{order.payment}</dd>
                            </div>
                            <div>
                              <dt>Subtotal</dt>
                              <dd>{formatINR(order.subtotal)}</dd>
                            </div>
                            <div>
                              <dt>Delivery</dt>
                              <dd>
                                {order.delivery === 0
                                  ? "Free"
                                  : formatINR(order.delivery)}
                              </dd>
                            </div>
                            <div>
                              <dt>Discount</dt>
                              <dd>-{formatINR(order.discount)}</dd>
                            </div>
                            <div className="invoice-total">
                              <dt>Total</dt>
                              <dd>{formatINR(order.total)}</dd>
                            </div>
                          </dl>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {section === "Wallet" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>WALLET</p>
                <h2>GS Cash</h2>
              </div>
            </div>
            <div className="wallet-card">
              <span>Available balance</span>
              <strong>{formatINR(wallet)}</strong>
              <small>Usable on any order · No expiry</small>
              <div className="wallet-actions">
                <AppButton
                  variant="secondary"
                  onClick={() => copyText(String(wallet), "wallet")}
                >
                  <Icon name="copy" size={15} />
                  {copied === "wallet" ? "Copied" : "Check balance"}
                </AppButton>
                <AppButton onClick={onGoCart}>
                  <Icon name="cart" size={15} /> Shop now
                </AppButton>
              </div>
            </div>
            <div className="info-list">
              <div>
                <Icon name="gift" size={18} />
                <span>
                  <small>Signup bonus</small>
                  <strong>+{formatINR(100)}</strong>
                </span>
              </div>
              <div>
                <Icon name="trend" size={18} />
                <span>
                  <small>Order cashback (5%)</small>
                  <strong>+{formatINR(cashback)}</strong>
                </span>
              </div>
              <div>
                <Icon name="truck" size={18} />
                <span>
                  <small>Free delivery</small>
                  <strong>Orders above {formatINR(FREE_DELIVERY_OVER)}</strong>
                </span>
              </div>
            </div>
            <div className="panel-block">
              <h3>Recent activity</h3>
              {delivered.length === 0 && myOrders.length === 0 ? (
                <p className="muted-line">
                  Cashback appears here after your first delivered order.
                </p>
              ) : (
                myOrders.slice(0, 6).map((order) => (
                  <div className="tx-row" key={order.id}>
                    <span>
                      <Icon
                        name={order.status === "Delivered" ? "trend" : "orders"}
                        size={16}
                      />
                    </span>
                    <div>
                      <strong>{order.id}</strong>
                      <small>
                        {new Date(order.placedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </small>
                    </div>
                    <b className={order.status === "Delivered" ? "credit" : ""}>
                      {order.status === "Delivered"
                        ? `+${formatINR(Math.round(order.total * 0.05))}`
                        : formatINR(order.total)}
                    </b>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {section === "Coupons" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>COUPONS</p>
                <h2>Offers for you</h2>
              </div>
            </div>
            <div className="coupon-stack">
              {AVAILABLE_COUPONS.map((coupon) => (
                <div className="coupon-row" key={coupon.code}>
                  <div className="coupon-tag">
                    <Icon name="ticket" size={20} />
                  </div>
                  <div>
                    <strong>{coupon.title}</strong>
                    <small>{coupon.terms}</small>
                  </div>
                  <button
                    className="copy-code"
                    onClick={() => copyText(coupon.code, coupon.code)}
                  >
                    <Icon name="copy" size={14} />
                    {copied === coupon.code ? "Copied!" : coupon.code}
                  </button>
                </div>
              ))}
            </div>
            <p className="muted-line">
              Apply any code in the cart promo box. One coupon per order.
            </p>
          </div>
        )}

        {section === "Addresses" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>ADDRESSES</p>
                <h2>My addresses</h2>
              </div>
              {!addrOpen && (
                <AppButton onClick={() => setAddrOpen(true)}>
                  <Icon name="plus" size={15} /> Add address
                </AppButton>
              )}
            </div>
            {addrOpen && addressForm}
            {addresses.length === 0 && !addrOpen ? (
              <div className="empty">
                <Icon name="pin" size={28} />
                <h3>No saved addresses</h3>
                <p>Add a delivery address for faster checkout.</p>
                <AppButton onClick={() => setAddrOpen(true)}>
                  Add your first address
                </AppButton>
              </div>
            ) : (
              <div className="addr-stack">
                {addresses.map((address) => (
                  <div
                    className={`addr-card${
                      address.isDefault ? " default" : ""
                    }`}
                    key={address.id}
                  >
                    <div className="addr-head">
                      <span className="addr-label">
                        <Icon name="pin" size={14} /> {address.label}
                      </span>
                      {address.isDefault && <em>Default</em>}
                    </div>
                    <strong>{address.name}</strong>
                    <p>{address.line}</p>
                    <small>
                      {address.phone} · {address.pincode}
                    </small>
                    {address.lat != null && address.lng != null && (
                      <a
                        className="addr-map"
                        href={mapsLink(address.lat, address.lng)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="pin" size={12} /> View on map
                      </a>
                    )}
                    <div className="row-actions">
                      {!address.isDefault && (
                        <button onClick={() => onDefaultAddress(address.id)}>
                          Set as default
                        </button>
                      )}
                      <button onClick={() => startEditAddress(address)}>
                        Edit
                      </button>
                      <button
                        className="danger"
                        onClick={() => onRemoveAddress(address.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === "Payments" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>PAYMENTS</p>
                <h2>Payment methods</h2>
              </div>
            </div>
            <div className="pay-stack">
              {PAY_METHODS.map((method) => (
                <label
                  className={`pay-row${
                    payMethod === method.label ? " active" : ""
                  }`}
                  key={method.label}
                >
                  <input
                    type="radio"
                    name="pay-method"
                    checked={payMethod === method.label}
                    onChange={() =>
                      setPayDefault((current) => ({
                        ...current,
                        [user.username]: method.label,
                      }))
                    }
                  />
                  <Icon name="card" size={18} />
                  <span>
                    <strong>{method.label}</strong>
                    <small>{method.detail}</small>
                  </span>
                  {payMethod === method.label && (
                    <em>
                      <Icon name="check" size={14} /> Default
                    </em>
                  )}
                </label>
              ))}
            </div>
            <div className="panel-block">
              <h3>Recent payments</h3>
              {myOrders.length === 0 ? (
                <p className="muted-line">
                  Your completed payments will appear here.
                </p>
              ) : (
                myOrders.slice(0, 6).map((order) => (
                  <div className="tx-row" key={order.id}>
                    <span>
                      <Icon name="card" size={16} />
                    </span>
                    <div>
                      <strong>{order.payment}</strong>
                      <small>{order.id}</small>
                    </div>
                    <b>{formatINR(order.total)}</b>
                  </div>
                ))
              )}
            </div>
            <p className="muted-line">
              <Icon name="lock" size={12} /> Payments are secured with 256-bit
              encryption. GS never stores your card details.
            </p>
          </div>
        )}

        {section === "My Lists" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>WISHLIST</p>
                <h2>My lists</h2>
              </div>
              <span className="stat-pill">{wishedProducts.length} saved</span>
            </div>
            {wishedProducts.length === 0 ? (
              <div className="empty">
                <Icon name="heart" size={28} />
                <h3>Your wishlist is empty</h3>
                <p>Tap the heart on any product to save it for later.</p>
                <AppButton onClick={onGoCart}>Browse products</AppButton>
              </div>
            ) : (
              <div className="wish-stack">
                {wishedProducts.map((product) => (
                  <div className="wish-row" key={product.id}>
                    <Img
                      src={product.image}
                      alt={product.name}
                      emoji={product.emoji}
                    />
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.unit}</small>
                      <b>{formatINR(product.price)}</b>
                    </div>
                    <div className="row-actions">
                      <AppButton
                        variant="secondary"
                        onClick={() => {
                          onReorder([
                            {
                              name: product.name,
                              unit: product.unit,
                              qty: 1,
                              price: product.price,
                            },
                          ])
                        }}
                      >
                        <Icon name="cart" size={15} /> Move to cart
                      </AppButton>
                      <button
                        className="danger"
                        onClick={() => onWish(product.id)}
                        aria-label="Remove from wishlist"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === "Refer & Earn" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>REFER & EARN</p>
                <h2>Give ₹100, get ₹100</h2>
              </div>
            </div>
            <div className="refer-card">
              <div className="prof-avatar">
                <Icon name="gift" size={24} />
              </div>
              <p>
                Share your code with friends. When they place their first order,
                you both get ₹100 GS Cash.
              </p>
              <div className="refer-code">
                <strong>{`GREENO-${user.username.toUpperCase()}`}</strong>
                <button
                  onClick={() =>
                    copyText(`GREENO-${user.username.toUpperCase()}`, "ref")
                  }
                >
                  <Icon name="copy" size={15} />
                  {copied === "ref" ? "Copied!" : "Copy code"}
                </button>
              </div>
              <div className="refer-steps">
                <div>
                  <span>1</span> Share your code
                </div>
                <div>
                  <span>2</span> Friend signs up
                </div>
                <div>
                  <span>3</span> Both earn ₹100
                </div>
              </div>
            </div>
          </div>
        )}

        {section === "Help & Support" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>SUPPORT</p>
                <h2>Help & support</h2>
              </div>
            </div>
            <div className="support-grid">
              <a href="tel:+918000012345">
                <Icon name="phone" size={20} />
                <strong>Call us</strong>
                <small>8 AM – 10 PM, all days</small>
              </a>
              <a href="mailto:help@greeno.in">
                <Icon name="chat" size={20} />
                <strong>Email us</strong>
                <small>help@greeno.in</small>
              </a>
              <button onClick={() => onGoCart()}>
                <Icon name="truck" size={20} />
                <strong>Track an order</strong>
                <small>Live status & ETAs</small>
              </button>
            </div>
            <div className="panel-block">
              <h3>Frequently asked questions</h3>
              <div className="faq-stack">
                {FAQS.map((faq, index) => (
                  <div
                    className={`faq-item${openFaq === index ? " open" : ""}`}
                    key={faq.q}
                  >
                    <button
                      onClick={() =>
                        setOpenFaq(openFaq === index ? null : index)
                      }
                    >
                      {faq.q}
                      <Icon name="chevron" size={15} />
                    </button>
                    {openFaq === index && <p>{faq.a}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === "Settings" && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>SETTINGS</p>
                <h2>Notifications & account</h2>
              </div>
            </div>
            <div className="toggle-stack">
              {([
                ["push", "Push notifications", "Order updates on your device"],
                ["email", "Email updates", "Offers and order receipts"],
                ["sms", "SMS alerts", "Delivery OTPs and status"],
                ["whatsapp", "WhatsApp updates", "Delivery chat on WhatsApp"],
              ] as [keyof Prefs, string, string][]).map(
                ([key, label, detail]) => (
                  <label className="toggle-row" key={key}>
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={prefsFor[key]}
                      onChange={(event) => setPref(key, event.target.checked)}
                    />
                  </label>
                ),
              )}
            </div>
            <div className="panel-block danger-zone">
              <h3>
                <Icon name="alert" size={16} /> Danger zone
              </h3>
              <div className="row-actions">
                <AppButton variant="secondary" onClick={onSignOut}>
                  <Icon name="back" size={15} /> Sign out
                </AppButton>
                <button
                  className="danger-btn"
                  onClick={() => {
                    if (confirmDelete) {
                      onDeleteAccount()
                    } else {
                      setConfirmDelete(true)
                      window.setTimeout(() => setConfirmDelete(false), 4000)
                    }
                  }}
                >
                  <Icon name="trash" size={15} />
                  {confirmDelete
                    ? "Tap again to delete permanently"
                    : "Delete account"}
                </button>
              </div>
              {confirmDelete && (
                <p className="muted-line">
                  Your profile, addresses and orders will be removed from this
                  device.
                </p>
              )}
            </div>
          </div>
        )}

        {section === "Admin dashboard" && isAdmin && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <p>ADMIN</p>
                <h2>Store administration</h2>
              </div>
            </div>
            <div className="admin-cta">
              <span className="admin-cta-icon">
                <Icon name="lock" size={26} />
              </span>
              <h3>Manage your store</h3>
              <p>
                Add, edit or remove products, track every customer order with
                delivery location, and watch sales — changes go live on the
                storefront instantly.
              </p>
              <AppButton onClick={onOpenAdmin}>Open admin dashboard</AppButton>
            </div>
            <div className="admin-quick-stats">
              <div>
                <strong>{orders.length}</strong>
                <span>Orders</span>
              </div>
              <div>
                <strong>{products.length}</strong>
                <span>Products</span>
              </div>
              <div>
                <strong>
                  {formatINR(orders.reduce((t, o) => t + o.total, 0))}
                </strong>
                <span>Total sales</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  minLength,
  autoComplete,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  minLength?: number
  autoComplete?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="pw-wrap">
      <input
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="pw-eye"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((current) => !current)}
      >
        <Icon name={visible ? "eye-off" : "eye"} size={17} />
      </button>
    </div>
  )
}

function AuthModal({
  mode,
  setMode,
  note,
  onSubmit,
  onClose,
}: {
  mode: "signin" | "create"
  setMode: (mode: "signin" | "create") => void
  note?: string
  onSubmit: (data: {
    name: string
    username: string
    password: string
  }) => Promise<string | null> | string | null
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p>YOUR ACCOUNT</p>
            <h2>
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <span>
              {note ??
                (mode === "signin"
                  ? "Sign in to save addresses and track your orders."
                  : "It only takes a moment to get started.")}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const problem = await onSubmit({ name, username, password })
            setError(problem ?? "")
          }}
        >
          <div className="form-grid">
            {mode === "create" && (
              <label className="wide">
                Full name
                <input
                  required
                  placeholder="e.g. Priya Sharma"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            <label className="wide">
              Username
              <input
                required
                placeholder="Unique username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="wide">
              Password
              <PasswordInput
                required
                minLength={4}
                placeholder="At least 4 characters"
                value={password}
                onChange={setPassword}
              />
            </label>
          </div>
          {error && (
            <p className="form-error">
              <Icon name="alert" size={14} /> {error}
            </p>
          )}
          <div className="modal-actions">
            <AppButton
              variant="ghost"
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "create" : "signin")
                setError("")
              }}
            >
              {mode === "signin"
                ? "New here? Create account"
                : "I already have an account"}
            </AppButton>
            <AppButton type="submit">
              {mode === "signin" ? "Sign in" : "Create account"}
            </AppButton>
          </div>
        </form>
      </section>
    </div>
  )
}

const MAP_PIN_SVG = `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg"><path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 15 27 15 27s15-16.5 15-27C32 7.7 25.3 1 17 1z" fill="#087f5b" stroke="#ffffff" stroke-width="2"/><circle cx="17" cy="16" r="6" fill="#ffffff"/></svg>`

function MapPickerModal({
  initialLat,
  initialLng,
  onPick,
  onClose,
}: {
  initialLat?: number
  initialLng?: number
  onPick: (result: {
    lat: number
    lng: number
    parts: AddressParts
    line: string
  }) => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [busy, setBusy] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState("")
  const [pin, setPin] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [preview, setPreview] = useState("")

  const updatePin = useCallback(async (lat: number, lng: number) => {
    setPin({ lat, lng })
    setBusy(true)
    const parts = await reverseGeocode(lat, lng)
    setPreview(
      composeAddressLine(parts) ||
        `Pinned location, ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    )
    setBusy(false)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || mapRef.current) return
    const startLat = initialLat ?? 17.385009
    const startLng = initialLng ?? 78.486671
    const map = L.map(canvas, { zoomControl: true }).setView(
      [startLat, startLng],
      initialLat != null ? 17 : 12,
    )
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map)
    const icon = L.divIcon({
      className: "map-pin-icon",
      html: MAP_PIN_SVG,
      iconSize: [34, 44],
      iconAnchor: [17, 42],
    })
    const marker = L.marker([startLat, startLng], {
      icon,
      draggable: true,
    }).addTo(map)
    marker.on("dragend", () => {
      const latlng = marker.getLatLng()
      updatePin(latlng.lat, latlng.lng)
    })
    map.on("click", (event: L.LeafletMouseEvent) => {
      marker.setLatLng(event.latlng)
      updatePin(event.latlng.lat, event.latlng.lng)
    })
    mapRef.current = map
    markerRef.current = marker
    updatePin(startLat, startLng)
    if (initialLat == null) {
      getGpsPosition()
        .then((gps) => {
          map.setView([gps.lat, gps.lng], 17)
          marker.setLatLng([gps.lat, gps.lng])
          updatePin(gps.lat, gps.lng)
        })
        .catch(() => undefined)
    }
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const useMyLocation = async () => {
    setLocating(true)
    setError("")
    try {
      const gps = await getGpsPosition()
      mapRef.current?.setView([gps.lat, gps.lng], 17)
      markerRef.current?.setLatLng([gps.lat, gps.lng])
      await updatePin(gps.lat, gps.lng)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not get your location. Drag the pin instead.",
      )
    } finally {
      setLocating(false)
    }
  }

  const confirm = () => {
    if (!pin) return
    const parts = reverseGeocode(pin.lat, pin.lng)
    void parts.then((resolved) => {
      onPick({
        lat: pin.lat,
        lng: pin.lng,
        parts: resolved,
        line:
          composeAddressLine(resolved) ||
          `Pinned location, ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`,
      })
    })
  }

  return (
    <div
      className="map-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Choose location on map"
    >
      <div className="map-picker-head">
        <button onClick={onClose} aria-label="Close map">
          <Icon name="back" />
        </button>
        <div>
          <p>SELECT DELIVERY LOCATION</p>
          <h2>Pin your exact address</h2>
          <span>Drag the pin or tap the map to mark your building</span>
        </div>
      </div>
      <div className="map-picker-canvas" ref={canvasRef} />
      <div className="map-picker-sheet">
        <div className="map-picker-addr">
          <Icon name="pin" size={17} />
          <div>
            <strong>{busy ? "Fetching address for this pin…" : preview}</strong>
            {pin && (
              <small>
                {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </small>
            )}
          </div>
        </div>
        {error && (
          <p className="form-error">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
        <div className="map-picker-actions">
          <AppButton
            variant="secondary"
            onClick={useMyLocation}
            disabled={locating}
          >
            <Icon name="pin" size={15} />{" "}
            {locating ? "Locating…" : "Use my GPS location"}
          </AppButton>
          <AppButton onClick={confirm} disabled={busy || !pin}>
            <Icon name="check" size={15} /> Confirm location
          </AppButton>
        </div>
      </div>
    </div>
  )
}

function CheckoutModal({
  user,
  items,
  subtotal,
  discount,
  delivery,
  addresses,
  onUpsertAddress,
  onRemoveAddress,
  onPlace,
  onRecordPayment,
  onClose,
}: {
  user: Account
  items: OrderItem[]
  subtotal: number
  discount: number
  delivery: number
  addresses: Address[]
  onUpsertAddress: (draft: Omit<Address, "id"> & { id?: number }) => void
  onRemoveAddress: (id: number) => void
  onPlace: (order: Order) => void
  onRecordPayment: (payment: Payment) => void
  onClose: () => void
}) {
  // Flipkart/BigBasket-style flow: Address → Payment → (gateway) → Confirmation.
  const [step, setStep] = useState<"address" | "payment" | "done">("address")
  const defaultId =
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null
  const [selectedId, setSelectedId] = useState<number | null>(defaultId)
  const [showForm, setShowForm] = useState(addresses.length === 0)
  const [editing, setEditing] = useState<Address | null>(null)
  const [parts, setParts] = useState<AddressParts>({ ...EMPTY_PARTS })
  const [coords, setCoords] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [locBusy, setLocBusy] = useState(false)
  const [locMsg, setLocMsg] = useState("")
  const [mapOpen, setMapOpen] = useState(false)
  const upi = loadUpi()
  const gateway = loadGateway()
  // Both "Pay online" and "UPI" need Razorpay AND the admin's master switch on.
  // The server path (Supabase Edge Functions) is preferred; with a saved Key ID
  // alone, Checkout still works client-only until the server takes over.
  const hasRazorpay =
    !!gateway.razorpayKeyId.trim() && gateway.enabled !== false
  // Only the admin's own saved bank UPI ID — kept as a reference on records.
  const merchantVpa = upi.vpa.trim()
  // "Show UPI at checkout" toggle lists UPI; it is payable once Razorpay is
  // configured (Key ID saved) — Razorpay settles to the store's own account.
  const upiListed = upi.enabled
  const upiActive = upiListed && hasRazorpay
  // A rzp_test_ key simulates payments — no real money ever moves. Say so
  // plainly so a "success" is never mistaken for a real charge.
  const testKeyMode = gateway.razorpayKeyId.trim().startsWith("rzp_test_")
  const [payment, setPayment] = useState("")
  const [placed, setPlaced] = useState<Order | null>(null)
  const [payResult, setPayResult] = useState<"success" | "cod" | "pending">(
    "cod",
  )
  const [payNote, setPayNote] = useState("")
  const [payingOnline, setPayingOnline] = useState(false)
  // Transaction ID of the confirmed payment (shown on the receipt).
  const [txnRef, setTxnRef] = useState("")
  // UPI id the customer paid from, when the gateway reports it back.
  const [receiptVpa, setReceiptVpa] = useState("")
  // True when the confirmed payment ran through a test key.
  const [testReceipt, setTestReceipt] = useState(false)
  // Pending "did you actually pay?" recovery after a lost UPI-app callback.
  const [payRecover, setPayRecover] = useState<PayRecovery | null>(null)

  const paymentOptions = [
    ...(hasRazorpay ? ["Online"] : []),
    ...(upiListed ? ["UPI"] : []),
    "Cash on delivery",
  ]
  const selectable = paymentOptions.filter((o) => o !== "UPI" || upiActive)
  const activePayment = selectable.includes(payment) ? payment : selectable[0]

  const total = Math.round(subtotal - discount + delivery)
  const selected = addresses.find((a) => a.id === selectedId) ?? null

  const setField = (key: keyof AddressParts, value: string) =>
    setParts((current) => ({ ...current, [key]: value }))

  const startNew = () => {
    setEditing(null)
    setParts({ ...EMPTY_PARTS })
    setCoords(null)
    setLocMsg("")
    setShowForm(true)
  }

  const editAddr = (addr: Address) => {
    setEditing(addr)
    setParts({
      house: addr.house ?? "",
      colony: addr.colony ?? "",
      city: addr.city ?? "",
      pincode: addr.pincode ?? "",
      mandal: addr.mandal ?? "",
      district: addr.district ?? "",
      state: addr.state ?? "",
    })
    setCoords(
      addr.lat != null && addr.lng != null
        ? { lat: addr.lat, lng: addr.lng }
        : null,
    )
    setLocMsg("")
    setShowForm(true)
  }

  const saveAddr = () => {
    if (
      !parts.house.trim() ||
      !parts.colony.trim() ||
      !parts.city.trim() ||
      !parts.pincode.trim()
    ) {
      setLocMsg("Please fill house, colony, city and pincode.")
      return
    }
    const id = editing?.id ?? Date.now()
    onUpsertAddress({
      id,
      label: editing?.label ?? "Home",
      name: user.name,
      phone: user.phone,
      line: composeAddressLine(parts),
      isDefault: editing?.isDefault ?? addresses.length === 0,
      lat: coords?.lat,
      lng: coords?.lng,
      ...parts,
    })
    setSelectedId(id)
    setShowForm(false)
    setEditing(null)
    setLocMsg("")
  }

  const useMyLocation = async () => {
    setLocBusy(true)
    setLocMsg("")
    try {
      const loc = await detectLocation()
      setParts((current) => ({
        ...loc.parts,
        house: loc.parts.house || current.house,
      }))
      setCoords({ lat: loc.lat, lng: loc.lng })
      setLocMsg(
        loc.accuracy
          ? `Location set (accurate to about ${loc.accuracy} m). You can edit the details below.`
          : "Location set. You can edit the details below.",
      )
    } catch (error) {
      setLocMsg(
        error instanceof Error
          ? error.message
          : "Could not get your location. Fill the address manually or use the map.",
      )
    } finally {
      setLocBusy(false)
    }
  }

  // GPS quick-add: detect location, then open the form to complete & save.
  const useMyLocationThenNew = async () => {
    setLocBusy(true)
    setLocMsg("")
    try {
      const loc = await detectLocation()
      setEditing(null)
      setParts({ ...loc.parts })
      setCoords({ lat: loc.lat, lng: loc.lng })
      setShowForm(true)
      setLocMsg(
        "Location detected (city & pincode filled). Add your house/colony and save.",
      )
    } catch (error) {
      setLocMsg(
        error instanceof Error
          ? error.message
          : "Could not get your location. Add the address manually.",
      )
    } finally {
      setLocBusy(false)
    }
  }

  const buildOrder = (summary: string): Order => {
    return {
      id: "GRN-" + String(Date.now()).slice(-6),
      customer: user.name,
      username: user.username,
      items,
      subtotal: Math.round(subtotal),
      delivery,
      discount: Math.round(discount),
      total,
      address: selected ? selected.line : "",
      payment: summary,
      placedAt: new Date().toISOString(),
      status: "Placed",
      lat: selected?.lat,
      lng: selected?.lng,
    }
  }

  const finalizeOrder = (
    order: Order,
    result: "success" | "cod" | "pending",
    ref?: string,
    vpa?: string,
  ) => {
    const isUpi = order.payment.startsWith("UPI")
    const isOnline = order.payment.startsWith("Online")
    onPlace(order)
    onRecordPayment({
      // The transaction id is whatever Razorpay reported — never an invented one.
      id: ref || newTxnId(),
      orderId: order.id,
      customer: order.customer,
      username: order.username,
      amount: order.total,
      method:
        result === "cod" ? "Cash on delivery" : isOnline ? "Online" : "UPI",
      merchantVpa: isUpi || isOnline ? merchantVpa : undefined,
      payerVpa: vpa?.trim() || undefined,
      status:
        result === "success" ? "success" : result === "cod" ? "cod" : "pending",
      timestamp: new Date().toISOString(),
      note: ref ? `Ref ${ref}` : `GS order ${order.id}`,
    })
    setPlaced(order)
    setPayResult(result)
    setTxnRef(ref ?? "")
    setReceiptVpa(vpa?.trim() || "")
    setPayingOnline(false)
    setStep("done")
  }

  // Flipkart/BigBasket-style gateway payment — used for both "Pay online" and
  // "UPI". The server locks the amount into a Razorpay order first; Checkout
  // collects the money (the UPI-only sheet opens the customer's chosen UPI app
  // directly) and hands success or failure back to the app. An unverified
  // payment never creates an order — the customer lands back on the payment
  // step with the failure note.
  const runGatewayPayment = (upiOnly: boolean) => {
    const draft = buildOrder(upiOnly ? "UPI · Razorpay" : "Online · Razorpay")
    const failNote = upiOnly
      ? "UPI payment failed or was not completed — no money was received. Please try again."
      : "Payment failed or was cancelled — no money was received. Please try again."
    const failToPayment = (note: string) => {
      setPayingOnline(false)
      setPayNote(note)
      setStep("payment")
    }
    const openCheckout = (opts: {
      keyId: string
      razorpayOrderId?: string
      amount: number
    }) =>
      openRazorpay({
        keyId: opts.keyId,
        razorpayOrderId: opts.razorpayOrderId,
        amount: opts.amount,
        upiOnly,
        orderNote: `GS order ${draft.id}`,
        customerName: user.name,
        customerEmail: `${user.username}@greeno.store`,
        customerContact: "",
        onSuccess: (result) => {
          void (async () => {
            if (!result.paymentId) {
              failToPayment(
                "Payment could not be confirmed — no order was placed. Please try again.",
              )
              return
            }
            if (!opts.razorpayOrderId) {
              // Key-ID fallback: the payment server is not deployed yet, so
              // Razorpay's own confirmation is the receipt for now. The server
              // path takes over automatically once it is deployed.
              finalizeOrder(draft, "success", result.paymentId)
              return
            }
            if (!result.orderId) {
              failToPayment(
                "Payment could not be verified — no order was placed. Please try again.",
              )
              return
            }
            const verified = await verifyRazorpayPayment({
              razorpayOrderId: result.orderId,
              razorpayPaymentId: result.paymentId,
              razorpaySignature: result.signature,
              order: draft,
            })
            if (verified.ok) {
              finalizeOrder(
                draft,
                "success",
                result.paymentId,
                verified.payerVpa ?? undefined,
              )
              return
            }
            failToPayment(
              verified.error +
                " No order was placed — please try again or pay cash on delivery.",
            )
          })()
        },
        onDismiss: () => {
          // Live-key UPI intent hands off to the customer's real UPI app —
          // Checkout's success callback can be lost on the way back. Offer a
          // server-side check instead of declaring failure while the money
          // may already be gone.
          if (opts.razorpayOrderId && !opts.keyId.startsWith("rzp_test_")) {
            setPayingOnline(false)
            setPayRecover({
              order: draft,
              rzpOrderId: opts.razorpayOrderId,
              note: "",
              busy: false,
            })
            setStep("payment")
            return
          }
          failToPayment(failNote)
        },
      })

    setPayingOnline(true)
    setPayRecover(null)
    setTestReceipt(gateway.razorpayKeyId.trim().startsWith("rzp_test_"))
    void (async () => {
      const created = await createRazorpayOrder({
        orderId: draft.id,
        items: draft.items.map((item) => ({
          id: item.id ?? 0,
          qty: item.qty,
        })),
        discount: draft.discount,
      })
      if (created.ok) {
        await openCheckout({
          keyId: created.keyId,
          razorpayOrderId: created.razorpayOrderId,
          amount: created.amount,
        })
        return
      }
      if (isPaymentServerSetupError(created.error)) {
        // Payment server not deployed/configured yet → Key-ID fallback.
        await openCheckout({
          keyId: gateway.razorpayKeyId.trim(),
          amount: draft.total,
        })
        return
      }
      failToPayment(created.error)
    })()
  }

  // Recovery card actions — ask the server whether the Razorpay order was
  // actually paid (the gateway is the authority; the app never guesses).
  const handleRecoverCheck = () => {
    if (!payRecover || payRecover.busy) return
    const current = payRecover
    setPayRecover({ ...current, busy: true, note: "" })
    void (async () => {
      const result = await checkRazorpayPayment({
        razorpayOrderId: current.rzpOrderId,
        order: current.order,
      })
      if (result.paid === true) {
        finalizeOrder(
          current.order,
          "success",
          result.paymentId ?? current.rzpOrderId,
          result.payerVpa ?? undefined,
        )
        return
      }
      if (result.paid === false) {
        setPayRecover(null)
        setPayNote(
          "No payment was received for this order — no order was placed. Please try again.",
        )
        return
      }
      setPayRecover({
        ...current,
        busy: false,
        note: "Could not confirm with the bank yet. If your bank shows the amount was deducted, wait a minute, then check again — do not pay a second time.",
      })
    })()
  }

  const handleRecoverCancel = () => {
    setPayRecover(null)
    setPayNote(
      "Payment was not completed — no money was received. Please try again or pay cash on delivery.",
    )
  }

  const placeOrder = () => {
    if (!selected) return
    setPayNote("")
    setPayRecover(null)
    if (items.length === 0) {
      setPayNote(
        "Your cart is empty — close checkout, add items, and try again.",
      )
      return
    }

    if (activePayment === "Online" || activePayment === "UPI") {
      runGatewayPayment(activePayment === "UPI")
      return
    }

    // Cash on delivery — order placed now, paid on delivery.
    setTestReceipt(false)
    finalizeOrder(buildOrder("Cash on delivery"), "cod")
  }

  return (
    <>
      <div
        className="modal-backdrop"
        role="presentation"
        onMouseDown={() => !placed && !payingOnline && onClose()}
      >
        <section
          className="modal narrow"
          role="dialog"
          aria-modal="true"
          aria-label="Checkout"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {placed ? (
            <div className="checkout-success">
              <span className="success-icon">
                <Icon name="check" size={30} />
              </span>
              <p>
                {payResult === "success"
                  ? "PAYMENT SUCCESSFUL"
                  : "ORDER PLACED"}
              </p>
              <h2>Thanks, {placed.customer.split(" ")[0]}!</h2>
              <span>
                Order {placed.id} · {formatINR(placed.total)} · {placed.payment}
              </span>
              {payResult === "cod" ? (
                <small className="pay-note">
                  Pay {formatINR(placed.total)} in cash when your order arrives.
                </small>
              ) : payResult === "pending" ? (
                <small className="pay-note">
                  {txnRef
                    ? "Your UPI transaction id is saved with this order. The store verifies it with the bank and confirms the order."
                    : "The store confirms your order once the payment is received."}
                </small>
              ) : (
                <small className="pay-note">
                  Payment of {formatINR(placed.total)} received. Your order is
                  confirmed.
                </small>
              )}
              {testReceipt && payResult === "success" && (
                <small className="pay-note test-mode">
                  Test payment — no real money was charged.
                </small>
              )}
              {txnRef && (
                <small className="pay-note txn-ref">
                  Transaction ID: <code>{txnRef}</code>
                </small>
              )}
              {receiptVpa && (
                <small className="pay-note txn-ref">
                  Paid from UPI ID: <code>{receiptVpa}</code>
                </small>
              )}
              <AppButton onClick={onClose}>Continue shopping</AppButton>
            </div>
          ) : (
            <>
              <div className="modal-head">
                <div>
                  <p>SECURE CHECKOUT</p>
                  <h2>{step === "address" ? "Delivery address" : "Payment"}</h2>
                  <span>
                    {items.length} items · {formatINR(total)}
                  </span>
                </div>
                <button onClick={onClose} aria-label="Close">
                  <Icon name="close" />
                </button>
              </div>
              <div className="checkout-steps">
                <span className={step === "address" ? "active" : "done"}>
                  1 Address
                </span>
                <span className={step === "payment" ? "active" : ""}>
                  2 Payment
                </span>
              </div>

              {step === "address" &&
                (showForm ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveAddr()
                    }}
                  >
                    <div className="form-grid">
                      <div className="wide loc-block">
                        <span className="loc-title">Delivery location</span>
                        <div className="loc-actions">
                          <button
                            type="button"
                            className="loc-btn"
                            disabled={locBusy}
                            onClick={useMyLocation}
                          >
                            <Icon name="pin" size={16} />
                            {locBusy
                              ? "Detecting your location…"
                              : "Use my GPS location"}
                          </button>
                          <button
                            type="button"
                            className="loc-btn alt"
                            onClick={() => setMapOpen(true)}
                          >
                            <Icon name="map" size={16} /> Choose on map
                          </button>
                        </div>
                        {locMsg && (
                          <p
                            className={
                              locMsg.includes("denied") ||
                              locMsg.includes("Could not")
                                ? "form-error"
                                : "loc-note"
                            }
                          >
                            {locMsg}
                          </p>
                        )}
                        {coords && (
                          <div className="loc-chip">
                            <Icon name="pin" size={14} />
                            <span>
                              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                            </span>
                            <a
                              href={mapsLink(coords.lat, coords.lng)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View on map
                            </a>
                          </div>
                        )}
                      </div>
                      <label className="wide">
                        House / Flat / Apartment *
                        <input
                          required
                          placeholder="e.g. 5-1-2, Sai Residency"
                          value={parts.house}
                          onChange={(event) =>
                            setField("house", event.target.value)
                          }
                        />
                      </label>
                      <label className="wide">
                        Colony / Area / Village *
                        <input
                          required
                          placeholder="e.g. Banjara Hills Road No. 1"
                          value={parts.colony}
                          onChange={(event) =>
                            setField("colony", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        City *
                        <input
                          required
                          placeholder="Hyderabad"
                          value={parts.city}
                          onChange={(event) =>
                            setField("city", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Pincode *
                        <input
                          required
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="500034"
                          value={parts.pincode}
                          onChange={(event) =>
                            setField("pincode", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Mandal / Taluk
                        <input
                          placeholder="Mandal"
                          value={parts.mandal}
                          onChange={(event) =>
                            setField("mandal", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        District
                        <input
                          placeholder="District"
                          value={parts.district}
                          onChange={(event) =>
                            setField("district", event.target.value)
                          }
                        />
                      </label>
                      <label className="wide">
                        State
                        <input
                          placeholder="State"
                          value={parts.state}
                          onChange={(event) =>
                            setField("state", event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className="modal-actions">
                      <AppButton
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setShowForm(false)
                          setEditing(null)
                          setLocMsg("")
                        }}
                      >
                        {addresses.length ? "Back" : "Cancel"}
                      </AppButton>
                      <AppButton type="submit">
                        {editing ? "Update address" : "Save address"}
                      </AppButton>
                    </div>
                  </form>
                ) : (
                  <div className="addr-select">
                    {addresses.length === 0 ? (
                      <div className="empty">
                        <Icon name="map" size={26} />
                        <h3>No saved addresses</h3>
                        <p>Add a delivery address to continue.</p>
                      </div>
                    ) : (
                      addresses.map((addr) => (
                        <label
                          key={addr.id}
                          className={`addr-option${
                            selectedId === addr.id ? " on" : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name="deliver-to"
                            checked={selectedId === addr.id}
                            onChange={() => setSelectedId(addr.id)}
                          />
                          <div className="addr-option-body">
                            <strong>
                              {addr.label}
                              {addr.isDefault ? " · Default" : ""}
                            </strong>
                            <span>{addr.line}</span>
                            <small>
                              {addr.name} · {addr.phone}
                            </small>
                          </div>
                          <div className="addr-option-actions">
                            <button
                              type="button"
                              onClick={() => editAddr(addr)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onRemoveAddress(addr.id)
                                if (selectedId === addr.id) setSelectedId(null)
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </label>
                      ))
                    )}
                    <div className="addr-cta">
                      <button
                        type="button"
                        className="loc-btn"
                        disabled={locBusy}
                        onClick={useMyLocationThenNew}
                      >
                        <Icon name="pin" size={16} />
                        {locBusy ? "Detecting…" : "Use my GPS location"}
                      </button>
                      <button
                        type="button"
                        className="loc-btn alt"
                        onClick={startNew}
                      >
                        <Icon name="plus" size={16} /> Add new address
                      </button>
                    </div>
                    {locMsg && <p className="loc-note">{locMsg}</p>}
                    <div className="modal-actions">
                      <AppButton
                        variant="ghost"
                        type="button"
                        onClick={onClose}
                      >
                        Cancel
                      </AppButton>
                      <AppButton
                        type="button"
                        disabled={!selected}
                        onClick={() => setStep("payment")}
                      >
                        Deliver here · Continue
                      </AppButton>
                    </div>
                  </div>
                ))}

              {step === "payment" && (
                <div className="pay-step">
                  <div className="pay-addr">
                    <span>Deliver to</span>
                    <strong>{selected?.label}</strong>
                    <p>{selected?.line}</p>
                    <small>
                      {selected?.name} · {selected?.phone}
                    </small>
                    <button type="button" onClick={() => setStep("address")}>
                      Change
                    </button>
                  </div>
                  {payRecover ? (
                    <div className="pay-recover">
                      <strong>
                        Did you complete the payment in your UPI app?
                      </strong>
                      <p>
                        If the money was deducted, we can check with the bank
                        and confirm your order — please don't pay a second time.
                      </p>
                      {payRecover.note && (
                        <p className="pay-error">{payRecover.note}</p>
                      )}
                      <div className="action-pair">
                        <AppButton
                          type="button"
                          disabled={payRecover.busy}
                          onClick={handleRecoverCheck}
                        >
                          {payRecover.busy
                            ? "Checking with the bank…"
                            : "Yes, I paid — check"}
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          type="button"
                          disabled={payRecover.busy}
                          onClick={handleRecoverCancel}
                        >
                          No, I didn't pay
                        </AppButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="pay-methods">
                        {testKeyMode && hasRazorpay && (
                          <p className="test-mode">
                            Test mode — payments are simulated, no real money is
                            charged.
                          </p>
                        )}
                        {hasRazorpay && (
                          <label
                            className={activePayment === "Online" ? "on" : ""}
                          >
                            <input
                              type="radio"
                              name="pay"
                              checked={activePayment === "Online"}
                              onChange={() => setPayment("Online")}
                            />
                            <div>
                              <strong>Pay online</strong>
                              <small>
                                UPI, Cards &amp; Netbanking · Razorpay secure
                                checkout
                              </small>
                            </div>
                          </label>
                        )}
                        {upiListed && (
                          <>
                            <label
                              className={
                                (activePayment === "UPI" ? "on" : "") +
                                (upiActive ? "" : " disabled")
                              }
                            >
                              <input
                                type="radio"
                                name="pay"
                                checked={activePayment === "UPI"}
                                disabled={!upiActive}
                                onChange={() => setPayment("UPI")}
                              />
                              <div>
                                <strong>UPI{upiActive ? "" : " ✗"}</strong>
                                <small>
                                  {upiActive
                                    ? "Google Pay, PhonePe, Paytm, BHIM or UPI ID — opens your UPI app"
                                    : "Payments not set up yet — pay by cash on delivery"}
                                </small>
                              </div>
                            </label>
                          </>
                        )}
                        {payNote && <p className="pay-error">{payNote}</p>}
                        <label
                          className={
                            activePayment === "Cash on delivery" ? "on" : ""
                          }
                        >
                          <input
                            type="radio"
                            name="pay"
                            checked={activePayment === "Cash on delivery"}
                            onChange={() => setPayment("Cash on delivery")}
                          />
                          <div>
                            <strong>Cash on delivery</strong>
                            <small>Pay when your order arrives</small>
                          </div>
                        </label>
                      </div>
                      <dl className="checkout-totals">
                        <div>
                          <dt>Subtotal</dt>
                          <dd>{formatINR(Math.round(subtotal))}</dd>
                        </div>
                        {discount > 0 && (
                          <div>
                            <dt>Savings</dt>
                            <dd className="saving">
                              -{formatINR(Math.round(discount))}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>Delivery</dt>
                          <dd>
                            {delivery === 0 ? "Free" : formatINR(delivery)}
                          </dd>
                        </div>
                        <div className="total">
                          <dt>Total</dt>
                          <dd>{formatINR(total)}</dd>
                        </div>
                      </dl>
                      <div className="modal-actions">
                        <AppButton
                          variant="ghost"
                          type="button"
                          onClick={() => setStep("address")}
                        >
                          Back
                        </AppButton>
                        <AppButton
                          type="button"
                          onClick={placeOrder}
                          disabled={payingOnline || items.length === 0}
                        >
                          {payingOnline
                            ? "Opening payment…"
                            : activePayment === "Online"
                              ? `Pay ${formatINR(total)}`
                              : activePayment === "UPI"
                                ? `Pay ${formatINR(total)} via UPI`
                                : `Place order · ${formatINR(total)}`}
                        </AppButton>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {mapOpen && (
        <MapPickerModal
          initialLat={coords?.lat}
          initialLng={coords?.lng}
          onPick={(result) => {
            setParts((current) => ({
              ...result.parts,
              house: result.parts.house || current.house,
            }))
            setCoords({ lat: result.lat, lng: result.lng })
            setMapOpen(false)
            setLocMsg(
              "Location pinned on the map. You can edit the details below.",
            )
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </>
  )
}

function Shop({
  user,
  orders,
  payments,
  catalog,
  catalogReady,
  isAdmin,
  onOpenAdmin,
  signIn,
  createAccount,
  onUpdateProfile,
  onUpdatePassword,
  onDeleteAccount,
  onSignOut,
  onPlaceOrder,
  onRecordPayment,
}: {
  user: Account | null
  orders: Order[]
  payments: Payment[]
  catalog: Product[]
  catalogReady: boolean
  isAdmin: boolean
  onOpenAdmin: () => void
  signIn: (username: string, password: string) => Promise<string | null>
  createAccount: (
    name: string,
    username: string,
    password: string,
  ) => Promise<string | null>
  onUpdateProfile: (name: string, phone: string) => Promise<string | null>
  onUpdatePassword: (current: string, next: string) => Promise<string | null>
  onDeleteAccount: () => Promise<void>
  onSignOut: () => Promise<void> | void
  onPlaceOrder: (order: Order) => void
  onRecordPayment: (payment: Payment) => void
}) {
  const products = catalog
  const categoryCount = (name: string) =>
    products.filter((product) => product.category === name).length
  const [tab, setTab] = useState("Home")
  const [categoryView, setCategoryView] = useState<string | null>(null)
  const [backTab, setBackTab] = useState("Home")
  const [carts, setCarts] = useState<Record<string, Record<number, number>>>(
    () => loadState("greeno_carts", {}),
  )
  const [selected, setSelected] = useState<Product | null>(null)
  const [search, setSearch] = useState("")
  const [promo, setPromo] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "create">("signin")
  const [authNote, setAuthNote] = useState<string | undefined>(undefined)
  const [pendingCheckout, setPendingCheckout] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cartNote, setCartNote] = useState("")
  const [addresses, setAddresses] = useState<Record<string, Address[]>>(() =>
    loadState("greeno_addresses", {}),
  )
  const [wishlist, setWishlist] = useState<Record<string, number[]>>(() =>
    loadState("greeno_wishlist", {}),
  )
  const [offerCategory, setOfferCategory] = useState("All")
  const [offerSort, setOfferSort] = useState("discount-desc")
  const [homeCat, setHomeCat] = useState("All")
  // Account menu vs. a selected account section (mobile). Lifted so the
  // Android back button can return to the menu before leaving the tab.
  const [acctMenu, setAcctMenu] = useState(true)

  // Per-user cart: keyed by username so it survives app restarts and never
  // leaks between accounts. Guests get their own bucket.
  const cartKey = user?.username?.toLowerCase() ?? "__guest__"
  const cart = carts[cartKey] ?? {}
  const setCart = (
    update: Record<number, number> | ((
      own: Record<number, number>,
    ) => Record<number, number>),
  ) =>
    setCarts((all) => {
      const own = all[cartKey] ?? {}
      const nextOwn = typeof update === "function" ? update(own) : update
      return { ...all, [cartKey]: nextOwn }
    })

  useEffect(() => saveState("greeno_carts", carts), [carts])
  useEffect(() => saveState("greeno_addresses", addresses), [addresses])
  useEffect(() => saveState("greeno_wishlist", wishlist), [wishlist])

  const userAddresses = user ? (addresses[user.username] ?? []) : []
  const wishedIds = user ? (wishlist[user.username] ?? []) : []

  // hydrate addresses + wishlist from cloud when signed in
  useEffect(() => {
    if (!isCloud || !user) return
    let active = true
    void (async () => {
      const uid = await cloudUserId()
      if (!uid) return
      const cloudAddresses = await cloudListAddresses(uid)
      const cloudWishlist = await cloudListWishlist(uid)
      if (!active) return
      if (cloudAddresses && cloudAddresses.length)
        setAddresses((current) => ({
          ...current,
          [user.username]: cloudAddresses.map((a) => ({ ...a })),
        }))
      if (cloudWishlist && cloudWishlist.length)
        setWishlist((current) => ({
          ...current,
          [user.username]: cloudWishlist,
        }))
    })()
    return () => {
      active = false
    }
  }, [user?.username])

  const pushAddress = (addr: Address) => {
    if (!isCloud) return
    void (async () => {
      const uid = await cloudUserId()
      if (uid) await cloudSaveAddress(uid, addr)
    })()
  }

  const toggleWish = (id: number) => {
    if (!user) {
      setAuthMode("signin")
      setAuthNote("Sign in to save items to your wishlist.")
      setAuthOpen(true)
      return
    }
    setWishlist((current) => {
      const own = current[user.username] ?? []
      const next = own.includes(id)
        ? own.filter((itemId) => itemId !== id)
        : [...own, id]
      if (isCloud)
        void (async () => {
          const uid = await cloudUserId()
          if (uid) await cloudSetWishlist(uid, next)
        })()
      return { ...current, [user.username]: next }
    })
  }

  const upsertAddress = (draft: Omit<Address, "id"> & { id?: number }) => {
    if (!user) return
    setAddresses((current) => {
      const own = [...(current[user.username] ?? [])]
      let result: Address[]
      if (draft.id) {
        const index = own.findIndex((address) => address.id === draft.id)
        if (index >= 0) {
          own[index] = { ...own[index], ...draft, id: draft.id }
          result = own
        } else {
          result = [...own, { ...draft, id: draft.id } as Address]
        }
      } else {
        const next: Address = {
          ...draft,
          id: draft.id ?? Date.now(),
        } as Address
        if (next.isDefault || own.length === 0) {
          next.isDefault = true
          for (let i = 0; i < own.length; i++)
            own[i] = { ...own[i], isDefault: false }
        }
        result = [...own, next]
      }
      for (const addr of result) pushAddress(addr)
      return { ...current, [user.username]: result }
    })
  }

  const removeAddress = (id: number) => {
    if (!user) return
    setAddresses((current) => {
      const own = (current[user.username] ?? []).filter(
        (address) => address.id !== id,
      )
      if (own.length && !own.some((address) => address.isDefault))
        own[0] = { ...own[0], isDefault: true }
      if (isCloud)
        void (async () => {
          const uid = await cloudUserId()
          if (uid) {
            await cloudDeleteAddress(uid, id)
            for (const addr of own) await cloudSaveAddress(uid, addr)
          }
        })()
      return { ...current, [user.username]: own }
    })
  }

  const makeDefaultAddress = (id: number) => {
    if (!user) return
    setAddresses((current) => {
      const own = (current[user.username] ?? []).map((address) => ({
        ...address,
        isDefault: address.id === id,
      }))
      for (const addr of own) pushAddress(addr)
      return { ...current, [user.username]: own }
    })
  }

  const reorder = (items: OrderItem[]) => {
    setCart((current) => {
      const next = { ...current }
      for (const item of items) {
        const product = products.find((p) => p.name === item.name)
        if (product) next[product.id] = (next[product.id] || 0) + item.qty
      }
      return next
    })
    goToTab("Cart")
  }

  // Cart lines that still exist in the current catalog. The raw cart record
  // can hold ids from an older catalog — those used to keep the badge "full"
  // while checkout silently had 0 items (the payment server then rejected
  // the empty cart). Prune them once the catalog is settled so the badge,
  // totals and checkout always agree.
  const checkoutItems: OrderItem[] = products
    .filter((product) => cart[product.id])
    .map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      qty: cart[product.id],
      price: product.price,
    }))
  useEffect(() => {
    if (!catalogReady) return
    setCart((own) => {
      const ids = new Set(products.map((product) => product.id))
      const next: Record<number, number> = {}
      let changed = false
      for (const [id, qty] of Object.entries(own)) {
        if (qty > 0 && ids.has(Number(id))) next[Number(id)] = qty
        else changed = true
      }
      return changed ? next : own
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogReady, products])

  const count = checkoutItems.reduce((total, line) => total + line.qty, 0)
  const subtotal = products.reduce(
    (total, product) => total + product.price * (cart[product.id] || 0),
    0,
  )
  const searchResults = useMemo(
    () => (search.trim() ? searchProducts(search, products) : products),
    [search, products],
  )

  const openCategory = (name: string) => {
    const normalized = name === "All" ? "ALL" : name
    if (!categoryView) setBackTab(tab)
    setCategoryView(normalized)
    setTab("Categories")
  }

  const closeCategory = () => {
    setCategoryView(null)
    setTab(backTab)
  }

  const goToTab = (next: string) => {
    setCategoryView(null)
    setTab(next)
    if (next === "Account") setAcctMenu(true)
  }

  // Android back / swipe-back: step back through screens instead of closing
  // the app. Only exits once we're back at the Home root.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const handler = CapApp.addListener("backButton", () => {
      if (checkoutOpen) {
        setCheckoutOpen(false)
        return
      }
      if (authOpen) {
        setAuthOpen(false)
        setAuthNote(undefined)
        setPendingCheckout(false)
        return
      }
      if (promo) {
        setPromo(false)
        return
      }
      if (selected) {
        setSelected(null)
        return
      }
      if (categoryView) {
        closeCategory()
        return
      }
      if (tab === "Account" && !acctMenu) {
        setAcctMenu(true)
        return
      }
      if (tab !== "Home") {
        goToTab("Home")
        return
      }
      // At the Home root — exit like a normal Android app.
      CapApp.exitApp()
    })
    return () => {
      handler.then((h) => h.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOpen, authOpen, promo, selected, categoryView, tab, acctMenu])

  const activeCategory =
    categoryView && categoryView !== "ALL"
      ? (categories.find((item) => item.name === categoryView) ?? null)
      : null

  const categoryProducts = searchResults.filter(
    (product) =>
      categoryView === "ALL" ||
      (categoryView !== null && product.category === categoryView),
  )

  const homeProducts = useMemo(
    () =>
      homeCat === "All"
        ? searchResults
        : searchResults.filter((p) => p.category === homeCat),
    [searchResults, homeCat],
  )

  // ---- Offers: products that actually carry a discount (old > price) ----
  const discountPct = (p: Product) =>
    p.old > p.price ? Math.round(((p.old - p.price) / p.old) * 100) : 0
  const offerBase = useMemo(
    () => products.filter((p) => p.old > p.price),
    [products],
  )
  const offers = useMemo(() => {
    let list = search.trim() ? searchProducts(search, offerBase) : offerBase
    if (offerCategory !== "All")
      list = list.filter((p) => p.category === offerCategory)
    const sorted = [...list]
    switch (offerSort) {
      case "price-asc":
        sorted.sort((a, b) => a.price - b.price)
        break
      case "price-desc":
        sorted.sort((a, b) => b.price - a.price)
        break
      case "discount-asc":
        sorted.sort((a, b) => discountPct(a) - discountPct(b))
        break
      case "discount-desc":
      default:
        sorted.sort((a, b) => discountPct(b) - discountPct(a))
        break
    }
    return sorted
  }, [offerBase, search, offerCategory, offerSort])

  const changeQuantity = (id: number, delta: number) =>
    setCart((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] || 0) + delta),
    }))

  const deliveryFee = subtotal > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE
  const savings = promo ? Math.round(subtotal * 0.1) : 0
  const total = Math.round(subtotal - savings + deliveryFee)

  const openCheckout = () => {
    if (!user) {
      setAuthMode("signin")
      setAuthNote("Sign in to place your order.")
      setPendingCheckout(true)
      setAuthOpen(true)
      return
    }
    if (checkoutItems.length === 0) {
      setCartNote("Your cart is empty — add a few items before checking out.")
      return
    }
    setCartNote("")
    setCheckoutOpen(true)
  }

  const handleAuth = async (data: {
    name: string
    username: string
    password: string
  }): Promise<string | null> => {
    const problem =
      authMode === "signin"
        ? await signIn(data.username, data.password)
        : await createAccount(data.name, data.username, data.password)
    if (problem) return problem
    setAuthOpen(false)
    setAuthNote(undefined)
    if (pendingCheckout) {
      setPendingCheckout(false)
      setCheckoutOpen(true)
    }
    return null
  }

  if (selected) {
    return (
      <div className="shop-shell">
        <header className="shop-header compact">
          <Brand />
          <AppButton variant="ghost" onClick={() => setSelected(null)}>
            <Icon name="back" size={18} /> Back
          </AppButton>
        </header>
        <main className="detail-page">
          <div className="detail-image">
            <Img
              src={selected.image}
              alt={selected.name}
              emoji={selected.emoji}
            />
            <span className="discount">{selected.discount}</span>
          </div>
          <div className="detail-copy">
            <button
              className="eyebrow"
              onClick={() => {
                openCategory(selected.category)
                setSelected(null)
              }}
            >
              {selected.category} <Icon name="chevron" size={12} />
            </button>
            <h1>{selected.name}</h1>
            <div className="rating">
              <small>New product · No reviews yet</small>
            </div>
            <div className="stock-chip">
              <span />
              <strong>In stock</strong> · Usually ready in 10 minutes
            </div>
            <div className="detail-price">
              <strong>{formatINR(selected.price)}</strong>
              <del>{formatINR(selected.old)}</del>
              <span>You save {formatINR(selected.old - selected.price)}</span>
            </div>
            <p className="description">
              A trusted everyday grocery staple selected for quality and value.
              Packed securely and ready for your weekly shop.
            </p>
            <label className="field-label">
              Choose size
              <select defaultValue={selected.unit}>
                <option>{selected.unit}</option>
                <option>1 kg</option>
                <option>2 kg family pack</option>
              </select>
            </label>
            <div className="offer-card">
              <Icon name="tag" />
              <div>
                <strong>Bundle & save</strong>
                <p>
                  Buy 2 and get the third one free. Added automatically at
                  checkout.
                </p>
              </div>
            </div>
            <div className="detail-actions">
              <div className="quantity large">
                <button
                  onClick={() => changeQuantity(selected.id, -1)}
                  aria-label="Remove one"
                >
                  <Icon name="minus" />
                </button>
                <span>{cart[selected.id] || 0}</span>
                <button
                  onClick={() => changeQuantity(selected.id, 1)}
                  aria-label="Add one"
                >
                  <Icon name="plus" />
                </button>
              </div>
              <AppButton onClick={() => changeQuantity(selected.id, 1)}>
                <Icon name="cart" /> Add to cart · {formatINR(selected.price)}
              </AppButton>
              <button
                className={`detail-wish${
                  wishedIds.includes(selected.id) ? " on" : ""
                }`}
                onClick={() => toggleWish(selected.id)}
              >
                <Icon name="heart" size={18} />
                {wishedIds.includes(selected.id) ? "Saved" : "Wishlist"}
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="shop-shell">
      <header className="shop-header">
        <Brand />
        <button className="location">
          <Icon name="map" size={18} />
          <span>
            <small>Delivering to</small>
            <strong>Home · 24 Green Street</strong>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="desktop-search">
          <Icon name="search" size={19} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search groceries — try milk, atta, breakfast…"
          />
        </div>
        <div className="header-actions">
          <button className="icon-btn" aria-label="Notifications">
            <Icon name="bell" />
          </button>
          <button className="cart-btn" onClick={() => goToTab("Cart")}>
            <Icon name="cart" />
            <span>My cart</span>
            {count > 0 && <b>{count}</b>}
          </button>
        </div>
      </header>

      <main>
        {categoryView ? (
          <section className="catalog category-page" id="products">
            <button className="back-btn" onClick={closeCategory}>
              <Icon name="back" size={18} />
              {backTab === "Cart" ? "Back to cart" : `Back to ${backTab}`}
            </button>
            {activeCategory ? (
              <div className="category-banner">
                <Img
                  src={activeCategory.image}
                  alt={activeCategory.name}
                  emoji={activeCategory.emoji}
                  className="cat-img"
                />
                <div>
                  <p>SHOP BY CATEGORY</p>
                  <h1>{activeCategory.name}</h1>
                  <span>
                    {categoryCount(activeCategory.name)} products · Fresh picks
                    added daily
                  </span>
                </div>
              </div>
            ) : (
              <div className="page-intro">
                <p>ALL PRODUCTS</p>
                <h1>Everything in the store</h1>
                <span>
                  {products.length} products across {categories.length}{" "}
                  categories
                </span>
              </div>
            )}
            {categoryProducts.length ? (
              <div className="product-grid">
                {categoryProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    quantity={cart[product.id] || 0}
                    wished={wishedIds.includes(product.id)}
                    onAdd={changeQuantity}
                    onOpen={() => setSelected(product)}
                    onWish={toggleWish}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <Icon name="search" size={28} />
                <h3>No products found</h3>
                <p>Try another search or clear it to see everything.</p>
                <AppButton variant="secondary" onClick={() => setSearch("")}>
                  Clear search
                </AppButton>
              </div>
            )}
          </section>
        ) : tab === "Categories" ? (
          <section className="categories-page">
            <div className="page-intro">
              <p>SHOP BY CATEGORY</p>
              <h1>Browse all categories</h1>
              <span>
                {products.length} products across {categories.length} categories
                — tap one to explore.
              </span>
            </div>
            <div className="category-grid">
              {categories.map((item) => (
                <button
                  key={item.slug}
                  className="category-card"
                  onClick={() => openCategory(item.name)}
                >
                  <Img
                    src={item.image}
                    alt={item.name}
                    emoji={item.emoji}
                    className="cat-img"
                  />
                  <div className="category-card-body">
                    <strong>{item.name}</strong>
                    <small>{categoryCount(item.name)} products</small>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : tab === "Offers" ? (
          <section className="catalog offers-page" id="products">
            <div className="section-heading">
              <div>
                <p>OFFERS &amp; DEALS</p>
                <h2>Offers worth adding</h2>
              </div>
              <span>{offers.length} discounted items</span>
            </div>
            <div className="offers-search">
              <Icon name="search" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search offers — milk, snacks, atta…"
              />
            </div>
            <div className="offer-filters">
              <div className="category-row">
                {["All", ...categories.map((c) => c.name)].map((item) => (
                  <button
                    key={item}
                    className={offerCategory === item ? "active" : ""}
                    onClick={() => setOfferCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <select
                className="offer-sort"
                value={offerSort}
                onChange={(event) => setOfferSort(event.target.value)}
                aria-label="Sort offers"
              >
                <option value="discount-desc">Discount: High to Low</option>
                <option value="discount-asc">Discount: Low to High</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
            </div>
            {offers.length ? (
              <div className="product-grid">
                {offers.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    quantity={cart[product.id] || 0}
                    wished={wishedIds.includes(product.id)}
                    onAdd={changeQuantity}
                    onOpen={() => setSelected(product)}
                    onWish={toggleWish}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <Icon name="tag" size={28} />
                <h3>No offers found</h3>
                <p>Try another search or clear the filters.</p>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setSearch("")
                    setOfferCategory("All")
                  }}
                >
                  Clear filters
                </AppButton>
              </div>
            )}
          </section>
        ) : tab === "Home" ? (
          <>
            <section className="mobile-welcome">
              <div>
                <p>Welcome to GS</p>
                <h1>What are we getting today?</h1>
              </div>
              <button className="avatar">GS</button>
              <div className="mobile-search">
                <Icon name="search" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search — milk, atta, snacks…"
                />
              </div>
            </section>
            <section className="hero">
              <div className="hero-copy">
                <span className="hero-label">WEEKLY GROCERY SAVINGS</span>
                <h1>
                  Everything you need,
                  <br />
                  all in one shop.
                </h1>
                <p>
                  Stock up on pantry staples, dairy, snacks, cooking essentials,
                  household care, and more.
                </p>
                <AppButton
                  onClick={() =>
                    document
                      .getElementById("products")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Shop groceries <Icon name="arrow" />
                </AppButton>
                <small>
                  Free delivery on orders over {formatINR(FREE_DELIVERY_OVER)}
                </small>
              </div>
              <div className="hero-image">
                <img
                  src="https://images.unsplash.com/photo-1722639096482-4e1a805f9b0b?auto=format&fit=crop&w=1400&q=85"
                  alt="A well-stocked general grocery store"
                />
              </div>
            </section>
            <section className="benefits">
              <div>
                <span>
                  <Icon name="package" />
                </span>
                <p>
                  <strong>10-minute pickup</strong>
                  <small>Ready when you are</small>
                </p>
              </div>
              <div>
                <span>
                  <Icon name="check" />
                </span>
                <p>
                  <strong>Quality guarantee</strong>
                  <small>Shop every aisle with confidence</small>
                </p>
              </div>
              <div>
                <span>
                  <Icon name="tag" />
                </span>
                <p>
                  <strong>Everyday value</strong>
                  <small>Fair prices, always</small>
                </p>
              </div>
            </section>
            <section className="catalog" id="products">
              <div className="section-heading">
                <div>
                  <p>SHOP BY CATEGORY</p>
                  <h2>Find your everyday essentials</h2>
                </div>
                <AppButton variant="ghost" onClick={() => openCategory("ALL")}>
                  View all <Icon name="chevron" />
                </AppButton>
              </div>
              <div className="category-row">
                {categoryNames.map((item) => (
                  <button
                    key={item}
                    onClick={() => setHomeCat(item)}
                    className={homeCat === item ? "active" : ""}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="section-heading deals">
                <div>
                  <p>THIS WEEK’S PICKS</p>
                  <h2>{homeCat === "All" ? "All products" : homeCat}</h2>
                </div>
                <span>{homeProducts.length} items</span>
              </div>
              {homeProducts.length ? (
                <div className="product-grid">
                  {homeProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={cart[product.id] || 0}
                      wished={wishedIds.includes(product.id)}
                      onAdd={changeQuantity}
                      onOpen={() => setSelected(product)}
                      onWish={toggleWish}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Icon name="search" size={28} />
                  <h3>No products found</h3>
                  <p>Try another search.</p>
                  <AppButton variant="secondary" onClick={() => setSearch("")}>
                    Clear search
                  </AppButton>
                </div>
              )}
            </section>
          </>
        ) : tab === "Cart" ? (
          <section className="cart-page">
            <div className="page-intro">
              <p>YOUR BASKET</p>
              <h1>Everything looks good.</h1>
              <span>{count} items · Quality checked before packing</span>
            </div>
            <div className="checkout-grid">
              <div className="cart-list">
                {products
                  .filter((product) => cart[product.id])
                  .map((product) => (
                    <article className="cart-line" key={product.id}>
                      <Img
                        src={product.image}
                        alt={product.name}
                        emoji={product.emoji}
                      />
                      <div>
                        <h3>{product.name}</h3>
                        <p>{product.unit}</p>
                        <strong>{formatINR(product.price)}</strong>
                      </div>
                      <div className="quantity">
                        <button onClick={() => changeQuantity(product.id, -1)}>
                          <Icon name="minus" />
                        </button>
                        <span>{cart[product.id]}</span>
                        <button onClick={() => changeQuantity(product.id, 1)}>
                          <Icon name="plus" />
                        </button>
                      </div>
                    </article>
                  ))}
                {count === 0 && (
                  <div className="empty">
                    <Icon name="cart" size={28} />
                    <h3>Your cart is waiting</h3>
                    <p>Add a few everyday favorites to get started.</p>
                    <AppButton onClick={() => setTab("Home")}>
                      Browse products
                    </AppButton>
                  </div>
                )}
              </div>
              <aside className="order-card">
                <h2>Order summary</h2>
                <div className="promo">
                  <Icon name="tag" />
                  <input placeholder="Promo code" />
                  <AppButton variant="secondary" onClick={() => setPromo(true)}>
                    {promo ? "Applied" : "Apply"}
                  </AppButton>
                </div>
                {promo && (
                  <p className="promo-success">
                    <Icon name="check" size={15} /> GREENER10 applied — you
                    saved 10%
                  </p>
                )}
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{formatINR(Math.round(subtotal))}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>
                      {deliveryFee === 0 ? "Free" : formatINR(deliveryFee)}
                    </dd>
                  </div>
                  <div>
                    <dt>Savings</dt>
                    <dd className="saving">-{formatINR(savings)}</dd>
                  </div>
                  <div className="total">
                    <dt>Total</dt>
                    <dd>{formatINR(total)}</dd>
                  </div>
                </dl>
                <AppButton
                  className="full"
                  disabled={count === 0}
                  onClick={openCheckout}
                >
                  Continue to checkout <Icon name="arrow" />
                </AppButton>
                <small>
                  Secure checkout · Easy returns · Quality guaranteed
                </small>
                {cartNote && <p className="pay-error">{cartNote}</p>}
              </aside>
            </div>
          </section>
        ) : user ? (
          <MyAccount
            user={user}
            orders={orders}
            payments={payments}
            products={products}
            wishedIds={wishedIds}
            addresses={userAddresses}
            onUpdateProfile={onUpdateProfile}
            onUpdatePassword={onUpdatePassword}
            onDeleteAccount={onDeleteAccount}
            onSignOut={onSignOut}
            onAddAddress={upsertAddress}
            onRemoveAddress={removeAddress}
            onDefaultAddress={makeDefaultAddress}
            onWish={toggleWish}
            onReorder={reorder}
            onGoCart={() => goToTab("Cart")}
            isAdmin={isAdmin}
            onOpenAdmin={onOpenAdmin}
            acctMenu={acctMenu}
            onAcctMenu={setAcctMenu}
          />
        ) : (
          <section className="account-page">
            <div className="account-card">
              <div className="account-avatar">
                <Icon name="user" />
              </div>
              <p>YOUR ACCOUNT</p>
              <h1>Start shopping with GS</h1>
              <span>
                Sign in to save addresses, wishlist and track future orders.
              </span>
              <AppButton
                onClick={() => {
                  setAuthMode("signin")
                  setAuthNote(undefined)
                  setAuthOpen(true)
                }}
              >
                Sign in or create account
              </AppButton>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        {[
          ["Home", "home"],
          ["Categories", "grid"],
          ["Offers", "tag"],
          ["Cart", "cart"],
          ["Account", "user"],
        ].map(([label, icon]) => (
          <button
            key={label}
            className={tab === label ? "active" : ""}
            onClick={() => goToTab(label)}
          >
            <span>
              <Icon name={icon as IconName} />
              {label === "Cart" && count > 0 && <b>{count}</b>}
            </span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
      <footer>
        <Brand />
        <p>Good food, thoughtfully sourced, delivered simply.</p>
      </footer>

      {authOpen && (
        <AuthModal
          mode={authMode}
          setMode={setAuthMode}
          note={authNote}
          onSubmit={handleAuth}
          onClose={() => {
            setAuthOpen(false)
            setAuthNote(undefined)
            setPendingCheckout(false)
          }}
        />
      )}

      {checkoutOpen && user && (
        <CheckoutModal
          user={user}
          items={checkoutItems}
          subtotal={subtotal}
          discount={savings}
          delivery={deliveryFee}
          addresses={userAddresses}
          onUpsertAddress={upsertAddress}
          onRemoveAddress={removeAddress}
          onPlace={(order) => {
            onPlaceOrder(order)
            setCart({})
            setPromo(false)
          }}
          onRecordPayment={onRecordPayment}
          onClose={() => setCheckoutOpen(false)}
        />
      )}
    </div>
  )
}

const adminLinks: [string, IconName][] = [
  ["Dashboard", "home"],
  ["Inventory", "package"],
  ["Orders", "orders"],
  ["Offers", "tag"],
  ["Customers", "users"],
  ["Payments", "card"],
  ["Transactions", "wallet"],
  ["Settings", "settings"],
]

function ProductModal({
  product,
  onSave,
  onClose,
}: {
  product: Product | null
  onSave: (product: Product) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(product?.name ?? "")
  const [category, setCategory] = useState(
    product?.category ?? categories[0].name,
  )
  const [sku, setSku] = useState(product?.sku ?? "")
  const [price, setPrice] = useState(product ? String(product.price) : "")
  const [old, setOld] = useState(product ? String(product.old) : "")
  const [stock, setStock] = useState(product ? String(product.stock) : "")
  const [unit, setUnit] = useState(product?.unit ?? "1 pc")
  const [image, setImage] = useState(product?.image ?? "")
  const [emoji, setEmoji] = useState(product?.emoji ?? "🛒")

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={product ? "Edit product" : "Add product"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p>PRODUCT CATALOG</p>
            <h2>{product ? "Edit product" : "Add a new product"}</h2>
            <span>
              {product
                ? "Update the details and save your changes."
                : "Fill in the details and publish to the storefront."}
            </span>
          </div>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const numPrice = Math.max(0, Math.round(Number(price) || 0))
            const numOld = Math.max(
              numPrice,
              Math.round(Number(old) || numPrice),
            )
            onSave({
              id: product?.id ?? 0,
              name: title.trim(),
              unit: unit.trim() || "1 pc",
              price: numPrice,
              old: numOld,
              discount:
                numOld > numPrice
                  ? `${Math.round((1 - numPrice / numOld) * 100)}% OFF`
                  : "",
              image: image.trim(),
              emoji: emoji.trim() || "🛒",
              category,
              stock: Math.max(0, Math.round(Number(stock) || 0)),
              sku: sku.trim().toUpperCase(),
            })
          }}
        >
          <div className="modal-product-preview">
            <Img
              src={image.trim()}
              alt={title.trim() || "Product preview"}
              emoji={emoji.trim() || "🛒"}
            />
            <span>Live preview — leave image empty to show the emoji</span>
          </div>
          <div className="form-grid">
            <label className="wide">
              Product title
              <input
                required
                placeholder="e.g. Organic Fuji Apples"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item.slug}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              SKU
              <input
                required
                placeholder="e.g. FRT-1024"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
              />
            </label>
            <label>
              Offer price (₹)
              <input
                type="number"
                required
                placeholder="0"
                min="0"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label>
              Regular price (₹)
              <input
                type="number"
                placeholder="0"
                min="0"
                value={old}
                onChange={(event) => setOld(event.target.value)}
              />
            </label>
            <label>
              Stock quantity
              <input
                type="number"
                required
                placeholder="0"
                min="0"
                value={stock}
                onChange={(event) => setStock(event.target.value)}
              />
            </label>
            <label>
              Unit
              <input
                required
                placeholder="e.g. 1 kg, 500 g, 6 pcs"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </label>
            <label className="wide">
              Image URL
              <input
                type="url"
                placeholder="https://… (optional)"
                value={image}
                onChange={(event) => setImage(event.target.value)}
              />
            </label>
            <label>
              Emoji (fallback)
              <input
                maxLength={4}
                placeholder="🍎"
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
              />
            </label>
          </div>
          <div className="modal-actions">
            <AppButton variant="ghost" onClick={onClose}>
              Cancel
            </AppButton>
            <AppButton type="submit">
              <Icon name="check" />{" "}
              {product ? "Save changes" : "Save & publish"}
            </AppButton>
          </div>
        </form>
      </section>
    </div>
  )
}

// Flipkart/BigBasket-style fulfilment timeline. Shows each stage done /
// current / pending with a per-stage timestamp where known.
function TrackingTimeline({ order }: { order: Order }) {
  const stepIndex = stageIndexOf(order.status)
  return (
    <div className="tracking">
      {ORDER_STAGES.map((stage, index) => {
        const done = index < stepIndex
        const current = index === stepIndex
        const at = stageTime(order, stage)
        return (
          <div
            key={stage}
            className={
              "track-step" + (done ? " done" : "") + (current ? " current" : "")
            }
          >
            <span className="track-dot">
              {done ? "✓" : current ? "●" : index + 1}
            </span>
            <div className="track-body">
              <strong>{stage}</strong>
              <small>
                {at
                  ? new Date(at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : current
                    ? "In progress"
                    : "Pending"}
              </small>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AdminOrderRow({
  order,
  expanded,
  onToggle,
  onStatusChange,
}: {
  order: Order
  expanded: boolean
  onToggle: () => void
  onStatusChange: (status: OrderStatus) => void
}) {
  const itemsTotal = order.items.reduce(
    (t, item) => t + item.price * item.qty,
    0,
  )
  const stepIndex = stageIndexOf(order.status)
  const isDone = order.status === "Delivered"
  return (
    <>
      <tr className={expanded ? "row-open" : ""} onClick={onToggle}>
        <td>
          <code>{order.id}</code>
        </td>
        <td>
          <div className="table-customer">
            <strong>{order.customer}</strong>
            <small>@{order.username}</small>
            {order.lat != null && order.lng != null && (
              <a
                className="order-map"
                href={mapsLink(order.lat, order.lng)}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <Icon name="pin" size={11} /> Map
              </a>
            )}
          </div>
        </td>
        <td>
          {order.items.length} items
          <small className="cell-sub">
            {order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}
          </small>
        </td>
        <td>
          <strong>{formatINR(order.total)}</strong>
        </td>
        <td>
          {order.payment}
          <small className="cell-sub">
            {order.payment === "Cash on delivery" ? "Pay at door" : "Prepaid"}
          </small>
        </td>
        <td onClick={(event) => event.stopPropagation()}>
          <div className="status-control">
            <span className={`active-pill${isDone ? " done" : ""}`}>
              <i /> {order.status}
            </span>
            <select
              className="status-select"
              aria-label={`Status for ${order.id}`}
              value={order.status}
              onChange={(event) =>
                onStatusChange(event.target.value as OrderStatus)
              }
            >
              {ORDER_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
            {!isDone && (
              <button
                className="status-advance"
                onClick={() =>
                  onStatusChange(ORDER_STAGES[stepIndex + 1] as OrderStatus)
                }
              >
                Advance
              </button>
            )}
          </div>
        </td>
        <td>
          {new Date(order.placedAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </td>
        <td>
          <button
            className="detail-toggle"
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
          >
            {expanded ? "Hide" : "View"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="order-detail-row">
          <td colSpan={8}>
            <div className="detail-tracking">
              <h4>Tracking</h4>
              <TrackingTimeline order={order} />
            </div>
            <div className="order-detail-grid">
              <div>
                <h4>Products ordered</h4>
                <ul className="detail-items">
                  {order.items.map((item, index) => (
                    <li key={index}>
                      <span>
                        {item.name} <em>{item.unit}</em> × {item.qty}
                      </span>
                      <b>{formatINR(item.price * item.qty)}</b>
                    </li>
                  ))}
                </ul>
                <p className="detail-items-total">
                  Items total: <b>{formatINR(itemsTotal)}</b>
                </p>
              </div>
              <div>
                <h4>Bill amount</h4>
                <ul className="detail-bill">
                  <li>
                    <span>Subtotal</span>
                    <b>{formatINR(order.subtotal)}</b>
                  </li>
                  {order.discount > 0 && (
                    <li>
                      <span>Savings</span>
                      <b>-{formatINR(order.discount)}</b>
                    </li>
                  )}
                  <li>
                    <span>Delivery</span>
                    <b>
                      {order.delivery === 0
                        ? "Free"
                        : formatINR(order.delivery)}
                    </b>
                  </li>
                  <li className="grand">
                    <span>Total paid</span>
                    <b>{formatINR(order.total)}</b>
                  </li>
                </ul>
              </div>
              <div>
                <h4>Payment</h4>
                <p className="detail-line">
                  <Icon name="card" size={14} /> {order.payment}
                </p>
                <p className="detail-note">
                  {order.payment === "Cash on delivery"
                    ? "Customer pays at the door."
                    : "Already paid online."}
                </p>
              </div>
              <div>
                <h4>Delivery address</h4>
                <p className="detail-address">{order.address || "—"}</p>
                {order.lat != null && order.lng != null && (
                  <a
                    className="order-map"
                    href={mapsLink(order.lat, order.lng)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="pin" size={12} /> Open in Google Maps (
                    {order.lat.toFixed(4)}, {order.lng.toFixed(4)})
                  </a>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function TransactionsPage({ payments }: { payments: Payment[] }) {
  const totalCollected = payments
    .filter((p) => p.status === "success" || p.status === "cod")
    .reduce((t, p) => t + p.amount, 0)
  const upiCount = payments.filter((p) => p.method === "UPI").length
  return (
    <div className="inventory-page">
      <section className="welcome-row">
        <div>
          <h2>Transactions</h2>
          <p>
            Every payment recorded at checkout (UPI &amp; cash on delivery).
          </p>
        </div>
      </section>
      <div className="txn-stats">
        <div className="txn-stat">
          <span>Total records</span>
          <strong>{payments.length}</strong>
        </div>
        <div className="txn-stat">
          <span>UPI payments</span>
          <strong>{upiCount}</strong>
        </div>
        <div className="txn-stat">
          <span>Collected</span>
          <strong>{formatINR(totalCollected)}</strong>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Order</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Method</th>
              <th>UPI ID</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.id}</code>
                </td>
                <td>
                  <code>{p.orderId}</code>
                </td>
                <td>
                  <div className="table-customer">
                    <strong>{p.customer}</strong>
                    <small>@{p.username}</small>
                  </div>
                </td>
                <td>
                  <strong>{formatINR(p.amount)}</strong>
                </td>
                <td>
                  {p.method}
                  {p.upiApp && <small className="cell-sub">{p.upiApp}</small>}
                </td>
                <td>
                  <small className="cell-sub">
                    {p.payerVpa || p.merchantVpa || "—"}
                  </small>
                </td>
                <td>
                  <span
                    className={
                      "active-pill" +
                      (p.status === "success" || p.status === "cod"
                        ? " done"
                        : "")
                    }
                  >
                    <i /> {paymentStatusLabel[p.status]}
                  </span>
                </td>
                <td>
                  {new Date(p.timestamp).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.length && (
          <div className="empty">
            <Icon name="wallet" />
            <h3>No transactions yet</h3>
            <p>Payments made at checkout will be recorded here.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Admin({
  switchMode,
  accounts,
  orders,
  catalog,
  payments,
  onSaveProduct,
  onDeleteProduct,
  onUpdateOrderStatus,
}: {
  switchMode: () => void
  accounts: Account[]
  orders: Order[]
  catalog: Product[]
  payments: Payment[]
  onSaveProduct: (product: Product) => void
  onDeleteProduct: (id: number) => void
  onUpdateOrderStatus: (id: string, status: OrderStatus) => void
}) {
  const products = catalog
  const [page, setPage] = useState("Dashboard")
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [invCategory, setInvCategory] = useState("All categories")
  const [invStock, setInvStock] = useState("All stock")
  const [upi, setUpi] = useState<UpiConfig>(() => loadUpi())
  const [upiDialog, setUpiDialog] = useState(false)
  const [upiDraft, setUpiDraft] = useState("")
  const [gateway, setGateway] = useState<GatewayConfig>(() => loadGateway())
  // "saved" = key is on this phone; "shared" = it also reached the cloud so
  // other phones can pick it up. They are different, and hiding that is what
  // made the other phone silently stay cash-only.
  // "saved" = key is on this phone; "shared" = it also reached the cloud so
  // other phones can pick it up. They are different, and hiding that is what
  // made the other phone silently stay cash-only.
  const [gwSync, setGwSync] = useState<"idle" | "saved" | "shared">("idle")

  // Pull the shared payment settings so this device shows what was saved
  // (possibly from another device).
  useEffect(() => {
    if (!isCloud) return
    void (async () => {
      const gw = await cloudGetSetting<{
        razorpayKeyId?: string
        enabled?: boolean
      }>("gateway")
      const upiCfg = await cloudGetSetting<{
        vpa?: string
        enabled?: boolean
      }>("upi")
      if (gw)
        setGateway({
          razorpayKeyId: String(gw.razorpayKeyId ?? ""),
          enabled: gw.enabled !== false,
        })
      if (upiCfg)
        setUpi({
          vpa: String(upiCfg.vpa ?? ""),
          enabled: upiCfg.enabled !== false,
        })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Android back inside the admin: close modal → back to Dashboard → back to
  // the storefront. Mirrors the Shop back handling.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const handler = CapApp.addListener("backButton", () => {
      if (modal) {
        setModal(false)
        setEditing(null)
        setConfirmDeleteId(null)
        return
      }
      if (mobileMenu) {
        setMobileMenu(false)
        return
      }
      if (page !== "Dashboard") {
        setPage("Dashboard")
        return
      }
      switchMode()
    })
    return () => {
      handler.then((h) => h.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, mobileMenu, page, switchMode])

  const openAdd = () => {
    setEditing(null)
    setConfirmDeleteId(null)
    setModal(true)
  }
  const openEdit = (product: Product) => {
    setEditing(product)
    setConfirmDeleteId(null)
    setModal(true)
  }
  const handleDelete = (id: number) => {
    if (confirmDeleteId === id) {
      onDeleteProduct(id)
      setConfirmDeleteId(null)
      return
    }
    setConfirmDeleteId(id)
    window.setTimeout(() => {
      setConfirmDeleteId((current) => (current === id ? null : current))
    }, 3500)
  }
  const visibleProducts = useMemo(
    () =>
      (query.trim() ? searchProducts(query, products) : products).filter(
        (product) =>
          (invCategory === "All categories" ||
            product.category === invCategory) &&
          (invStock === "All stock" ||
            (invStock === "Low stock" &&
              product.stock > 0 &&
              product.stock < 15) ||
            (invStock === "Out of stock" && product.stock === 0)),
      ),
    [query, invCategory, invStock, products],
  )
  const grossSales = orders.reduce((sum, order) => sum + order.total, 0)
  const lowStock = products.filter(
    (product) => product.stock > 0 && product.stock < 15,
  ).length
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <div className="side-top">
          <Brand />
          <button className="side-close" onClick={() => setMobileMenu(false)}>
            <Icon name="close" />
          </button>
        </div>
        <nav>
          <p>WORKSPACE</p>
          {adminLinks.map(([label, icon]) => (
            <button
              key={label}
              className={page === label ? "active" : ""}
              onClick={() => {
                setPage(label)
                setMobileMenu(false)
              }}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-status">
          <span />
          <div>
            <strong>Store is open</strong>
            <small>Accepting orders</small>
          </div>
          <button aria-label="Store status toggle">
            <i />
          </button>
        </div>
        <button className="side-profile">
          <span>GA</span>
          <div>
            <strong>Ganesh</strong>
            <small>Store admin</small>
          </div>
          <Icon name="chevron" size={16} />
        </button>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <button className="menu-btn" onClick={() => setMobileMenu(true)}>
            <Icon name="menu" />
          </button>
          <div>
            <p>{today.toUpperCase()}</p>
            <h1>{page}</h1>
          </div>
          <div className="admin-head-actions">
            <div className="admin-search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, SKU, category…"
              />
            </div>
            <AppButton variant="ghost" onClick={switchMode}>
              <Icon name="back" size={17} /> Back to store
            </AppButton>
            <button className="icon-btn">
              <Icon name="bell" />
            </button>
          </div>
        </header>

        {page === "Dashboard" ? (
          <div className="dashboard">
            <section className="welcome-row">
              <div>
                <h2>Good morning, Ganesh.</h2>
                <p>
                  Your new store is ready. Add products and share it to begin.
                </p>
              </div>
              <AppButton onClick={openAdd}>
                <Icon name="plus" /> Add new product
              </AppButton>
            </section>
            <section className="stats-grid">
              <article>
                <span className="stat-icon green">
                  <Icon name="trend" />
                </span>
                <p>Gross sales</p>
                <h3>{formatINR(grossSales)}</h3>
                <em>{orders.length ? "From placed orders" : "No sales yet"}</em>
              </article>
              <article>
                <span className="stat-icon amber">
                  <Icon name="orders" />
                </span>
                <p>Total orders</p>
                <h3>{orders.length}</h3>
                <em>
                  {orders.length ? "See the orders page" : "No orders yet"}
                </em>
              </article>
              <article>
                <span className="stat-icon blue">
                  <Icon name="users" />
                </span>
                <p>New customers</p>
                <h3>{accounts.length}</h3>
                <em>
                  {accounts.length ? "Registered accounts" : "No customers yet"}
                </em>
              </article>
              <article>
                <span className="stat-icon red">
                  <Icon name="alert" />
                </span>
                <p>Low stock items</p>
                <h3>{lowStock}</h3>
                <button onClick={() => setPage("Inventory")}>
                  View inventory <Icon name="chevron" size={14} />
                </button>
              </article>
            </section>
            <section className="admin-grid">
              <article className="sales-chart">
                <div className="panel-head">
                  <div>
                    <p>SALES PERFORMANCE</p>
                    <h3>Revenue overview</h3>
                  </div>
                  <select>
                    <option>Last 7 days</option>
                    <option>Last 30 days</option>
                  </select>
                </div>
                <div className="chart-total">
                  <strong>{formatINR(grossSales)}</strong>
                  <span>
                    {orders.length
                      ? "Sales from placed orders"
                      : "Sales will appear here"}
                  </span>
                </div>
                <div className="bars">
                  {[0, 0, 0, 0, 0, 0, 0].map((height, index) => (
                    <div key={index}>
                      <span style={{ height: `${height}%` }} />
                      <small>
                        {
                          ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                            index
                          ]
                        }
                      </small>
                    </div>
                  ))}
                </div>
              </article>
              <article className="activity">
                <div className="panel-head">
                  <div>
                    <p>LIVE FEED</p>
                    <h3>Recent orders</h3>
                  </div>
                  <button onClick={() => setPage("Orders")}>View all</button>
                </div>
                {orders.length ? (
                  <ul className="order-feed">
                    {orders.slice(0, 5).map((order) => (
                      <li key={order.id}>
                        <div>
                          <strong>{order.id}</strong>
                          <small>
                            {order.customer} · {order.items.length} items
                          </small>
                        </div>
                        <span className="active-pill">
                          <i /> {order.status}
                        </span>
                        <b>{formatINR(order.total)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty">
                    <Icon name="orders" size={26} />
                    <h3>No orders yet</h3>
                    <p>New customer orders will appear here.</p>
                  </div>
                )}
              </article>
            </section>
          </div>
        ) : page === "Inventory" ? (
          <div className="inventory-page">
            <section className="welcome-row">
              <div>
                <h2>Products & inventory</h2>
                <p>Track availability, pricing, and active promotions.</p>
              </div>
              <div className="action-pair">
                <AppButton variant="secondary">
                  <Icon name="tag" /> Create offer
                </AppButton>
                <AppButton onClick={openAdd}>
                  <Icon name="plus" /> Add product
                </AppButton>
              </div>
            </section>
            <div className="inventory-toolbar">
              <div className="admin-search">
                <Icon name="search" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by product or SKU"
                />
              </div>
              <select
                value={invCategory}
                onChange={(event) => setInvCategory(event.target.value)}
              >
                <option>All categories</option>
                {categories.map((item) => (
                  <option key={item.slug}>{item.name}</option>
                ))}
              </select>
              <select
                value={invStock}
                onChange={(event) => setInvStock(event.target.value)}
              >
                <option>All stock</option>
                <option>Low stock</option>
                <option>Out of stock</option>
              </select>
            </div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>SKU</th>
                    <th>Stock</th>
                    <th>Base price</th>
                    <th>Offer price</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="table-product">
                          <Img
                            src={product.image}
                            alt=""
                            emoji={product.emoji}
                          />
                          <strong>{product.name}</strong>
                        </div>
                      </td>
                      <td>{product.category}</td>
                      <td>
                        <code>{product.sku}</code>
                      </td>
                      <td>
                        <span
                          className={`stock ${
                            product.stock === 0
                              ? "out"
                              : product.stock < 15
                                ? "low"
                                : ""
                          }`}
                        >
                          {product.stock === 0
                            ? "Out of stock"
                            : `${product.stock} in stock`}
                        </span>
                      </td>
                      <td>
                        <del>{formatINR(product.old)}</del>
                      </td>
                      <td>
                        <strong>{formatINR(product.price)}</strong>
                      </td>
                      <td>
                        <span className="active-pill">
                          <i /> Active
                        </span>
                      </td>
                      <td>
                        <div className="inv-actions">
                          <button
                            className="edit"
                            onClick={() => openEdit(product)}
                          >
                            <Icon name="edit" size={16} /> Edit
                          </button>
                          <button
                            className={
                              confirmDeleteId === product.id
                                ? "del confirm"
                                : "del"
                            }
                            onClick={() => handleDelete(product.id)}
                          >
                            <Icon name="trash" size={16} />
                            {confirmDeleteId === product.id
                              ? "Confirm?"
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleProducts.length && (
                <div className="empty">
                  <Icon name="search" />
                  <h3>No inventory matches</h3>
                  <p>Try a product name or SKU.</p>
                </div>
              )}
            </div>
          </div>
        ) : page === "Orders" ? (
          <div className="inventory-page">
            <section className="welcome-row">
              <div>
                <h2>Customer orders</h2>
                <p>Every order placed on the storefront shows up here live.</p>
              </div>
            </section>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Placed</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <AdminOrderRow
                      key={order.id}
                      order={order}
                      expanded={expandedOrder === order.id}
                      onToggle={() =>
                        setExpandedOrder((current) =>
                          current === order.id ? null : order.id,
                        )
                      }
                      onStatusChange={(status) =>
                        onUpdateOrderStatus(order.id, status)
                      }
                    />
                  ))}
                </tbody>
              </table>
              {!orders.length && (
                <div className="empty">
                  <Icon name="orders" />
                  <h3>No orders yet</h3>
                  <p>Orders placed from the storefront will appear here.</p>
                </div>
              )}
            </div>
          </div>
        ) : page === "Payments" ? (
          <div className="inventory-page">
            <section className="welcome-row">
              <div>
                <h2>Payments</h2>
                <p>
                  Connect Razorpay so online orders are paid automatically and
                  settle to your bank, and set the UPI ID for direct payments.
                </p>
              </div>
            </section>
            <div className="table-card" style={{ padding: 22 }}>
              <div className="form-grid">
                <label className="wide">
                  Razorpay Key ID
                  <input
                    value={gateway.razorpayKeyId}
                    placeholder="rzp_test_xxxxxxxxxxxx or rzp_live_..."
                    onChange={(event) => {
                      setGateway((c) => ({
                        ...c,
                        razorpayKeyId: event.target.value,
                      }))
                      setGwSync("idle")
                    }}
                  />
                  <small>
                    From your Razorpay dashboard → Settings → API Keys. Orders
                    are only placed after Razorpay confirms the payment, and the
                    money settles to your linked bank account. Use rzp_test_ to
                    try it first, then switch to rzp_live_.
                  </small>
                </label>
              </div>
              <label className="toggle-row">
                <span>
                  <strong>Accept UPI &amp; online payments</strong>
                  <small>
                    When off, every phone shows only Cash on delivery — no UPI
                    or Pay online. Edits apply when you tap Save.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={gateway.enabled}
                  onChange={(event) => {
                    setGateway((c) => ({ ...c, enabled: event.target.checked }))
                    setGwSync("idle")
                  }}
                />
              </label>
              <div className="action-pair keep-first" style={{ marginTop: 18 }}>
                <AppButton
                  disabled={!gateway.razorpayKeyId.trim()}
                  onClick={() => {
                    saveGateway(gateway)
                    // Shared to every phone through site_settings. Await it so
                    // we can tell the admin the truth: "saved here" is not the
                    // same as "other phones can see it".
                    void (async () => {
                      const ok = await cloudSetSetting("gateway", {
                        razorpayKeyId: gateway.razorpayKeyId.trim(),
                        enabled: gateway.enabled,
                      })
                      setGwSync(ok ? "shared" : "saved")
                    })()
                  }}
                >
                  Save Razorpay
                </AppButton>
                {loadGateway().razorpayKeyId.trim() && (
                  <AppButton
                    variant="secondary"
                    onClick={() => {
                      const next = { ...gateway, razorpayKeyId: "" }
                      saveGateway(next)
                      setGateway(next)
                      setGwSync("idle")
                      void cloudSetSetting("gateway", {
                        razorpayKeyId: "",
                        enabled: next.enabled,
                      })
                    }}
                  >
                    Remove key
                  </AppButton>
                )}
                {gwSync === "shared" && (
                  <small className="save-ok">
                    Saved and synced — every phone now shows “Pay online”.
                  </small>
                )}
                {gwSync === "saved" && (
                  <small className="save-warn">
                    Saved on this phone only — other phones can’t see it yet.
                    The shared settings table isn’t set up. Run the SQL in
                    Supabase once (SQL Editor), then save again.
                  </small>
                )}
              </div>
            </div>
            <div className="table-card" style={{ padding: 22, marginTop: 18 }}>
              <div className="upi-current">
                <div>
                  <strong>UPI ID (VPA)</strong>
                  {upi.vpa.trim() ? (
                    <p className="save-ok">{upi.vpa.trim()}</p>
                  ) : (
                    <p className="upi-none">
                      Not set — UPI shows as unavailable at checkout.
                    </p>
                  )}
                </div>
                <div className="action-pair keep-first">
                  <AppButton
                    onClick={() => {
                      setUpiDraft(upi.vpa)
                      setUpiDialog(true)
                    }}
                  >
                    {upi.vpa.trim() ? "Edit" : "Add UPI ID"}
                  </AppButton>
                  {upi.vpa.trim() && (
                    <AppButton
                      variant="secondary"
                      onClick={() => {
                        const next = { ...upi, vpa: "" }
                        saveUpi(next)
                        setUpi(next)
                        void cloudSetSetting("upi", next)
                      }}
                    >
                      Remove
                    </AppButton>
                  )}
                </div>
              </div>
              <label className="toggle-row">
                <span>
                  <strong>Show UPI at checkout</strong>
                  <small>
                    When off, UPI is hidden. When on, UPI is active if an ID is
                    saved, otherwise shown as unavailable (✗).
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={upi.enabled}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    const next = { ...upi, enabled }
                    setUpi(next)
                    saveUpi(next)
                    void cloudSetSetting("upi", next)
                  }}
                />
              </label>
            </div>
          </div>
        ) : page === "Transactions" ? (
          <TransactionsPage payments={payments} />
        ) : (
          <div className="placeholder-page">
            <span>
              <Icon
                name={
                  adminLinks.find(([label]) => label === page)?.[1] || "grid"
                }
                size={30}
              />
            </span>
            <p>{page.toUpperCase()}</p>
            <h2>Your {page.toLowerCase()} workspace is ready.</h2>
            <p>
              Use this area to manage day-to-day store operations with clear
              status and action history.
            </p>
            <AppButton variant="secondary" onClick={() => setPage("Dashboard")}>
              Return to dashboard
            </AppButton>
          </div>
        )}
      </main>

      {modal && (
        <ProductModal
          product={editing}
          onSave={(product) => {
            onSaveProduct(product)
            setModal(false)
            setEditing(null)
          }}
          onClose={() => {
            setModal(false)
            setEditing(null)
          }}
        />
      )}

      {upiDialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setUpiDialog(false)}
        >
          <section
            className="modal narrow"
            role="dialog"
            aria-modal="true"
            aria-label="Change UPI ID"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>PAYMENTS</p>
                <h2>{upi.vpa.trim() ? "Change UPI ID" : "Add UPI ID"}</h2>
              </div>
              <button onClick={() => setUpiDialog(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
            <div className="form-grid" style={{ padding: "0 22px 4px" }}>
              <label className="wide">
                UPI ID (VPA)
                <input
                  autoFocus
                  value={upiDraft}
                  placeholder="yourname@okhdfc"
                  onChange={(event) => setUpiDraft(event.target.value)}
                />
                <small>
                  Your bank UPI ID. Saving replaces the previous one.
                </small>
              </label>
            </div>
            <div className="modal-actions">
              <AppButton
                variant="ghost"
                type="button"
                onClick={() => setUpiDialog(false)}
              >
                Cancel
              </AppButton>
              <AppButton
                type="button"
                disabled={!upiDraft.trim()}
                onClick={() => {
                  const next = { ...upi, vpa: upiDraft.trim() }
                  setUpi(next)
                  saveUpi(next)
                  void cloudSetSetting("upi", next)
                  setUpiDialog(false)
                }}
              >
                Save
              </AppButton>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [mode, setModeState] = useState<"shop" | "admin">(() => {
    const saved = loadState<string>("greeno_mode", "shop")
    const savedSession = loadState<string | null>("greeno_session", null)
    if (
      saved === "admin" &&
      savedSession &&
      savedSession.toLowerCase() === ADMIN_USERNAME.toLowerCase()
    )
      return "admin"
    return "shop"
  })
  const setMode = (next: "shop" | "admin") => {
    setModeState(next)
    saveState("greeno_mode", next)
  }
  const [accounts, setAccounts] = useState<Account[]>(() =>
    loadState<Record<string, unknown>[]>("greeno_accounts", []).map((raw) => ({
      name: String(raw.name ?? ""),
      username: String(raw.username ?? raw.email ?? ""),
      password: String(raw.password ?? ""),
      phone: String(raw.phone ?? ""),
    })),
  )
  const [sessionUsername, setSessionUsername] = useState<string | null>(() =>
    loadState<string | null>("greeno_session", null),
  )
  const [orders, setOrders] = useState<Order[]>(() =>
    loadState<Record<string, unknown>[]>("greeno_orders", []).map((raw) => ({
      ...raw as unknown as Order,
      username: String(raw.username ?? raw.email ?? ""),
    })),
  )
  const [catalog, setCatalog] = useState<Product[]>(() => {
    const saved = loadState<Product[] | null>("greeno_catalog", null)
    return Array.isArray(saved) && saved.length ? saved : products
  })

  useEffect(() => saveState("greeno_accounts", accounts), [accounts])
  useEffect(
    () => saveState("greeno_session", sessionUsername),
    [sessionUsername],
  )
  useEffect(() => saveState("greeno_orders", orders), [orders])
  useEffect(() => saveState("greeno_catalog", catalog), [catalog])

  // Payment / transaction ledger (Flipkart-style). Stored locally and, when
  // cloud is on, mirrored to the payments table so the admin can review it.
  const [payments, setPayments] = useState<Payment[]>(() => loadPayments())
  useEffect(() => savePayments(payments), [payments])

  // Payment settings (Razorpay Key ID + UPI) are configured once by the admin
  // and shared to every device through the site_settings table — otherwise
  // other phones would only see "Cash on delivery".
  const [, setSettingsPulse] = useState(0)
  useEffect(() => {
    if (!isCloud) return
    void (async () => {
      const gw = await cloudGetSetting<{
        razorpayKeyId?: string
        enabled?: boolean
      }>("gateway")
      const upiCfg = await cloudGetSetting<{
        vpa?: string
        enabled?: boolean
      }>("upi")
      let changed = false
      if (gw) {
        // Apply even when the key was removed (empty) or payments were turned
        // off — those are deliberate admin states every phone must mirror.
        const nextGateway = {
          razorpayKeyId: String(gw.razorpayKeyId ?? "").trim(),
          enabled: gw.enabled !== false,
        }
        const localGateway = loadGateway()
        if (
          nextGateway.razorpayKeyId !== localGateway.razorpayKeyId.trim() ||
          nextGateway.enabled !== localGateway.enabled
        ) {
          saveGateway(nextGateway)
          changed = true
        }
      }
      if (upiCfg) {
        const localUpi = loadUpi()
        const nextUpi = {
          vpa: String(upiCfg.vpa ?? localUpi.vpa),
          enabled:
            upiCfg.enabled === undefined ? localUpi.enabled : !!upiCfg.enabled,
        }
        if (
          nextUpi.vpa !== localUpi.vpa ||
          nextUpi.enabled !== localUpi.enabled
        ) {
          saveUpi(nextUpi)
          changed = true
        }
      }
      if (changed) setSettingsPulse((n) => n + 1)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloud])

  const recordPayment = (payment: Payment) => {
    setPayments((current) => [payment, ...current])
    if (isCloud) void cloudInsertPayment(payment)
  }

  // Per-device fulfilment history (stage → timestamp) so the tracking timeline
  // can show times. Current status itself lives in the cloud and syncs live;
  // this is best-effort polish stored locally.
  const [orderHistory, setOrderHistory] =
    useState<Record<string, OrderStatusEvent[]>>(() =>
      loadState("greeno_order_history", {}),
    )
  useEffect(
    () => saveState("greeno_order_history", orderHistory),
    [orderHistory],
  )

  // Record status transitions whenever orders change (covers cloud hydrate +
  // realtime updates). Dedupes by stage so it never double-logs.
  useEffect(() => {
    setOrderHistory((prev) => {
      let changed = false
      const next = { ...prev }
      const now = new Date().toISOString()
      for (const order of orders) {
        const events = next[order.id] ?? []
        const has = (s: string) => events.some((e) => e.status === s)
        let list = events
        if (!has("Placed")) {
          list = [...list, { status: "Placed", at: order.placedAt }]
          changed = true
        }
        if (!has(order.status)) {
          list = [...list, { status: order.status, at: now }]
          changed = true
        }
        if (list !== events) next[order.id] = list
      }
      return changed ? next : prev
    })
  }, [orders])

  const updateOrderStatus = (id: string, status: OrderStatus) => {
    const at = new Date().toISOString()
    setOrders((current) =>
      current.map((order) => (order.id === id ? { ...order, status } : order)),
    )
    setOrderHistory((prev) => {
      const events = prev[id] ?? []
      const has = (s: string) => events.some((e) => e.status === s)
      let list = events
      for (let i = 0; i <= stageIndexOf(status); i += 1) {
        const stage = ORDER_STAGES[i]
        if (!has(stage)) list = [...list, { status: stage, at }]
      }
      return list === events ? prev : { ...prev, [id]: list }
    })
    if (isCloud) void cloudUpdateOrderStatus(id, status)
  }

  const ordersWithHistory = orders.map((order) => ({
    ...order,
    statusHistory: orderHistory[order.id] ?? order.statusHistory,
  }))

  // ---- Cloud sync (Supabase): hydrate + live realtime. No-op when not configured. ----
  // True once the cloud catalog has been fetched (or definitively unavailable)
  // — Shop only prunes stale cart ids after this, so a slow first fetch never
  // wipes items the bundled catalog doesn't know yet.
  const [catalogReady, setCatalogReady] = useState(!isCloud)
  useEffect(() => {
    if (!isCloud) return
    let active = true
    const bundled = products.map((p) => ({ ...p }))
    const hydrate = async () => {
      try {
        const [cloudProducts, cloudOrders] = await Promise.all([
          cloudListProducts(),
          cloudListOrders(),
        ])
        if (!active) return
        if (cloudProducts && cloudProducts.length) {
          setCatalog(cloudProducts as unknown as Product[])
        } else if (cloudProducts) {
          // Cloud reachable but empty — seed it from the bundled catalog once.
          await cloudSeedProducts(bundled)
          const seeded = await cloudListProducts()
          if (active && seeded?.length)
            setCatalog(seeded as unknown as Product[])
        }
        if (cloudOrders) setOrders(cloudOrders as unknown as Order[])
      } finally {
        if (active) setCatalogReady(true)
      }
    }
    hydrate()
    // Even if the network hangs, let the cart settle on the bundled catalog.
    const readyTimer = setTimeout(() => {
      if (active) setCatalogReady(true)
    }, 8000)
    const unsubscribe = cloudSubscribe(() => {
      void (async () => {
        const [cp, co] = await Promise.all([
          cloudListProducts(),
          cloudListOrders(),
        ])
        if (!active) return
        if (cp?.length) setCatalog(cp as unknown as Product[])
        if (co) setOrders(co as unknown as Order[])
      })()
    })
    return () => {
      active = false
      clearTimeout(readyTimer)
      unsubscribe()
    }
  }, [])

  const saveProduct = (product: Product) => {
    setCatalog((current) => {
      const next = (() => {
        if (product.id && current.some((item) => item.id === product.id))
          return current.map((item) =>
            item.id === product.id ? product : item,
          )
        const nextId =
          current.reduce((max, item) => Math.max(max, item.id), 0) + 1
        return [{ ...product, id: nextId }, ...current]
      })()
      const saved = next.find((item) => item.name === product.name) ?? next[0]
      if (isCloud) void cloudUpsertProduct(saved)
      return next
    })
  }

  const deleteProduct = (id: number) => {
    setCatalog((current) => current.filter((item) => item.id !== id))
    if (isCloud) void cloudDeleteProduct(id)
  }

  const user = useMemo(
    () =>
      accounts.find((account) => account.username === sessionUsername) ?? null,
    [accounts, sessionUsername],
  )
  const isAdmin =
    !!user && user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()

  // Seed the cloud catalog the first time an admin signs in (products writes
  // are admin-only under RLS, so seeding can't happen before login).
  useEffect(() => {
    if (!isCloud || !isAdmin) return
    let active = true
    void (async () => {
      const existing = await cloudListProducts()
      if (!active || (existing && existing.length)) return
      const bundled = products.map((p) => ({ ...p }))
      await cloudSeedProducts(bundled)
      const seeded = await cloudListProducts()
      if (active && seeded?.length) setCatalog(seeded as unknown as Product[])
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Keep a local mirror of the signed-in account so the `user` memo + offline
  // cache keep working even when auth lives in the cloud.
  const mirrorAccount = (account: Account) =>
    setAccounts((current) => {
      const index = current.findIndex(
        (item) =>
          item.username.toLowerCase() === account.username.toLowerCase(),
      )
      if (index >= 0) {
        const next = [...current]
        next[index] = { ...next[index], ...account }
        return next
      }
      return [...current, account]
    })

  // Restore Supabase session on load (cross-device login persistence).
  useEffect(() => {
    if (!isCloud) return
    let active = true
    void (async () => {
      const { cloudCurrentUsername, cloudFetchProfile, cloudUserId } =
        await import("./lib/cloud")
      const username = await cloudCurrentUsername()
      if (!active || !username) return
      const userId = await cloudUserId()
      const profile = userId ? await cloudFetchProfile(userId) : null
      mirrorAccount({
        name: profile?.name || username,
        username,
        password: "",
        phone: profile?.phone || "",
      })
      setSessionUsername(username)
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = async (
    username: string,
    password: string,
  ): Promise<string | null> => {
    const normalized = username.trim().toLowerCase()
    if (isCloud) {
      const { error, username: cloudUser } = await cloudSignIn(
        username,
        password,
      )
      if (error) return error
      const resolved = cloudUser ?? username.trim()
      const userId = await import("./lib/cloud").then((m) => m.cloudUserId())
      const profile = userId
        ? await import("./lib/cloud").then((m) => m.cloudFetchProfile(userId))
        : null
      mirrorAccount({
        name: profile?.name || resolved,
        username: resolved,
        password: "",
        phone: profile?.phone || "",
      })
      setSessionUsername(resolved)
      return null
    }
    if (
      normalized === ADMIN_USERNAME.toLowerCase() &&
      password === ADMIN_PASSWORD
    ) {
      const existing = accounts.find(
        (account) => account.username.toLowerCase() === normalized,
      )
      if (!existing) {
        setAccounts((current) => [
          ...current,
          {
            name: ADMIN_USERNAME,
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD,
            phone: "",
          },
        ])
      }
      setSessionUsername(ADMIN_USERNAME)
      return null
    }
    const found = accounts.find(
      (account) => account.username.toLowerCase() === normalized,
    )
    if (!found) return "No account found with this username. Create one first."
    if (found.password !== password) return "Incorrect password. Try again."
    setSessionUsername(found.username)
    return null
  }

  const createAccount = async (
    name: string,
    username: string,
    password: string,
  ): Promise<string | null> => {
    const trimmedName = name.trim()
    const trimmedUsername = username.trim()
    const normalized = trimmedUsername.toLowerCase()
    if (!trimmedName) return "Please enter your full name."
    if (!trimmedUsername) return "Please choose a username."
    if (normalized === ADMIN_USERNAME.toLowerCase())
      return "This username is reserved. Please choose another one."
    if (password.length < 6)
      return "Password must be at least 6 characters for cloud sync."
    if (isCloud) {
      const problem = await cloudSignUp(trimmedUsername, trimmedName, password)
      if (problem) return problem
      // Supabase may require email confirmation; if a session came back, use it.
      const cloudUser = await import("./lib/cloud").then((m) =>
        m.cloudCurrentUsername(),
      )
      mirrorAccount({
        name: trimmedName,
        username: trimmedUsername,
        password: "",
        phone: "",
      })
      setSessionUsername(cloudUser ?? trimmedUsername)
      return null
    }
    if (
      accounts.some((account) => account.username.toLowerCase() === normalized)
    )
      return "This username already exists. Please choose another one."
    const account: Account = {
      name: trimmedName,
      username: trimmedUsername,
      password,
      phone: "",
    }
    setAccounts((current) => [...current, account])
    setSessionUsername(account.username)
    return null
  }

  const updateProfile = async (
    name: string,
    phone: string,
  ): Promise<string | null> => {
    if (!user) return "Please sign in again."
    const trimmedName = name.trim()
    if (!trimmedName) return "Name cannot be empty."
    if (isCloud) {
      const problem = await cloudUpdateProfile(trimmedName, phone.trim())
      if (problem) return problem
    }
    setAccounts((current) =>
      current.map((account) =>
        account.username === user.username
          ? { ...account, name: trimmedName, phone: phone.trim() }
          : account,
      ),
    )
    return null
  }

  const updatePassword = async (
    current: string,
    next: string,
  ): Promise<string | null> => {
    if (!user) return "Please sign in again."
    if (next.length < 4) return "New password needs at least 4 characters."
    if (isCloud) {
      // Supabase manages the credential; verify the old one via a throwaway sign-in.
      const check = await cloudSignIn(user.username, current)
      if (check.error) return "Current password is incorrect."
      const problem = await cloudUpdatePassword(next)
      if (problem) return problem
      await cloudSignIn(user.username, next)
      return null
    }
    if (user.password !== current) return "Current password is incorrect."
    setAccounts((accountsList) =>
      accountsList.map((account) =>
        account.username === user.username
          ? { ...account, password: next }
          : account,
      ),
    )
    return null
  }

  const deleteAccount = async () => {
    if (!user) return
    setAccounts((current) =>
      current.filter((account) => account.username !== user.username),
    )
    setOrders((current) =>
      current.filter((order) => order.username !== user.username),
    )
    if (isCloud) await cloudSignOut()
    setSessionUsername(null)
    setMode("shop")
  }

  if (mode === "admin" && isAdmin) {
    return (
      <Admin
        switchMode={() => setMode("shop")}
        accounts={accounts}
        orders={ordersWithHistory}
        catalog={catalog}
        payments={payments}
        onSaveProduct={saveProduct}
        onDeleteProduct={deleteProduct}
        onUpdateOrderStatus={updateOrderStatus}
      />
    )
  }

  return (
    <Shop
      user={user}
      orders={ordersWithHistory}
      payments={payments}
      catalog={catalog}
      catalogReady={catalogReady}
      isAdmin={isAdmin}
      onOpenAdmin={() => setMode("admin")}
      signIn={signIn}
      createAccount={createAccount}
      onUpdateProfile={updateProfile}
      onUpdatePassword={updatePassword}
      onDeleteAccount={deleteAccount}
      onSignOut={async () => {
        if (isCloud) await cloudSignOut()
        setSessionUsername(null)
        setMode("shop")
      }}
      onPlaceOrder={(order) => {
        setOrders((current) => [order, ...current])
        if (isCloud) {
          void cloudInsertOrder({
            id: order.id,
            userId: null,
            customer: order.customer,
            username: order.username,
            items: order.items,
            subtotal: order.subtotal,
            delivery: order.delivery,
            discount: order.discount,
            total: order.total,
            address: order.address,
            payment: order.payment,
            placedAt: order.placedAt,
            status: order.status,
            lat: order.lat,
            lng: order.lng,
          })
        }
      }}
      onRecordPayment={recordPayment}
    />
  )
}
