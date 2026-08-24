<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import { AlertTriangle, Building2, Map as MapIcon, RefreshCw } from 'lucide-vue-next'
import {
  MAP_CENTER,
  MAP_CENTER_ADDRESS,
  MAP_CENTER_LABEL,
  MAP_RADIUS_METERS,
} from '../data/shops'
import type { Shop, ShopView } from '../types'
import { isFoodRelatedShop } from '../utils/foodCategory'
import { calculateDistanceMeters, formatDistance } from '../utils/geo'

const props = defineProps<{
  shops: ShopView[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [shopId: string]
  'select-poi': [shop: Shop]
  clear: []
  ready: []
}>()

const container = ref<HTMLElement | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const poiLoadingName = ref('')
const poiErrorMessage = ref('')
const mapViewMode = ref<'2d' | '3d'>('3d')
const markerElements = new Map<string, HTMLButtonElement>()
const markers = new Map<string, any>()
const clusterMembers = new Map<string, ShopView[]>()

let AMap: any = null
let map: any = null
let radiusCircle: any = null
let centerMarker: any = null
let densityFrame = 0
let poiFeedbackTimer: number | undefined
let focusAlignmentTimer: number | undefined
let activePoiRequest = 0

const OVERVIEW_ZOOM = 11.6
const MAP_CLICK_ZOOM = 17
const CENTER_ZOOM = 19
const SHOP_ZOOM = 20
const MAX_DETAIL_ZOOM = 20
const CLUSTER_BREAK_ZOOM = 16
const COLLISION_CELL_SIZE = 86
const POI_LOOKUP_ZOOM = 15.5
const POI_HIT_RADIUS_METERS = 45
const OVERVIEW_PITCH = 34
const BUILDING_PITCH = 38
const CLOSE_DETAIL_PITCH = 36
const MAX_DETAIL_PITCH = 34
const OVERVIEW_ROTATION = -12
const DETAIL_ROTATION = -20
const FLOOR_HEIGHT_METERS = 4.2
const CAMERA_DURATION = 560
const FOCUS_ALIGNMENT_DELAY = 460
const SEARCH_PAGE_SIZE = 30
const MAP_STYLE_2D = 'amap://styles/normal'
const MAP_STYLE_3D = 'amap://styles/normal'

const hasCredentials = computed(
  () => Boolean(import.meta.env.VITE_AMAP_KEY && import.meta.env.VITE_AMAP_SECURITY_CODE),
)

async function initializeMap() {
  if (!container.value || map) return
  loading.value = true
  errorMessage.value = ''

  if (!hasCredentials.value) {
    loading.value = false
    errorMessage.value = '高德地图凭证未配置。'
    return
  }

  try {
    window._AMapSecurityConfig = {
      securityJsCode: import.meta.env.VITE_AMAP_SECURITY_CODE,
    }
    AMap = await AMapLoader.load({
      key: import.meta.env.VITE_AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.PlaceSearch', 'AMap.Geocoder'],
    })
    map = new AMap.Map(container.value, {
      center: MAP_CENTER,
      zoom: OVERVIEW_ZOOM,
      zooms: [10, MAX_DETAIL_ZOOM],
      viewMode: '3D',
      pitch: OVERVIEW_PITCH,
      rotation: OVERVIEW_ROTATION,
      pitchEnable: false,
      rotateEnable: true,
      showBuildingBlock: true,
      buildingAnimation: true,
      terrain: true,
      features: ['bg', 'point', 'road', 'building'],
      mapStyle: MAP_STYLE_3D,
      showLabel: true,
    })
    map.addControl(new AMap.Scale({ position: 'LB' }))
    radiusCircle = new AMap.Circle({
      center: MAP_CENTER,
      radius: MAP_RADIUS_METERS,
      strokeColor: '#216b4c',
      strokeOpacity: 0.55,
      strokeWeight: 2,
      strokeStyle: 'dashed',
      fillColor: '#dcebe3',
      fillOpacity: 0.08,
      zIndex: 5,
      bubble: true,
    })
    map.add(radiusCircle)
    centerMarker = new AMap.Marker({
      position: MAP_CENTER,
      content: createCenterMarkerElement(),
      anchor: 'bottom-center',
      zIndex: 115,
    })
    centerMarker.setMap(map)
    map.on('click', handleMapClick)
    map.on('zoomend', handleZoomEnd)
    map.on('moveend', handleMoveEnd)
    renderMarkers()
    map.setZoomAndCenter(OVERVIEW_ZOOM, MAP_CENTER, false, 0)
    loading.value = false
    emit('ready')
  } catch (error) {
    loading.value = false
    errorMessage.value = error instanceof Error ? error.message : '地图加载失败，请稍后重试。'
  }
}

function createCenterMarkerElement(): HTMLButtonElement {
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.className = 'center-landmark'
  marker.title = `${MAP_CENTER_ADDRESS}，点击放大`
  marker.setAttribute('aria-label', `${MAP_CENTER_LABEL}，点击查看中心周边`)

  const label = document.createElement('span')
  label.textContent = MAP_CENTER_LABEL
  const pin = document.createElement('i')
  pin.setAttribute('aria-hidden', 'true')
  marker.append(label, pin)
  marker.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('clear')
    zoomToLocation(MAP_CENTER, CENTER_ZOOM)
  })
  return marker
}

