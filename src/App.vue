<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  LocateFixed,
  MapPinned,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from 'lucide-vue-next'
import FoodMap from './components/FoodMap.vue'
import PhotoLightbox from './components/PhotoLightbox.vue'
import ReviewComposer from './components/ReviewComposer.vue'
import ShopDetailDrawer from './components/ShopDetailDrawer.vue'
import ShopRail from './components/ShopRail.vue'
import { shops } from './data/shops'
import {
  createLocalReview,
  loadLocalReviews,
  loadPersistedLocalData,
  loadSavedShops,
  persistLocalData,
  saveReviewedShop,
  saveLocalReviews,
  saveLocalShops,
} from './services/reviewStorage'
import type { Review, ReviewDraft, Shop, ShopView } from './types'
import { isFoodRelatedShop } from './utils/foodCategory'
import { calculateDistanceMeters } from './utils/geo'
import { MAP_CENTER } from './data/shops'

type SearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error'
type SortMode = 'rating' | 'distance'

const mapRef = ref<InstanceType<typeof FoodMap> | null>(null)
const localReviews = ref<Review[]>(loadLocalReviews())
const savedShops = ref<Shop[]>(loadSavedShops())
const selectedId = ref<string | null>(null)
const reviewShopId = ref<string | null>(null)
const editingReviewId = ref<string | null>(null)
const railCollapsed = ref(false)
const sortMode = ref<SortMode>('rating')
const searchQuery = ref('')
const poiShops = ref<Shop[]>([])
const clickedPoiShops = ref<Shop[]>([])
const searchStatus = ref<SearchStatus>('idle')
const searchError = ref('')
const toastMessage = ref('')
const lightbox = ref<{ photos: string[]; index: number; label: string } | null>(null)
let toastTimer: number | undefined
let searchTimer: number | undefined
let activeSearchRequest = 0
let localDataReady: Promise<void> = Promise.resolve()
let linkingCuratedShops = false

const EXACT_NAME_LINK_RADIUS_METERS = 700
const FUZZY_NAME_LINK_RADIUS_METERS = 180
const FUZZY_NAME_MIN_SCORE = 0.5

const allReviews = computed(() => localReviews.value)

const activeShops = computed(() => {
  if (searchStatus.value === 'idle') {
    return mergeShops(shops, savedShops.value, clickedPoiShops.value)
  }

  const resultIds = new Set(poiShops.value.map((shop) => shop.id))
  return mergeShops(
    poiShops.value,
    savedShops.value.filter((shop) => resultIds.has(shop.id)),
    clickedPoiShops.value.filter((shop) => resultIds.has(shop.id)),
  )
})

