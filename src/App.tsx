import { useMemo, useState } from "react"

type IconName = "home" | "grid" | "tag" | "cart" | "user" | "search" | "map" | "bell" | "chevron" | "arrow" | "plus" | "minus" | "check" | "package" | "orders" | "users" | "settings" | "menu" | "close" | "edit" | "trash" | "trend" | "alert"

function Icon({ name, size = 20 }: { name: IconName size?: number }) {
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

const productImages = [
  "https://images.unsplash.com/photo-1645331465778-eb409d112198?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1552592074-ea7a91b851b3?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1595275522477-c3ce3ca9714b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1696762314476-07470ad680bc?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1641693148759-843d17ceac24?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1615897570582-285ffe259530?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1614907634002-65ac4cb74acb?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1643107303813-077f2061cec1?auto=format&fit=crop&w=800&q=80",
]

const products = [
  {
    id: 1,
    name: "Premium Basmati Rice",
    unit: "5 kg bag",
    price: 14.49,
    old: 16.99,
    discount: "15% OFF",
    image: productImages[0],
    category: "Rice & Grains",
    stock: 48,
    sku: "RIC-1024",
  },
  {
    id: 2,
    name: "Sunflower Cooking Oil",
    unit: "1 L bottle",
    price: 5.49,
    old: 6.25,
    discount: "12% OFF",
    image: productImages[1],
    category: "Cooking Essentials",
    stock: 36,
    sku: "OIL-2082",
  },
  {
    id: 3,
    name: "Whole Milk",
    unit: "1 L carton",
    price: 2.45,
    old: 2.75,
    discount: "11% OFF",
    image: productImages[2],
    category: "Dairy & Eggs",
    stock: 64,
    sku: "DRY-3048",
  },
  {
    id: 4,
    name: "Farmhouse Brown Eggs",
    unit: "12 eggs",
    price: 4.8,
    old: 5.5,
    discount: "13% OFF",
    image: productImages[3],
    category: "Dairy & Eggs",
    stock: 42,
    sku: "EGG-4012",
  },
  {
    id: 5,
    name: "Sea Salt Potato Chips",
    unit: "150 g pack",
    price: 2.25,
    old: 2.75,
    discount: "18% OFF",
    image: productImages[4],
    category: "Snacks",
    stock: 72,
    sku: "SNK-5042",
  },
  {
    id: 6,
    name: "Classic Tomato Ketchup",
    unit: "500 ml bottle",
    price: 3.75,
    old: 4.25,
    discount: "12% OFF",
    image: productImages[5],
    category: "Sauces & Spreads",
    stock: 55,
    sku: "SCE-6055",
  },
  {
    id: 7,
    name: "Everyday Wheat Flour",
    unit: "2 kg bag",
    price: 5.2,
    old: 5.9,
    discount: "12% OFF",
    image: productImages[6],
    category: "Baking & Flour",
    stock: 40,
    sku: "FLR-7040",
  },
  {
    id: 8,
    name: "Fresh Linen Detergent",
    unit: "2 L bottle",
    price: 9.9,
    old: 11.5,
    discount: "14% OFF",
    image: productImages[7],
    category: "Household",
    stock: 28,
    sku: "HOU-8028",
  },
]

const categories = [
  "All",
  "Rice & Grains",
  "Cooking Essentials",
  "Dairy & Eggs",
  "Snacks",
  "Baking & Flour",
  "Household",
]

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
      <strong>Greeno</strong>
    </div>
  )
}

function ModeSwitch({
  mode,
  setMode,
}: {
  mode: "shop" | "admin"
  setMode: (mode: "shop" | "admin") => void
}) {
  return (
    <div className="mode-switch" aria-label="Switch app view">
      <button
        className={mode === "shop" ? "active" : ""}
        onClick={() => setMode("shop")}
      >
        Storefront
      </button>
      <button
        className={mode === "admin" ? "active" : ""}
        onClick={() => setMode("admin")}
      >
        Admin
      </button>
    </div>
  )
}