function renderMarkers() {
  if (!map || !AMap) return
  markers.forEach((marker) => marker.setMap(null))
  markers.clear()
  markerElements.clear()
  clusterMembers.clear()

  for (const shop of props.shops.filter(shouldRenderMarker)) {
    const markerElement = createMarkerElement(shop)
    const marker = new AMap.Marker({
      position: [shop.longitude, shop.latitude],
      content: markerElement,
      anchor: 'bottom-center',
      height: getMarkerHeight(shop),
      zIndex: shop.id === props.selectedId ? 130 : getMarkerZIndex(shop),
    })
    marker.setMap(map)
    markers.set(shop.id, marker)
    markerElements.set(shop.id, markerElement)
  }
  updateSelectedMarker()
  scheduleMarkerDensity()
}

function createMarkerElement(shop: ShopView): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'food-map-marker'
  button.style.setProperty('--floor-lift', `${getFloorLiftPixels(shop)}px`)
  button.setAttribute(
    'aria-label',
    shop.displayRating
      ? `${shop.name}，${shop.communityRating ? '我们的评分' : '高德参考评分'} ${shop.displayRating.toFixed(1)} 分`
      : `${shop.name}，暂无评分`,
  )
  button.title = shop.name
  if (shop.floorLabel) {
    button.title = `${shop.name} · ${shop.floorLabel}`
  }

  const photoStack = document.createElement('span')
  const photos = shop.markerPhotos.slice(0, 5)
  photoStack.className = 'marker-photo-stack'
  if (!photos.length) {
    button.classList.add('has-no-photos')
    photoStack.classList.add('is-empty')
    const emptyPin = document.createElement('span')
    emptyPin.className = 'marker-empty-pin'
    emptyPin.setAttribute('aria-hidden', 'true')
    photoStack.appendChild(emptyPin)
  }
  for (const src of photos) {
    const card = document.createElement('span')
    card.className = 'marker-photo-card'
    const image = document.createElement('img')
    image.src = src
    image.alt = ''
    image.loading = 'lazy'
    card.appendChild(image)
    photoStack.appendChild(card)
  }

  const score = document.createElement('span')
  score.className = 'marker-score'
  score.textContent = shop.displayRating
    ? `${shop.communityRating ? '我' : '德'}${shop.displayRating.toFixed(1)}`
    : '新'

  const floor = document.createElement('span')
  floor.className = 'marker-floor'
  floor.hidden = !shop.floorLabel
  floor.textContent = shop.floorLabel || ''

  const clusterCount = document.createElement('span')
  clusterCount.className = 'marker-cluster-count'
  clusterCount.hidden = true

  const name = document.createElement('span')
  name.className = 'marker-name'
  name.textContent = shop.name

  const pointer = document.createElement('span')
  pointer.className = 'marker-pointer'
  pointer.setAttribute('aria-hidden', 'true')

  button.append(photoStack, score, floor, clusterCount, name, pointer)
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    const clusteredShops = clusterMembers.get(shop.id)
    if (clusteredShops && clusteredShops.length > 1) {
      zoomToCluster(clusteredShops)
      return
    }
    emit('select', shop.id)
  })
  return button
}