const shopViews = computed<ShopView[]>(() => {
  const views = activeShops.value.map((shop) => {
    const reviews = allReviews.value
      .filter((review) => review.shopId === shop.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const communityRating = reviews.length
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : null
    const amapRating = shop.sourceRating ?? null
    const reviewPhotos = reviews.flatMap((review) => review.photos)
    const markerPhotos = [...new Set(reviewPhotos)].slice(0, 5)

    return {
      ...shop,
      distanceMeters: shop.distanceMeters ?? calculateDistanceMeters(
        MAP_CENTER,
        [shop.longitude, shop.latitude],
      ),
      communityRating,
      amapRating,
      displayRating: communityRating ?? amapRating,
      reviewCount: reviews.length,
      markerPhotos,
      reviews,
    }
  })

  if (searchStatus.value !== 'idle') return views
  return views.sort((first, second) => {
    if (sortMode.value === 'distance') return first.distanceMeters - second.distanceMeters
    const firstRating = first.communityRating ?? -1
    const secondRating = second.communityRating ?? -1
    return secondRating - firstRating || first.distanceMeters - second.distanceMeters
  })
})

const railShops = computed(() =>
  searchStatus.value === 'idle'
    ? shopViews.value.filter((shop) => shop.reviewCount > 0 && isFoodRelatedShop(shop))
    : shopViews.value.filter(isFoodRelatedShop),
)

const selectedShop = computed(
  () => shopViews.value.find((shop) => shop.id === selectedId.value) ?? null,
)

const reviewShop = computed(
  () => shopViews.value.find((shop) => shop.id === reviewShopId.value) ?? null,
)

const editingReview = computed(
  () => localReviews.value.find((review) => review.id === editingReviewId.value) ?? null,
)

function selectShop(shopId: string) {
  selectedId.value = shopId
}

async function selectPoi(shop: Shop) {
  const [associatedShop] = await associateAmapShops([shop])
  clickedPoiShops.value = mergeShops(clickedPoiShops.value, [associatedShop])
  await nextTick()
  selectedId.value = associatedShop.id
}

function closeDetail() {
  const closingShopId = selectedId.value
  selectedId.value = null
  if (closingShopId) {
    void nextTick(() => mapRef.value?.centerShopAfterDetail(closingShopId))
  }
}

function clearSelection() {
  selectedId.value = null
}

function showOverview() {
  selectedId.value = null
  mapRef.value?.showOverview()
}

function toggleRail() {
  railCollapsed.value = !railCollapsed.value
  mapRef.value?.resizeMap()
}

async function searchNearbyShops() {
  const keyword = searchQuery.value.trim()
  if (!keyword) {
    clearSearch()
    return
  }
  const requestId = ++activeSearchRequest

  selectedId.value = null
  reviewShopId.value = null
  poiShops.value = []
  searchStatus.value = 'loading'
  searchError.value = ''
  mapRef.value?.showOverview()

  try {
    if (!mapRef.value) throw new Error('地图尚未加载完成，请稍后再试。')
    const results = await mapRef.value.searchNearbyShops(keyword)
    const associatedResults = await associateAmapShops(results)
    if (requestId !== activeSearchRequest || keyword !== searchQuery.value.trim()) return
    poiShops.value = [...new Map(associatedResults.map((shop) => [shop.id, shop])).values()]
    searchStatus.value = poiShops.value.length ? 'success' : 'empty'
  } catch (error) {
    if (requestId !== activeSearchRequest) return
    poiShops.value = []
    searchStatus.value = 'error'
    searchError.value = error instanceof Error ? error.message : '高德店铺搜索失败。'
  }
}

function clearSearch() {
  if (searchTimer) window.clearTimeout(searchTimer)
  activeSearchRequest += 1
  searchQuery.value = ''
  poiShops.value = []
  searchStatus.value = 'idle'
  searchError.value = ''
  selectedId.value = null
  reviewShopId.value = null
  mapRef.value?.showOverview()
}

function triggerImmediateSearch() {
  if (searchTimer) window.clearTimeout(searchTimer)
  void searchNearbyShops()
}

function openReview(shopId: string) {
  editingReviewId.value = null
  reviewShopId.value = shopId
}

function editReview(reviewId: string) {
  const review = localReviews.value.find((item) => item.id === reviewId)
  if (!review) return
  selectedId.value = review.shopId
  reviewShopId.value = review.shopId
  editingReviewId.value = review.id
}

async function deleteReview(reviewId: string) {
  await localDataReady
  const review = localReviews.value.find((item) => item.id === reviewId)
  if (!review) return
  const nextReviews = localReviews.value.filter((item) => item.id !== reviewId)

  try {
    const persisted = await persistLocalData(nextReviews, savedShops.value)
    applyPersistedData(persisted.reviews, persisted.savedShops)
    if (editingReviewId.value === reviewId) {
      editingReviewId.value = null
      reviewShopId.value = null
    }
    showToast('评价已删除，相关上传照片已移入本地回收目录。')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '评价删除失败。')
  }
}

async function submitReview(draft: ReviewDraft) {
  await localDataReady
  if (!reviewShop.value) return
  const submittedShop = reviewShop.value
  const existingReview = editingReview.value
  const nextReview = existingReview
    ? { ...existingReview, ...draft, author: draft.author.trim() || '访客', content: draft.content.trim() }
    : createLocalReview(submittedShop.id, draft)
  const nextReviews = existingReview
    ? localReviews.value.map((review) => review.id === existingReview.id ? nextReview : review)
    : [...localReviews.value, nextReview]
  let nextSavedShops = savedShops.value

  try {
    if (submittedShop.source === 'amap') {
      nextSavedShops = saveReviewedShop(submittedShop)
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '评价保存失败。')
    return
  }

  try {
    const persisted = await persistLocalData(nextReviews, nextSavedShops)
    applyPersistedData(persisted.reviews, persisted.savedShops)
    finishReviewSubmission(submittedShop.id)
    showToast(existingReview ? '评价已更新。' : '评价和照片已保存到本地文件。')
  } catch (error) {
    const message = error instanceof Error ? error.message : '本地数据文件写入失败。'
    try {
      saveLocalReviews(nextReviews)
      saveLocalShops(nextSavedShops)
      localReviews.value = nextReviews
      savedShops.value = nextSavedShops
      finishReviewSubmission(submittedShop.id)
      showToast(`评价已保存在浏览器，但${message}`)
    } catch (backupError) {
      showToast(backupError instanceof Error ? backupError.message : '评价保存失败。')
    }
  }
}

