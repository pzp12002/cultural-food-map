import type { Review, ReviewDraft, Shop } from '../types'

const STORAGE_KEY = 'cultural-food-map-reviews-v1'
const SAVED_SHOPS_STORAGE_KEY = 'cultural-food-map-reviewed-shops-v1'
const LOCAL_DATA_ENDPOINT = '/api/local-data'
const STATIC_DATA_ENDPOINT = `${import.meta.env.BASE_URL}data/user-data.json`
const LEGACY_DEMO_SHOP_IDS = new Set([
  'yu-garden-kitchen',
  'wutong-noodle-house',
  'riverside-canteen',
  'southwind-dim-sum',
])
const MAX_IMAGE_EDGE = 1_400
const IMAGE_QUALITY = 0.8

export interface PersistedLocalData {
  reviews: Review[]
  savedShops: Shop[]
  updatedAt: string | null
}

export function loadLocalReviews(): Review[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Review[]
    if (!Array.isArray(parsed)) return []
    const reviews = parsed
      .filter(isReview)
      .filter((review) => !LEGACY_DEMO_SHOP_IDS.has(review.shopId))
      .map((review) => ({ ...review, photos: review.photos.map(resolveAssetPath) }))
    if (reviews.length !== parsed.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews))
    }
    return reviews
  } catch {
    return []
  }
}

export function createLocalReview(shopId: string, draft: ReviewDraft): Review {
  return {
    id: crypto.randomUUID(),
    shopId,
    author: draft.author.trim() || '访客',
    rating: draft.rating,
    content: draft.content.trim(),
    photos: draft.photos,
    createdAt: new Date().toISOString(),
    isLocal: true,
  }
}

export function saveLocalReviews(reviews: Review[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews))
  } catch {
    throw new Error('本地空间不足，请减少照片数量或选择尺寸更小的照片。')
  }
}

export function saveLocalShops(shops: Shop[]): void {
  try {
    window.localStorage.setItem(SAVED_SHOPS_STORAGE_KEY, JSON.stringify(shops))
  } catch {
    throw new Error('商铺资料本地备份失败，请检查浏览器空间。')
  }
}

export function loadSavedShops(): Shop[] {
  try {
    const raw = window.localStorage.getItem(SAVED_SHOPS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Shop[]
    return Array.isArray(parsed)
      ? parsed.filter(isSavedShop).map((shop) => ({ ...shop, gallery: shop.gallery.map(resolveAssetPath) }))
      : []
  } catch {
    return []
  }
}

export function saveReviewedShop(shop: Shop): Shop[] {
  if (shop.source !== 'amap') return loadSavedShops()
  const nextShops = [
    ...loadSavedShops().filter((savedShop) => savedShop.id !== shop.id),
    sanitizeShop(shop),
  ]
  saveLocalShops(nextShops)
  return nextShops
}

export async function loadPersistedLocalData(): Promise<PersistedLocalData> {
  try {
    const response = await fetch(LOCAL_DATA_ENDPOINT, { cache: 'no-store' })
    if (response.ok) return parsePersistedLocalData(await response.json())
  } catch {
    // GitHub Pages has no Vite middleware; use the build-time data snapshot below.
  }

  const response = await fetch(STATIC_DATA_ENDPOINT, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readResponseError(response, '本地数据文件读取失败。'))
  return parsePersistedLocalData(await response.json())
}

export async function persistLocalData(
  reviews: Review[],
  savedShops: Shop[],
): Promise<PersistedLocalData> {
  const response = await fetch(LOCAL_DATA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviews, savedShops }),
  })
  if (!response.ok) throw new Error(await readResponseError(response, '本地数据文件写入失败。'))
  return parsePersistedLocalData(await response.json())
}

export async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('只能添加图片文件。')
  }

  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(sourceUrl)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理这张照片。')
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/webp', IMAGE_QUALITY)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('照片读取失败，请重新选择。'))
    image.src = src
  })
}

function isReview(value: unknown): value is Review {
  if (!value || typeof value !== 'object') return false
  const review = value as Partial<Review>
  return (
    typeof review.id === 'string' &&
    typeof review.shopId === 'string' &&
    typeof review.author === 'string' &&
    typeof review.rating === 'number' &&
    typeof review.content === 'string' &&
    Array.isArray(review.photos) &&
    typeof review.createdAt === 'string'
  )
}

function isSavedShop(value: unknown): value is Shop {
  if (!value || typeof value !== 'object') return false
  const shop = value as Partial<Shop>
  return (
    (shop.source === 'amap' || shop.source === 'curated') &&
    typeof shop.id === 'string' &&
    typeof shop.amapId === 'string' &&
    typeof shop.name === 'string' &&
    typeof shop.category === 'string' &&
    typeof shop.longitude === 'number' &&
    Number.isFinite(shop.longitude) &&
    typeof shop.latitude === 'number' &&
    Number.isFinite(shop.latitude) &&
    typeof shop.address === 'string' &&
    typeof shop.summary === 'string' &&
    Array.isArray(shop.signatureDishes) &&
    typeof shop.businessHours === 'string' &&
    (shop.averagePrice === null || typeof shop.averagePrice === 'number') &&
    Array.isArray(shop.gallery) &&
    shop.gallery.every((photo) => typeof photo === 'string')
  )
}

function sanitizeShop(shop: Shop): Shop {
  return {
    id: shop.id,
    source: 'amap',
    amapId: shop.amapId,
    name: shop.name,
    category: shop.category,
    longitude: shop.longitude,
    latitude: shop.latitude,
    address: shop.address,
    summary: shop.summary,
    signatureDishes: shop.signatureDishes,
    businessHours: shop.businessHours,
    averagePrice: shop.averagePrice,
    sourceRating: shop.sourceRating,
    distanceMeters: shop.distanceMeters,
    telephone: shop.telephone,
    gallery: shop.gallery.slice(0, 6),
  }
}

function parsePersistedLocalData(value: unknown): PersistedLocalData {
  if (!value || typeof value !== 'object') throw new Error('本地数据文件格式无效。')
  const data = value as { reviews?: unknown; savedShops?: unknown; updatedAt?: unknown }
  if (!Array.isArray(data.reviews) || !Array.isArray(data.savedShops)) {
    throw new Error('本地数据文件字段不完整。')
  }
  return {
    reviews: data.reviews
      .filter(isReview)
      .map((review) => ({ ...review, photos: review.photos.map(resolveAssetPath) })),
    savedShops: data.savedShops
      .filter(isSavedShop)
      .map((shop) => ({ ...shop, gallery: shop.gallery.map(resolveAssetPath) })),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  }
}

function resolveAssetPath(path: string): string {
  if (!path.startsWith('/uploads/') && !path.startsWith('/images/')) return path
  if (import.meta.env.BASE_URL === '/') return path
  if (path.startsWith(import.meta.env.BASE_URL)) return path
  return `${import.meta.env.BASE_URL}${path.slice(1)}`
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    return typeof body.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}