function updateSelectedMarker() {
  markerElements.forEach((element, shopId) => {
    const selected = shopId === props.selectedId
    element.classList.toggle('is-selected', selected)
    const shop = props.shops.find((item) => item.id === shopId)
    markers.get(shopId)?.setzIndex(selected ? 130 : getMarkerZIndex(shop))
  })
  scheduleMarkerDensity()
}

function focusShop(shopId: string) {
  if (!map) return
  const shop = props.shops.find((item) => item.id === shopId)
  if (!shop) return
  zoomToLocation([shop.longitude, shop.latitude], SHOP_ZOOM)
  scheduleDetailAlignment()
}

function centerShopAfterDetail(shopId: string) {
  if (!map) return
  const shop = props.shops.find((item) => item.id === shopId)
  if (!shop) return
  if (focusAlignmentTimer) window.clearTimeout(focusAlignmentTimer)
  const currentZoom = map.getZoom()
  map.resize()
  map.setZoomAndCenter(
    currentZoom,
    [shop.longitude, shop.latitude],
    false,
    420,
  )
  applyMapPerspective(currentZoom, 420)
}

function zoomToLocation(position: any, zoom = SHOP_ZOOM) {
  if (!map) return
  map.setZoomAndCenter(zoom, position, false, CAMERA_DURATION)
  applyMapPerspective(zoom, CAMERA_DURATION)
}

function scheduleDetailAlignment() {
  if (focusAlignmentTimer) window.clearTimeout(focusAlignmentTimer)
  focusAlignmentTimer = window.setTimeout(() => {
    if (!map || !container.value) return
    map.resize()
    if (window.innerWidth <= 760) {
      map.panBy(0, -Math.round(window.innerHeight * 0.36), 380)
      return
    }
    const horizontalOffset = Math.min(215, Math.round(container.value.clientWidth * 0.3))
    map.panBy(-horizontalOffset, 0, 380)
  }, FOCUS_ALIGNMENT_DELAY)
}

function setMapView(mode: '2d' | '3d') {
  if (mapViewMode.value === mode) return
  mapViewMode.value = mode
  map?.setMapStyle(mode === '3d' ? MAP_STYLE_3D : MAP_STYLE_2D)
  applyMapPerspective(map?.getZoom() ?? OVERVIEW_ZOOM, 360)
}

function applyMapPerspective(zoom: number, duration = 0) {
  if (!map) return
  const isDetail = zoom >= CLUSTER_BREAK_ZOOM
  const pitch = mapViewMode.value === '3d'
    ? getPitchForZoom(zoom)
    : 0
  const rotation = mapViewMode.value === '3d'
    ? (isDetail ? DETAIL_ROTATION : OVERVIEW_ROTATION)
    : 0
  map.setPitch(pitch, duration === 0, duration)
  map.setRotation(rotation, duration === 0, duration)
}

function getPitchForZoom(zoom: number): number {
  if (zoom >= 19.5) return MAX_DETAIL_PITCH
  if (zoom >= 18.5) return CLOSE_DETAIL_PITCH
  if (zoom >= CLUSTER_BREAK_ZOOM) return BUILDING_PITCH
  return OVERVIEW_PITCH
}