function finishReviewSubmission(shopId: string) {
  selectedId.value = shopId
  reviewShopId.value = null
  editingReviewId.value = null
}

async function hydratePersistedData() {
  let persisted: Awaited<ReturnType<typeof loadPersistedLocalData>>
  try {
    persisted = await loadPersistedLocalData()
  } catch (error) {
    const message = error instanceof Error ? error.message : '本地数据文件读取失败。'
    showToast(`${message}已继续使用浏览器备份。`)
    return
  }

  const mergedReviews = mergeReviews(localReviews.value, persisted.reviews)
  const mergedSavedShops = mergeShops(savedShops.value, persisted.savedShops)
  try {
    const normalized = await persistLocalData(mergedReviews, mergedSavedShops)
    applyPersistedData(normalized.reviews, normalized.savedShops)
  } catch (error) {
    // Static hosts cannot write the Vite API, but the build snapshot still needs
    // to be available and subsequent edits can use localStorage as a backup.
    applyPersistedData(mergedReviews, mergedSavedShops)
    const message = error instanceof Error ? error.message : '本地数据文件写入失败。'
    showToast(`已加载发布时的数据；${message}，新增内容将保存在当前浏览器。`)
  }
}

function applyPersistedData(reviews: Review[], persistedShops: Shop[]) {
  localReviews.value = reviews
  savedShops.value = persistedShops
  saveLocalReviews(reviews)
  saveLocalShops(persistedShops)
}

function mergeReviews(...groups: Review[][]): Review[] {
  const merged = new Map<string, Review>()
  for (const review of groups.flat()) merged.set(review.id, review)
  return [...merged.values()]
}

function mergeShops(...groups: Shop[][]): Shop[] {
  const merged = new Map<string, Shop>()
  for (const shop of groups.flat()) {
    merged.set(shop.id, { ...merged.get(shop.id), ...shop })
  }
  return [...merged.values()]
}

async function associateAmapShops(amapShops: Shop[]): Promise<Shop[]> {
  const curatedShops = mergeShops(shops, savedShops.value)
    .filter((shop) => shop.source === 'curated')
  let nextSavedShops = savedShops.value
  let nextReviews = localReviews.value
  let changed = false

  const associatedShops = amapShops.map((amapShop) => {
    const curatedShop = findCuratedMatch(amapShop, curatedShops)
    if (!curatedShop) return amapShop

    const linkedShop = linkCuratedShop(curatedShop, amapShop)
    const existingLink = nextSavedShops.find((shop) => shop.id === linkedShop.id)
    if (!existingLink || JSON.stringify(existingLink) !== JSON.stringify(linkedShop)) {
      nextSavedShops = mergeShops(nextSavedShops, [linkedShop])
      changed = true
    }

    const migratedReviews = nextReviews.map((review) =>
      review.shopId === amapShop.id ? { ...review, shopId: curatedShop.id } : review,
    )
    if (migratedReviews.some((review, index) => review !== nextReviews[index])) {
      nextReviews = migratedReviews
      changed = true
    }
    return linkedShop
  })

  if (changed) await persistAssociatedData(nextReviews, nextSavedShops)
  return associatedShops
}