function ProductCard({
  product,
  quantity,
  onAdd,
  onOpen,
}: {
  product: typeof products[number]
  quantity: number
  onAdd: (id: number, delta: number) => void
  onOpen: () => void
}) {
  return (
    <article className="product-card">
      <button
        className="product-image"
        onClick={onOpen}
        aria-label={`View ${product.name}`}
      >
        <img src={product.image} alt={product.name} />
        <span className="discount">{product.discount}</span>
        <span className="heart" aria-hidden="true">
          ♡
        </span>
      </button>
      <div className="product-body">
        <button className="product-title" onClick={onOpen}>
          {product.name}
        </button>
        <p>{product.unit}</p>
        <div className="price-row">
          <div>
            <strong>${product.price.toFixed(2)}</strong>
            <del>${product.old.toFixed(2)}</del>
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

function Shop({ switchMode }: { switchMode: () => void }) {
  const [tab, setTab] = useState("Home")
  const [category, setCategory] = useState("All")
  const [cart, setCart] = useState<Record<number, number>>({})
  const [selected, setSelected] = useState<typeof products[number] | null>(null)
  const [search, setSearch] = useState("")
  const [promo, setPromo] = useState(false)

  const count = Object.values(cart).reduce((a, b) => a + b, 0)
  const subtotal = products.reduce(
    (total, product) => total + product.price * (cart[product.id] || 0),
    0,
  )
  const filtered = products.filter(
    (product) =>
      (category === "All" || product.category === category) &&
      product.name.toLowerCase().includes(search.toLowerCase()),
  )
  const changeQuantity = (id: number, delta: number) =>
    setCart((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] || 0) + delta),
    }))

  if (selected) {
    return (
      <div className="shop-shell">
        <header className="shop-header compact">
          <Brand />
          <AppButton variant="ghost" onClick={() => setSelected(null)}>
            Back to shop
          </AppButton>
        </header>
        <main className="detail-page">
          <div className="detail-image">
            <img src={selected.image} alt={selected.name} />
            <span className="discount">{selected.discount}</span>
          </div>
          <div className="detail-copy">
            <button className="eyebrow" onClick={() => setSelected(null)}>
              {selected.category}
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
              <strong>${selected.price.toFixed(2)}</strong>
              <del>${selected.old.toFixed(2)}</del>
              <span>
                You save ${(selected.old - selected.price).toFixed(2)}
              </span>
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
                <Icon name="cart" /> Add to cart · ${selected.price.toFixed(2)}
              </AppButton>
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
            placeholder="Search for products, brands and more"
          />
        </div>
        <div className="header-actions">
          <ModeSwitch
            mode="shop"
            setMode={(mode) => mode === "admin" && switchMode()}
          />
          <button className="icon-btn" aria-label="Notifications">
            <Icon name="bell" />
          </button>
          <button className="cart-btn" onClick={() => setTab("Cart")}>
            <Icon name="cart" />
            <span>My cart</span>
            {count > 0 && <b>{count}</b>}
          </button>
        </div>
      </header>

      <main>
        {tab === "Home" || tab === "Categories" || tab === "Offers" ? (
          <>
            <section className="mobile-welcome">
              <div>
                <p>Welcome to Greeno</p>
                <h1>What are we getting today?</h1>
              </div>
              <button className="avatar">GS</button>
              <div className="mobile-search">
                <Icon name="search" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search groceries"
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
                <small>Free delivery on orders over $30</small>
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
                <AppButton variant="ghost">
                  View all <Icon name="chevron" />
                </AppButton>
              </div>
              <div className="category-row">
                {categories.map((item) => (
                  <button
                    key={item}
                    onClick={() => setCategory(item)}
                    className={category === item ? "active" : ""}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="section-heading deals">
                <div>
                  <p>THIS WEEK’S PICKS</p>
                  <h2>
                    {tab === "Offers"
                      ? "Offers worth adding"
                      : "Grocery deals for you"}
                  </h2>
                </div>
                <span>Updated this morning</span>
              </div>
              {filtered.length ? (
                <div className="product-grid">
                  {filtered.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={cart[product.id] || 0}
                      onAdd={changeQuantity}
                      onOpen={() => setSelected(product)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Icon name="search" size={28} />
                  <h3>No products found</h3>
                  <p>Try another search or category.</p>
                  <AppButton
                    variant="secondary"
                    onClick={() => {
                      setSearch("")
                      setCategory("All")
                    }}
                  >
                    Clear filters
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
                      <img src={product.image} alt={product.name} />
                      <div>
                        <h3>{product.name}</h3>
                        <p>{product.unit}</p>
                        <strong>${product.price.toFixed(2)}</strong>
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
                    <dd>${subtotal.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>{subtotal > 30 ? "Free" : "$3.99"}</dd>
                  </div>
                  <div>
                    <dt>Savings</dt>
                    <dd className="saving">
                      -${(promo ? subtotal * 0.1 : 0).toFixed(2)}
                    </dd>
                  </div>
                  <div className="total">
                    <dt>Total</dt>
                    <dd>
                      $
                      {(
                        subtotal * (promo ? 0.9 : 1) +
                        (subtotal > 30 ? 0 : 3.99)
                      ).toFixed(2)}
                    </dd>
                  </div>
                </dl>
                <AppButton className="full" disabled={count === 0}>
                  Continue to checkout <Icon name="arrow" />
                </AppButton>
                <small>
                  Secure checkout · Easy returns · Quality guaranteed
                </small>
              </aside>
            </div>
          </section>
        ) : (
          <section className="account-page">
            <div className="account-card">
              <div className="account-avatar">
                <Icon name="user" />
              </div>
              <p>YOUR ACCOUNT</p>
              <h1>Start shopping with Greeno</h1>
              <span>Sign in to save addresses and track future orders.</span>
              <AppButton variant="secondary">Sign in or create account</AppButton>
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
            onClick={() => setTab(label)}
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
        <button onClick={switchMode}>Open store administration</button>
      </footer>
    </div>
  )
}

const adminLinks: [string, IconName][] = [
  ["Dashboard", "home"],
  ["Inventory", "package"],
  ["Orders", "orders"],
  ["Offers", "tag"],
  ["Customers", "users"],
  ["Settings", "settings"],
]

function Admin({ switchMode }: { switchMode: () => void }) {
  const [page, setPage] = useState("Dashboard")
  const [modal, setModal] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [query, setQuery] = useState("")
  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.name.toLowerCase().includes(query.toLowerCase()) ||
          product.sku.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  )

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
          <span>AD</span>
          <div>
            <strong>Alex Doran</strong>
            <small>Store manager</small>
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
            <p>MONDAY, MAY 26</p>
            <h1>{page}</h1>
          </div>
          <div className="admin-head-actions">
            <div className="admin-search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, orders..."
              />
            </div>
            <ModeSwitch
              mode="admin"
              setMode={(mode) => mode === "shop" && switchMode()}
            />
            <button className="icon-btn">
              <Icon name="bell" />
            </button>
          </div>
        </header>

        {page === "Dashboard" ? (
          <div className="dashboard">
            <section className="welcome-row">
              <div>
                <h2>Good morning, Alex.</h2>
                <p>Your new store is ready. Add products and share it to begin.</p>
              </div>
              <AppButton onClick={() => setModal(true)}>
                <Icon name="plus" /> Add new product
              </AppButton>
            </section>
            <section className="stats-grid">
              <article>
                <span className="stat-icon green">
                  <Icon name="trend" />
                </span>
                <p>Gross sales</p>
                <h3>$0.00</h3>
                <em>No sales yet</em>
              </article>
              <article>
                <span className="stat-icon amber">
                  <Icon name="orders" />
                </span>
                <p>Total orders</p>
                <h3>0</h3>
                <em>No orders yet</em>
              </article>
              <article>
                <span className="stat-icon blue">
                  <Icon name="users" />
                </span>
                <p>New customers</p>
                <h3>0</h3>
                <em>No customers yet</em>
              </article>
              <article>
                <span className="stat-icon red">
                  <Icon name="alert" />
                </span>
                <p>Low stock items</p>
                <h3>0</h3>
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
                  <strong>$0.00</strong>
                  <span>Sales will appear here</span>
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
                <div className="empty">
                  <Icon name="orders" size={26} />
                  <h3>No orders yet</h3>
                  <p>New customer orders will appear here.</p>
                </div>
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
                <AppButton onClick={() => setModal(true)}>
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
              <select>
                <option>All categories</option>
                <option>Rice & Grains</option>
                <option>Cooking Essentials</option>
                <option>Dairy & Eggs</option>
                <option>Snacks</option>
                <option>Baking & Flour</option>
                <option>Household</option>
              </select>
              <select>
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
                          <img src={product.image} alt="" />
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
                        <del>${product.old.toFixed(2)}</del>
                      </td>
                      <td>
                        <strong>${product.price.toFixed(2)}</strong>
                      </td>
                      <td>
                        <span className="active-pill">
                          <i /> Active
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            onClick={() => setModal(true)}
                            aria-label="Edit product"
                          >
                            <Icon name="edit" size={17} />
                          </button>
                          <button aria-label="Delete product">
                            <Icon name="trash" size={17} />
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
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setModal(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit product"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p>PRODUCT CATALOG</p>
                <h2>Add a new product</h2>
                <span>Keep product details clear and inventory accurate.</span>
              </div>
              <button onClick={() => setModal(false)}>
                <Icon name="close" />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setModal(false)
              }}
            >
              <div className="upload">
                <Icon name="plus" />
                <strong>Upload product image</strong>
                <span>PNG or JPG up to 5 MB</span>
              </div>
              <div className="form-grid">
                <label className="wide">
                  Product title
                  <input required placeholder="e.g. Organic Fuji Apples" />
                </label>
                <label>
                  Category
                  <select defaultValue="">
                    <option value="" disabled>
                      Select category
                    </option>
                    <option>Rice & Grains</option>
                    <option>Cooking Essentials</option>
                    <option>Dairy & Eggs</option>
                    <option>Snacks</option>
                    <option>Baking & Flour</option>
                    <option>Household</option>
                  </select>
                </label>
                <label>
                  SKU
                  <input required placeholder="e.g. FRT-1024" />
                </label>
                <label>
                  Regular price ($)
                  <input type="number" placeholder="0.00" min="0" />
                </label>
                <label>
                  Discount (%)
                  <input type="number" placeholder="0" min="0" max="100" />
                </label>
                <label>
                  Stock quantity
                  <input type="number" placeholder="0" min="0" />
                </label>
                <label>
                  Unit
                  <select>
                    <option>per item</option>
                    <option>500 g</option>
                    <option>1 kg</option>
                  </select>
                </label>
              </div>
              <label className="toggle-line">
                <span>
                  <strong>Feature as a flash offer</strong>
                  <small>Show this product in active promotions</small>
                </span>
                <input type="checkbox" />
              </label>
              <div className="modal-actions">
                <AppButton variant="ghost" onClick={() => setModal(false)}>
                  Cancel
                </AppButton>
                <AppButton type="submit">
                  <Icon name="check" /> Save & publish
                </AppButton>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState<"shop" | "admin">("shop")
  return mode === "shop" ? (
    <Shop switchMode={() => setMode("admin")} />
  ) : (
    <Admin switchMode={() => setMode("shop")} />
  )
}
