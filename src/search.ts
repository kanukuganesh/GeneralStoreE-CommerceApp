import { products } from "./catalog"
import type { Product } from "./catalog"

const SYNONYMS: Record<string, string> = {
  anda: "egg",
  ande: "egg",
  chawal: "rice",
  atta: "flour",
  maida: "flour",
  cheeni: "sugar",
  chini: "sugar",
  namak: "salt",
  tel: "oil",
  doodh: "milk",
  dudh: "milk",
  dahi: "yogurt",
  paneer: "cottage cheese",
  ghee: "butter",
  chai: "tea",
  chah: "tea",
  mirch: "pepper",
  mirchi: "pepper",
  seb: "apple",
  kela: "banana",
  tamatar: "tomato",
  pyaz: "onion",
  aloo: "potato",
  gajar: "carrot",
  nimbu: "lemon",
  lahsun: "garlic",
  kheera: "cucumber",
  roti: "bread",
  pani: "water",
  biscuit: "cookie",
  noodles: "pasta",
  icecream: "ice cream",
  soda: "soft drink",
  pop: "soft drink",
  coke: "soft drink",
  coldrink: "soft drink",
  "cold drink": "soft drink",
  fries: "french fries",
  brekkie: "breakfast",
}

const USE_CASES: Record<string, string[]> = {
  breakfast: [
    "milk",
    "egg",
    "cereal",
    "bread",
    "tea",
    "coffee",
    "yogurt",
    "oats",
    "juice",
    "butter",
    "croissant",
    "granola",
  ],
  snacks: [
    "chips",
    "popcorn",
    "chocolate",
    "cookie",
    "cracker",
    "candy",
    "pretzel",
    "almond",
    "cashew",
  ],
  baking: ["flour", "sugar", "oats", "cookie", "cinnamon"],
  cleaning: ["detergent", "soap", "cleaner", "sponge", "towel", "paper"],
  bbq: ["chicken", "steak", "sausage", "corn", "beef"],
  lunch: ["rice", "pasta", "chicken", "bread", "salad", "egg"],
  dinner: ["chicken", "beef", "salmon", "rice", "pasta", "pizza", "pork"],
}

function normalize(value: string) {
  return value.toLowerCase().trim()
}

function wordsOf(value: string) {
  return value.split(/[^a-z0-9]+/).filter(Boolean)
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      diag = prev[j]
      prev[j] = next
    }
  }
  return prev[b.length]
}

function termScore(product: Product, term: string) {
  if (!term) return 0
  const name = normalize(product.name)
  const words = wordsOf(name)
  const nameKey = name.replace(/[^a-z0-9]/g, "")
  const category = normalize(product.category)
  const sku = normalize(product.sku)
  let best = 0

  if (name === term) best = Math.max(best, 100)
  if (name.startsWith(term)) best = Math.max(best, 85)
  if (words.includes(term)) best = Math.max(best, 75)
  if (words.some((word) => word.startsWith(term))) best = Math.max(best, 70)
  if (name.includes(term)) best = Math.max(best, 55)
  if (sku.includes(term)) best = Math.max(best, 50)
  if (category.includes(term)) best = Math.max(best, 45)

  const related = USE_CASES[term]
  if (
    related &&
    related.some(
      (t) => name.includes(t) || words.some((word) => word.startsWith(t)),
    )
  ) {
    best = Math.max(best, 40)
  }

  if (term.length >= 4) {
    const tolerance = term.length >= 6 ? 2 : 1
    if (
      words.some(
        (word) =>
          Math.abs(word.length - term.length) <= 2 &&
          levenshtein(word, term) <= tolerance,
      ) ||
      (Math.abs(nameKey.length - term.length) <= 2 &&
        levenshtein(nameKey, term) <= tolerance)
    ) {
      best = Math.max(best, 28)
    }
  }

  return best
}

function expansions(term: string) {
  const list = [term]
  const synonym = SYNONYMS[term]
  if (synonym) list.push(synonym)
  if (USE_CASES[term]) list.push(...USE_CASES[term])
  return list
}

export function scoreProduct(product: Product, query: string) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return 0
  let total = 0
  let allInName = true
  for (const token of tokens) {
    let best = 0
    for (const term of expansions(token)) {
      best = Math.max(best, termScore(product, term))
    }
    if (!best) return 0
    if (best < 55) allInName = false
    total += best
  }
  return total + (allInName ? 10 : 0)
}

export function searchProducts(
  query: string,
  list: Product[] = products,
): Product[] {
  const normalized = normalize(query)
  if (!normalized) return list

  let scored = list
    .map((product) => ({ product, score: scoreProduct(product, normalized) }))
    .filter((entry) => entry.score > 0)

  if (!scored.length) {
    scored = list
      .map((product) => ({
        product,
        score: Math.max(
          ...normalized
            .split(/\s+/)
            .filter(Boolean)
            .map((token) => scoreProduct(product, token)),
        ),
      }))
      .filter((entry) => entry.score > 0)
  }

  scored.sort(
    (a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name),
  )
  return scored.map((entry) => entry.product)
}