function findCuratedMatch(amapShop: Shop, curatedShops: Shop[]): Shop | null {
  if (amapShop.amapId) {
    const existingLink = curatedShops.find((shop) => shop.amapId === amapShop.amapId)
    if (existingLink) return existingLink
  }

  const amapName = normalizeShopName(amapShop.name)
  const candidates = curatedShops
    .map((curatedShop) => {
      const curatedName = normalizeShopName(curatedShop.name)
      const distance = calculateDistanceMeters(
        [curatedShop.longitude, curatedShop.latitude],
        [amapShop.longitude, amapShop.latitude],
      )
      const nameScore = calculateNameSimilarity(curatedName, amapName)
      const exactName = Boolean(curatedName && curatedName === amapName)
      return { curatedShop, distance, nameScore, exactName }
    })
    .filter(({ distance, nameScore, exactName }) =>
      (exactName && distance <= EXACT_NAME_LINK_RADIUS_METERS)
      || (nameScore >= FUZZY_NAME_MIN_SCORE && distance <= FUZZY_NAME_LINK_RADIUS_METERS),
    )
    .sort((first, second) => {
      if (first.exactName !== second.exactName) return first.exactName ? -1 : 1
      if (first.nameScore !== second.nameScore) return second.nameScore - first.nameScore
      return first.distance - second.distance
    })

  return candidates[0]?.curatedShop ?? null
}

function linkCuratedShop(curatedShop: Shop, amapShop: Shop): Shop {
  const hasGenericHours = curatedShop.businessHours === '以店铺实际营业时间为准'
  return {
    ...curatedShop,
    source: 'curated',
    amapId: amapShop.amapId,
    longitude: amapShop.longitude,
    latitude: amapShop.latitude,
    address: amapShop.address,
    sourceRating: amapShop.sourceRating,
    distanceMeters: amapShop.distanceMeters,
    averagePrice: curatedShop.averagePrice ?? amapShop.averagePrice,
    businessHours: hasGenericHours ? amapShop.businessHours : curatedShop.businessHours,
    telephone: curatedShop.telephone || amapShop.telephone,
    floorLevel: amapShop.floorLevel ?? curatedShop.floorLevel,
    floorLabel: amapShop.floorLabel ?? curatedShop.floorLabel,
    gallery: amapShop.gallery,
  }
}

async function persistAssociatedData(nextReviews: Review[], nextSavedShops: Shop[]) {
  localReviews.value = nextReviews
  savedShops.value = nextSavedShops
  try {
    const persisted = await persistLocalData(nextReviews, nextSavedShops)
    applyPersistedData(persisted.reviews, persisted.savedShops)
  } catch (error) {
    saveLocalReviews(nextReviews)
    saveLocalShops(nextSavedShops)
    const message = error instanceof Error ? error.message : '本地文件写入失败。'
    showToast(`门店已关联，但${message}`)
  }
}

async function linkUnresolvedCuratedShops() {
  await localDataReady
  if (linkingCuratedShops || !mapRef.value) return
  linkingCuratedShops = true
  try {
    const linkedIds = new Set(
      savedShops.value
        .filter((shop) => shop.source === 'curated' && shop.amapId)
        .map((shop) => shop.id),
    )
    const linkedShops = savedShops.value.filter(
      (shop) => shop.source === 'curated' && shop.amapId,
    )
    const unresolvedShops = mergeShops(shops, savedShops.value)
      .filter((shop) => shop.source === 'curated' && !linkedIds.has(shop.id))
    const matches: Shop[] = []

    for (const linkedShop of linkedShops) {
      if (!linkedShop.amapId) continue
      try {
        matches.push(await mapRef.value.getPoiDetails(linkedShop.amapId))
      } catch {
        // Keep the last persisted details when a refresh is temporarily unavailable.
      }
    }

    for (const curatedShop of unresolvedShops) {
      try {
        const candidates = await mapRef.value.searchShopNearLocation(curatedShop)
        const match = candidates
          .map((candidate) => ({ candidate, matched: findCuratedMatch(candidate, [curatedShop]) }))
          .find(({ matched }) => Boolean(matched))
        if (match) matches.push(match.candidate)
      } catch {
        // A missing POI must not prevent the remaining curated shops from being linked.
      }
    }

    if (matches.length) await associateAmapShops(matches)
  } finally {
    linkingCuratedShops = false
  }
}

function normalizeShopName(name: string): string {
  return name
    .toLocaleLowerCase('zh-CN')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·•・,，.。、_\-—]/g, '')
    .replace(/店$/, '')
}