function getMarkerHeight(shop?: Shop): number {
  if (!shop?.floorLevel || shop.floorLevel < 1) return 0
  return shop.floorLevel * FLOOR_HEIGHT_METERS
}

function getFloorLiftPixels(shop: Shop): number {
  if (shop.floorLevel && shop.floorLevel > 0) {
    return Math.min(154, 28 + (shop.floorLevel - 1) * 22)
  }
  if (shop.floorLevel === 0) return 12
  return 18
}

function getMarkerZIndex(shop?: Shop): number {
  return 80 + Math.max(0, shop?.floorLevel ?? 0)
}

function shouldRenderMarker(shop: ShopView): boolean {
  return shop.reviewCount > 0 && isFoodRelatedShop(shop)
}

function zoomToCluster(clusteredShops: ShopView[]) {
  if (!map || !clusteredShops.length) return
  const center = clusteredShops.reduce(
    (position, shop) => [position[0] + shop.longitude, position[1] + shop.latitude],
    [0, 0],
  )
  center[0] /= clusteredShops.length
  center[1] /= clusteredShops.length
  const nextZoom = Math.min(SHOP_ZOOM, Math.max(CLUSTER_BREAK_ZOOM + 0.2, map.getZoom() + 2))
  zoomToLocation(center, nextZoom)
}

function scheduleMarkerDensity() {
  window.cancelAnimationFrame(densityFrame)
  densityFrame = window.requestAnimationFrame(updateMarkerDensity)
}

function handleZoomEnd() {
  scheduleMarkerDensity()
  syncPitchToZoom()
}

function handleMoveEnd() {
  scheduleMarkerDensity()
  syncPitchToZoom()
}

function syncPitchToZoom() {
  if (!map || mapViewMode.value !== '3d') return
  const targetPitch = getPitchForZoom(map.getZoom())
  if (Math.abs(map.getPitch() - targetPitch) > 0.5) {
    map.setPitch(targetPitch, false, 220)
  }
}

