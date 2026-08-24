import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const API_PATH = '/api/local-data'
const MAX_BODY_BYTES = 50 * 1024 * 1024
const DATA_DIRECTORY = resolve(process.cwd(), 'data')
const DATA_FILE = resolve(DATA_DIRECTORY, 'user-data.json')
const UPLOAD_DIRECTORY = resolve(process.cwd(), 'public', 'uploads')
const DELETED_UPLOAD_DIRECTORY = resolve(DATA_DIRECTORY, 'deleted-uploads')

interface LocalDataFile {
  version: 1
  updatedAt: string | null
  reviews: StoredReview[]
  savedShops: StoredShop[]
}

interface StoredReview {
  id: string
  shopId: string
  author: string
  rating: number
  content: string
  photos: string[]
  createdAt: string
  isLocal?: boolean
}

interface StoredShop {
  id: string
  source: 'amap' | 'curated'
  amapId: string
  name: string
  category: string
  longitude: number
  latitude: number
  address: string
  summary: string
  signatureDishes: string[]
  businessHours: string
  averagePrice: number | null
  sourceRating?: number
  distanceMeters?: number
  telephone?: string
  gallery: string[]
}

export function localDataPlugin(): Plugin {
  return {
    name: 'micro-food-map-local-data',
    configureServer(server) {
      server.middlewares.use(handleLocalDataRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleLocalDataRequest)
    },
    async generateBundle() {
      try {
        const source = await readFile(DATA_FILE, 'utf8')
        this.emitFile({
          type: 'asset',
          fileName: 'data/user-data.json',
          source,
        })
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    },
  }
}

function handleLocalDataRequest(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (pathname !== API_PATH) {
    next()
    return
  }

  void processLocalDataRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '本地数据保存失败。'
    sendJson(response, 500, { error: message })
  })
}

async function processLocalDataRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method === 'GET') {
    sendJson(response, 200, await readLocalData())
    return
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request)
    const reviews = readReviews(body.reviews)
    const savedShops = readSavedShops(body.savedShops)
    const previousData = await readLocalData()
    const persistedReviews = await persistReviewPhotos(reviews)
    const data: LocalDataFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      reviews: persistedReviews,
      savedShops,
    }
    await writeLocalData(data)
    await archiveRemovedPhotos(previousData.reviews, persistedReviews)
    sendJson(response, 200, data)
    return
  }

  response.setHeader('Allow', 'GET, POST')
  sendJson(response, 405, { error: '不支持该请求方法。' })
}

async function readLocalData(): Promise<LocalDataFile> {
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      reviews: readReviews(parsed.reviews),
      savedShops: readSavedShops(parsed.savedShops),
    }
  } catch (error) {
    if (isMissingFileError(error)) return emptyLocalData()
    throw error
  }
}

async function writeLocalData(data: LocalDataFile) {
  await mkdir(DATA_DIRECTORY, { recursive: true })
  const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, DATA_FILE)
}

async function persistReviewPhotos(reviews: StoredReview[]): Promise<StoredReview[]> {
  await mkdir(UPLOAD_DIRECTORY, { recursive: true })
  return Promise.all(
    reviews.map(async (review) => ({
      ...review,
      photos: await Promise.all(review.photos.map(persistDataUrl)),
    })),
  )
}

async function persistDataUrl(photo: string): Promise<string> {
  const match = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(photo)
  if (!match) return photo

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const filename = `${randomUUID()}.${extension}`
  await writeFile(resolve(UPLOAD_DIRECTORY, filename), Buffer.from(match[2], 'base64'))
  return `/uploads/${filename}`
}

async function archiveRemovedPhotos(previousReviews: StoredReview[], reviews: StoredReview[]) {
  const previousPhotos = new Set(
    previousReviews.flatMap((review) => review.photos).filter(isManagedPhotoPath),
  )
  const activePhotos = new Set(reviews.flatMap((review) => review.photos))
  const removedPhotos = [...previousPhotos].filter((photo) => !activePhotos.has(photo))
  if (!removedPhotos.length) return

  await mkdir(DELETED_UPLOAD_DIRECTORY, { recursive: true })
  await Promise.allSettled(
    removedPhotos.map((photo) => {
      const filename = basename(photo)
      const archivedName = `${Date.now()}-${randomUUID()}-${filename}`
      const sourceDirectory = photo.startsWith('/images/')
        ? resolve(process.cwd(), 'public', 'images')
        : UPLOAD_DIRECTORY
      return rename(
        resolve(sourceDirectory, filename),
        resolve(DELETED_UPLOAD_DIRECTORY, archivedName),
      )
    }),
  )
}

function isManagedPhotoPath(value: string): boolean {
  return /^\/(?:uploads|images)\/[A-Za-z0-9-]+\.(?:webp|jpg|jpeg|png)$/.test(value)
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('评价数据过大，请减少照片数量。')
    chunks.push(buffer)
  }

  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('本地数据格式无效。')
  }
  return value as Record<string, unknown>
}

function readReviews(value: unknown): StoredReview[] {
  if (!Array.isArray(value)) throw new Error('评价数据格式无效。')
  if (!value.every(isStoredReview)) throw new Error('评价数据字段不完整。')
  return value
}

function readSavedShops(value: unknown): StoredShop[] {
  if (!Array.isArray(value)) throw new Error('已保存商铺数据格式无效。')
  if (!value.every(isStoredShop)) throw new Error('已保存商铺数据字段不完整。')
  return value
}

function isStoredReview(value: unknown): value is StoredReview {
  if (!value || typeof value !== 'object') return false
  const review = value as Partial<StoredReview>
  return (
    typeof review.id === 'string'
    && typeof review.shopId === 'string'
    && typeof review.author === 'string'
    && typeof review.rating === 'number'
    && Number.isFinite(review.rating)
    && typeof review.content === 'string'
    && Array.isArray(review.photos)
    && review.photos.every((photo) => typeof photo === 'string')
    && typeof review.createdAt === 'string'
  )
}

function isStoredShop(value: unknown): value is StoredShop {
  if (!value || typeof value !== 'object') return false
  const shop = value as Partial<StoredShop>
  return (
    (shop.source === 'amap' || shop.source === 'curated')
    && typeof shop.id === 'string'
    && typeof shop.amapId === 'string'
    && typeof shop.name === 'string'
    && typeof shop.category === 'string'
    && typeof shop.longitude === 'number'
    && Number.isFinite(shop.longitude)
    && typeof shop.latitude === 'number'
    && Number.isFinite(shop.latitude)
    && typeof shop.address === 'string'
    && typeof shop.summary === 'string'
    && Array.isArray(shop.signatureDishes)
    && shop.signatureDishes.every((dish) => typeof dish === 'string')
    && typeof shop.businessHours === 'string'
    && (shop.averagePrice === null || typeof shop.averagePrice === 'number')
    && Array.isArray(shop.gallery)
    && shop.gallery.every((photo) => typeof photo === 'string')
  )
}

function emptyLocalData(): LocalDataFile {
  return {
    version: 1,
    updatedAt: null,
    reviews: [],
    savedShops: [],
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  if (response.headersSent) return
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