function calculateNameSimilarity(first: string, second: string): number {
  if (!first || !second) return 0
  if (first === second) return 1
  if (first.length === 1 || second.length === 1) return first === second ? 1 : 0

  const firstPairs = createCharacterPairs(first)
  const secondPairs = createCharacterPairs(second)
  const remainingPairs = [...secondPairs]
  let overlap = 0
  for (const pair of firstPairs) {
    const matchIndex = remainingPairs.indexOf(pair)
    if (matchIndex < 0) continue
    overlap += 1
    remainingPairs.splice(matchIndex, 1)
  }
  return (2 * overlap) / (firstPairs.length + secondPairs.length)
}

function createCharacterPairs(value: string): string[] {
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2))
}

function openPhoto(photos: string[], index: number, label: string) {
  if (selectedId.value) mapRef.value?.focusShop(selectedId.value)
  lightbox.value = { photos, index, label }
}

function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 3200)
}

watch(searchQuery, (query) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  activeSearchRequest += 1

  if (!query.trim()) {
    poiShops.value = []
    searchStatus.value = 'idle'
    searchError.value = ''
    selectedId.value = null
    reviewShopId.value = null
    mapRef.value?.showOverview()
    return
  }

  searchTimer = window.setTimeout(() => {
    void searchNearbyShops()
  }, 260)
})

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
})

onMounted(() => {
  localDataReady = hydratePersistedData()
})
</script>

<template>
  <main
    class="app-shell"
    :class="{
      'has-selection': selectedShop,
      'is-rail-collapsed': railCollapsed,
    }"
  >
    <header class="app-header">
      <div class="header-start">
        <button
          type="button"
          class="sidebar-toggle icon-button"
          :title="railCollapsed ? '展开商铺侧边栏' : '收起商铺侧边栏'"
          :aria-label="railCollapsed ? '展开商铺侧边栏' : '收起商铺侧边栏'"
          :aria-expanded="!railCollapsed"
          @click="toggleRail"
        >
          <PanelLeftOpen v-if="railCollapsed" :size="19" aria-hidden="true" />
          <PanelLeftClose v-else :size="19" aria-hidden="true" />
        </button>
        <div class="brand-block">
          <span class="brand-mark" aria-hidden="true"><MapPinned :size="22" /></span>
          <span>
            <strong>微派食集地图</strong>
            <small>B 阶段文化任务</small>
          </span>
        </div>
      </div>
      <div class="header-meta">
        <span class="test-status">
          <ShieldCheck :size="16" aria-hidden="true" />
          本地测试数据
        </span>
        <button type="button" class="header-overview" @click="showOverview">
          <LocateFixed :size="17" aria-hidden="true" />
          10 公里总览
        </button>
      </div>
    </header>

    <ShopRail
      v-model:query="searchQuery"
      :shops="railShops"
      :selected-id="selectedId"
      :search-status="searchStatus"
      :error-message="searchError"
      :collapsed="railCollapsed"
      :sort-mode="sortMode"
      @select="selectShop"
      @search="triggerImmediateSearch"
      @clear="clearSearch"
      @update:sort-mode="sortMode = $event"
    />

    <FoodMap
      ref="mapRef"
      :shops="shopViews"
      :selected-id="selectedId"
      @select="selectShop"
      @select-poi="selectPoi"
      @clear="clearSelection"
      @ready="linkUnresolvedCuratedShops"
    />

    <button
      v-if="!selectedShop"
      type="button"
      class="overview-button"
      title="返回十公里总览"
      @click="showOverview"
    >
      <LocateFixed :size="18" aria-hidden="true" />
      10 公里总览
    </button>

    <Transition name="drawer">
      <ShopDetailDrawer
        v-if="selectedShop"
        :shop="selectedShop"
        @close="closeDetail"
        @review="openReview(selectedShop.id)"
        @edit-review="editReview"
        @delete-review="deleteReview"
        @open-photo="openPhoto"
      />
    </Transition>

    <ReviewComposer
      v-if="reviewShop"
      :shop="reviewShop"
      :review="editingReview"
      @cancel="reviewShopId = null; editingReviewId = null"
      @submit="submitReview"
    />

    <PhotoLightbox
      v-if="lightbox"
      :photos="lightbox.photos"
      :index="lightbox.index"
      :label="lightbox.label"
      @close="lightbox = null"
      @change="lightbox.index = $event"
    />

    <Transition name="toast">
      <div v-if="toastMessage" class="toast-message" role="status">{{ toastMessage }}</div>
    </Transition>
  </main>
</template>