function updateMarkerDensity() {
  if (!map || !AMap) return
  centerMarker?.setzIndex(map.getZoom() >= CLUSTER_BREAK_ZOOM ? 72 : 115)
  clusterMembers.clear()
  markerElements.forEach((element) => {
    element.classList.remove('is-cluster')
    const count = element.querySelector<HTMLElement>('.marker-cluster-count')
    if (count) count.hidden = true
  })

  const markerShops = props.shops.filter((shop) => markers.has(shop.id))
  if (map.getZoom() >= CLUSTER_BREAK_ZOOM || markerShops.length < 2) {
    markers.forEach((marker) => marker.show())
    return
  }

  const groups = new Map<string, ShopView[]>()
  for (const shop of markerShops) {
    const pixel = map.lngLatToContainer(new AMap.LngLat(shop.longitude, shop.latitude))
    const x = typeof pixel?.getX === 'function' ? pixel.getX() : pixel?.x
    const y = typeof pixel?.getY === 'function' ? pixel.getY() : pixel?.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${Math.floor(x / COLLISION_CELL_SIZE)}:${Math.floor(y / COLLISION_CELL_SIZE)}`
    const group = groups.get(key) ?? []
    group.push(shop)
    groups.set(key, group)
  }

  const visibleIds = new Set<string>()
  groups.forEach((group) => {
    const representative = group.find((shop) => shop.id === props.selectedId) ?? group[0]
    visibleIds.add(representative.id)
    if (group.length <= 1) return
    clusterMembers.set(representative.id, group)
    const element = markerElements.get(representative.id)
    element?.classList.add('is-cluster')
    const count = element?.querySelector<HTMLElement>('.marker-cluster-count')
    if (count) {
      count.textContent = String(group.length)
      count.hidden = false
    }
  })

  markers.forEach((marker, shopId) => {
    if (visibleIds.has(shopId)) marker.show()
    else marker.hide()
  })
}

async function handleMapClick(event: any) {
  const poiId = readPoiId(event?.poi)
  if (poiId) {
    await openPoiDetails(poiId, event.poi?.name, event.lnglat)
    return
  }

  const requestId = ++activePoiRequest
  const currentZoom = map?.getZoom() ?? OVERVIEW_ZOOM
  poiLoadingName.value = ''
  poiErrorMessage.value = ''
  emit('clear')
  if (!event?.lnglat) return

  zoomToLocation(event.lnglat, Math.max(MAP_CLICK_ZOOM, Math.min(currentZoom, SHOP_ZOOM)))
  if (currentZoom < POI_LOOKUP_ZOOM) return

  poiLoadingName.value = '地图位置'
  try {
    const shop = await findNearestPoi(event.lnglat)
    if (requestId !== activePoiRequest) return
    poiLoadingName.value = ''
    if (!shop) return
    zoomToLocation([shop.longitude, shop.latitude], SHOP_ZOOM)
    emit('select-poi', shop)
  } catch (error) {
    if (requestId !== activePoiRequest) return
    poiLoadingName.value = ''
    showPoiError(error instanceof Error ? error.message : '附近地点识别失败。')
  }
}

async function openPoiDetails(poiId: string, poiName?: string, position?: any) {
  const requestId = ++activePoiRequest
  emit('clear')
  poiErrorMessage.value = ''
  poiLoadingName.value = String(poiName || '店铺')
  if (position) zoomToLocation(position, SHOP_ZOOM)

  try {
    const shop = await getPoiDetails(poiId)
    if (requestId !== activePoiRequest) return
    poiLoadingName.value = ''
    emit('select-poi', shop)
  } catch (error) {
    if (requestId !== activePoiRequest) return
    poiLoadingName.value = ''
    showPoiError(error instanceof Error ? error.message : '店铺详情读取失败。')
  }
}

function getPoiDetails(poiId: string): Promise<Shop> {
  if (!AMap) return Promise.reject(new Error('地图尚未加载完成。'))
  const placeSearch = new AMap.PlaceSearch({ extensions: 'all' })
  return new Promise((resolve, reject) => {
    placeSearch.getDetails(poiId, (status: string, result: any) => {
      const poi = result?.poiList?.pois?.[0]
      const shop = poi ? createShopFromPoi(poi) : null
      if (status === 'complete' && shop) {
        resolve(shop)
        return
      }
      reject(new Error(result?.info || '高德暂未返回这个地点的详情。'))
    })
  })
}

function findNearestPoi(position: any): Promise<Shop | null> {
  if (!AMap) return Promise.reject(new Error('地图尚未加载完成。'))
  const geocoder = new AMap.Geocoder({ radius: 80, extensions: 'all' })
  return new Promise((resolve, reject) => {
    geocoder.getAddress(position, async (status: string, result: any) => {
      if (status !== 'complete') {
        reject(new Error(result?.info || '高德附近地点查询失败。'))
        return
      }
      const pois = Array.isArray(result?.regeocode?.pois) ? result.regeocode.pois : []
      const nearestPoi = pois
        .filter((poi: any) => readPoiId(poi) && isFoodRelatedShop({
          name: String(poi.name || ''),
          category: String(poi.type || ''),
        }))
        .sort((first: any, second: any) => Number(first.distance) - Number(second.distance))[0]
      const distance = Number(nearestPoi?.distance)
      if (!nearestPoi || !Number.isFinite(distance) || distance > POI_HIT_RADIUS_METERS) {
        resolve(null)
        return
      }
      try {
        resolve(await getPoiDetails(readPoiId(nearestPoi)))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function readPoiId(poi: any): string {
  const value = poi?.id ?? poi?.ID ?? poi?.poiId ?? poi?.getId?.()
  return value ? String(value) : ''
}

function showPoiError(message: string) {
  poiErrorMessage.value = message
  if (poiFeedbackTimer) window.clearTimeout(poiFeedbackTimer)
  poiFeedbackTimer = window.setTimeout(() => {
    poiErrorMessage.value = ''
  }, 4200)
}

function showOverview() {
  if (!map) return
  map.setZoomAndCenter(OVERVIEW_ZOOM, MAP_CENTER, false, 380)
  applyMapPerspective(OVERVIEW_ZOOM, 380)
}

function resizeMap() {
  window.requestAnimationFrame(() => map?.resize())
  window.setTimeout(() => map?.resize(), 220)
}

async function searchNearbyShops(keyword: string): Promise<Shop[]> {
  if (!AMap || !map) return Promise.reject(new Error('地图尚未加载完成，请稍后再试。'))
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) return Promise.resolve([])

  const attempts = await Promise.allSettled([
    searchPoiNearCenter(normalizedKeyword),
    searchPoiInCity(normalizedKeyword),
  ])
  const successfulAttempts = attempts.filter(
    (attempt): attempt is PromiseFulfilledResult<Shop[]> => attempt.status === 'fulfilled',
  )
  if (!successfulAttempts.length) {
    const failedAttempt = attempts.find(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    )
    throw failedAttempt?.reason instanceof Error
      ? failedAttempt.reason
      : new Error('高德店铺搜索失败，请稍后重试。')
  }

  const uniqueShops = new Map<string, Shop>()
  for (const shop of successfulAttempts.flatMap((attempt) => attempt.value)) {
    if (!isFoodRelatedShop(shop)) continue
    uniqueShops.set(shop.amapId || shop.id, shop)
  }
  return [...uniqueShops.values()].sort(
    (first, second) => (first.distanceMeters ?? Infinity) - (second.distanceMeters ?? Infinity),
  )
}

function searchPoiNearCenter(keyword: string): Promise<Shop[]> {
  const placeSearch = new AMap.PlaceSearch({
    city: '武汉市',
    citylimit: true,
    pageSize: SEARCH_PAGE_SIZE,
    pageIndex: 1,
    extensions: 'all',
  })

  return new Promise((resolve, reject) => {
    placeSearch.searchNearBy(
      keyword,
      new AMap.LngLat(MAP_CENTER[0], MAP_CENTER[1]),
      MAP_RADIUS_METERS,
      (status: string, result: any) => {
        resolvePlaceSearchResult(status, result, '高德周边搜索失败，请稍后重试。', resolve, reject)
      },
    )
  })
}

function searchPoiInCity(keyword: string): Promise<Shop[]> {
  const placeSearch = new AMap.PlaceSearch({
    city: '武汉市',
    citylimit: true,
    pageSize: SEARCH_PAGE_SIZE,
    pageIndex: 1,
    extensions: 'all',
  })

  return new Promise((resolve, reject) => {
    placeSearch.search(keyword, (status: string, result: any) => {
      resolvePlaceSearchResult(status, result, '高德城市搜索失败，请稍后重试。', resolve, reject)
    })
  })
}

async function searchShopNearLocation(shop: Shop): Promise<Shop[]> {
  if (!AMap) return Promise.reject(new Error('地图尚未加载完成。'))
  const keyword = shop.name.replace(/[\uff08(][^\uff09)]*[\uff09)]/g, '').trim() || shop.name
  const exactResults = await searchPoiNearLocation(keyword, shop).catch(() => [])
  if (exactResults.length) return exactResults

  const cityResults = await searchPoiInCity(keyword).catch(() => [])
  if (cityResults.length || !shop.category || shop.category === keyword) return cityResults

  const categoryResults = await searchPoiNearLocation(shop.category, shop).catch(() => [])
  if (categoryResults.length) return categoryResults
  return searchPoiInCity(shop.category)
}

function searchPoiNearLocation(keyword: string, shop: Shop): Promise<Shop[]> {
  const placeSearch = new AMap.PlaceSearch({
    city: '武汉市',
    citylimit: true,
    pageSize: 10,
    pageIndex: 1,
    extensions: 'all',
  })

  return new Promise((resolve, reject) => {
    placeSearch.searchNearBy(
      keyword,
      new AMap.LngLat(shop.longitude, shop.latitude),
      700,
      (status: string, result: any) => {
        resolvePlaceSearchResult(
          status,
          result,
          `高德未返回${shop.name}的匹配结果。`,
          resolve,
          reject,
        )
      },
    )
  })
}

function resolvePlaceSearchResult(
  status: string,
  result: any,
  fallbackMessage: string,
  resolve: (shops: Shop[]) => void,
  reject: (error: Error) => void,
) {
  if (status === 'no_data') {
    resolve([])
    return
  }
  if (status !== 'complete' || !result?.poiList?.pois) {
    reject(new Error(result?.info || fallbackMessage))
    return
  }
  resolve(result.poiList.pois.map(createShopFromPoi).filter(Boolean) as Shop[])
}

function createShopFromPoi(poi: any): Shop | null {
  const longitude = readCoordinate(poi.location, 'lng')
  const latitude = readCoordinate(poi.location, 'lat')
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !poi.name) return null

  const amapId = String(poi.id || `${longitude}-${latitude}-${poi.name}`)
  const typeParts = String(poi.type || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  const category = typeParts.at(-1) || '餐饮商铺'
  const address = normalizeAddress(poi)
  const floor = inferFloor(address, String(poi.name))
  const distanceMeters = parsePositiveNumber(poi.distance)
    ?? calculateDistanceMeters(MAP_CENTER, [longitude, latitude])
  const bizExt = readRecord(poi.biz_ext ?? poi.bizExt)
  const business = readRecord(poi.business)
  const averagePrice = parsePositiveNumber(
    bizExt.cost ?? business.cost ?? business.average_cost ?? poi.cost,
  )
  const sourceRating = parseRating(
    bizExt.rating
      ?? bizExt.star
      ?? business.rating
      ?? business.star
      ?? poi.rating
      ?? poi.shop_rating,
  )
  const photos = Array.isArray(poi.photos)
    ? poi.photos
        .map((photo: any) => String(photo?.url || '').replace(/^http:/, 'https:'))
        .filter(Boolean)
        .slice(0, 6)
    : []
  const distanceCopy = distanceMeters
    ? `距微派约 ${formatDistance(distanceMeters)}`
    : '位于武汉市'

  return {
    id: `amap-${amapId}`,
    source: 'amap',
    amapId,
    name: String(poi.name),
    category,
    longitude,
    latitude,
    address,
    summary: `${distanceCopy}，高德地图分类为${category}。`,
    signatureDishes: [],
    businessHours: String(
      bizExt.open_time
        || bizExt.openTime
        || business.open_time
        || business.opentime_today
        || '以店铺实际营业时间为准',
    ),
    averagePrice: averagePrice ? Math.round(averagePrice) : null,
    sourceRating,
    distanceMeters,
    telephone: normalizeTelephone(poi.tel),
    ...floor,
    gallery: photos,
  }
}

function inferFloor(address: string, name: string): Pick<Shop, 'floorLevel' | 'floorLabel'> {
  const source = `${address} ${name}`.toUpperCase()
  const basementMatch = source.match(/(?:^|[^A-Z0-9])B\s*(\d{1,2})(?:\s*层)?/)
  if (basementMatch) {
    const level = Number(basementMatch[1])
    return { floorLevel: -level, floorLabel: `B${level}` }
  }

  const latinMatch = source.match(/(?:^|[^A-Z0-9])L\s*(\d{1,2})(?:\s*层)?/)
  const chineseMatch = address.match(/(?:^|[^\d])(?:第)?(\d{1,2})层/)
  const level = Number(latinMatch?.[1] ?? chineseMatch?.[1])
  if (Number.isInteger(level) && level > 0 && level <= 99) {
    return { floorLevel: level, floorLabel: `L${level}` }
  }
  return {}
}

function readCoordinate(location: any, key: 'lng' | 'lat'): number {
  if (!location) return Number.NaN
  const getterName = key === 'lng' ? 'getLng' : 'getLat'
  const value = typeof location[getterName] === 'function' ? location[getterName]() : location[key]
  return Number(value)
}

function normalizeAddress(poi: any): string {
  if (Array.isArray(poi.address)) return poi.address.filter(Boolean).join('') || '地址暂无'
  if (poi.address) return String(poi.address)
  const fallback = [poi.pname, poi.cityname, poi.adname].filter(Boolean).join('')
  return fallback || '地址暂无'
}

function normalizeTelephone(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join(' / ') || undefined
  return value ? String(value) : undefined
}

function readRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function parsePositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseRating(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5 ? parsed : undefined
}

async function retry() {
  if (map) {
    map.destroy()
    map = null
  }
  await nextTick()
  await initializeMap()
}

watch(
  () => props.shops,
  () => renderMarkers(),
  { deep: true },
)

watch(
  () => props.selectedId,
  (nextId) => {
    updateSelectedMarker()
    if (nextId) focusShop(nextId)
  },
)

onMounted(initializeMap)

onBeforeUnmount(() => {
  window.cancelAnimationFrame(densityFrame)
  if (poiFeedbackTimer) window.clearTimeout(poiFeedbackTimer)
  if (focusAlignmentTimer) window.clearTimeout(focusAlignmentTimer)
  markers.forEach((marker) => marker.setMap(null))
  markers.clear()
  centerMarker?.setMap(null)
  centerMarker = null
  map?.destroy()
  map = null
})

defineExpose({
  focusShop,
  centerShopAfterDetail,
  showOverview,
  searchNearbyShops,
  searchShopNearLocation,
  getPoiDetails,
  resizeMap,
})
</script>

<template>
  <div class="map-stage" :class="{ 'is-3d': mapViewMode === '3d' }">
    <div ref="container" class="map-canvas" aria-label="周边十公里美食地图" />

    <div
      v-if="!loading && !errorMessage"
      class="map-view-switch"
      role="group"
      aria-label="地图视角"
    >
      <button
        type="button"
        :class="{ 'is-active': mapViewMode === '2d' }"
        :aria-pressed="mapViewMode === '2d'"
        title="切换到俯视地图"
        @click="setMapView('2d')"
      >
        <MapIcon :size="15" aria-hidden="true" />
        2D
      </button>
      <button
        type="button"
        :class="{ 'is-active': mapViewMode === '3d' }"
        :aria-pressed="mapViewMode === '3d'"
        title="切换到倾斜建筑视角"
        @click="setMapView('3d')"
      >
        <Building2 :size="15" aria-hidden="true" />
        3D
      </button>
    </div>

    <div v-if="loading" class="map-status" role="status">
      <span class="loading-spinner" aria-hidden="true" />
      <span>正在载入地图</span>
    </div>

    <div v-else-if="errorMessage" class="map-status map-error" role="alert">
      <AlertTriangle :size="24" aria-hidden="true" />
      <strong>地图暂时无法显示</strong>
      <span>{{ errorMessage }}</span>
      <button type="button" class="secondary-button" @click="retry">
        <RefreshCw :size="17" aria-hidden="true" />
        重试
      </button>
    </div>

    <div v-if="poiLoadingName" class="map-poi-feedback" role="status">
      <span class="loading-spinner" aria-hidden="true" />
      正在读取{{ poiLoadingName }}详情
    </div>
    <div v-else-if="poiErrorMessage" class="map-poi-feedback is-error" role="alert">
      <AlertTriangle :size="17" aria-hidden="true" />
      {{ poiErrorMessage }}
    </div>
  </div>
</template>
