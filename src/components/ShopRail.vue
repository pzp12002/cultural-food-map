<script setup lang="ts">
import {
  AlertTriangle,
  ChevronRight,
  LoaderCircle,
  ImageOff,
  MapPin,
  Search,
  SearchX,
  Star,
  X,
} from 'lucide-vue-next'
import type { ShopView } from '../types'
import { formatDistance } from '../utils/geo'

defineProps<{
  shops: ShopView[]
  selectedId: string | null
  query: string
  searchStatus: 'idle' | 'loading' | 'success' | 'empty' | 'error'
  errorMessage: string
  collapsed: boolean
  sortMode: 'rating' | 'distance'
}>()

const emit = defineEmits<{
  select: [shopId: string]
  'update:query': [query: string]
  search: []
  clear: []
  'update:sortMode': [mode: 'rating' | 'distance']
}>()

function updateQuery(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <aside
    class="shop-rail"
    aria-label="商铺列表"
    :aria-hidden="collapsed"
    :inert="collapsed"
  >
    <div class="rail-toolbar">
      <div class="rail-heading">
        <div>
          <span class="eyebrow">{{ searchStatus === 'idle' ? '10 公里内' : '高德店铺搜索' }}</span>
          <h2>微派周边</h2>
        </div>
        <span class="shop-count">
          {{ searchStatus === 'loading' ? '搜索中' : `${shops.length} 家` }}
        </span>
      </div>

      <div class="rail-controls">
        <form class="shop-search" role="search" @submit.prevent="emit('search')">
          <input
            type="search"
            :value="query"
            autocomplete="off"
            aria-label="搜索周边店铺"
            @input="updateQuery"
            @keydown.esc="emit('clear')"
          />
          <button
            v-if="query"
            type="button"
            title="清空搜索"
            aria-label="清空搜索"
            @click="emit('clear')"
          >
            <X :size="15" aria-hidden="true" />
          </button>
          <button
            type="submit"
            class="search-submit"
            title="立即搜索"
            aria-label="立即搜索"
            :disabled="!query.trim()"
          >
            <LoaderCircle
              v-if="searchStatus === 'loading'"
              class="spin"
              :size="16"
              aria-hidden="true"
            />
            <Search v-else :size="16" aria-hidden="true" />
          </button>
        </form>

        <div v-if="searchStatus === 'idle'" class="rail-sort" role="group" aria-label="榜单排序">
          <button
            type="button"
            :class="{ 'is-active': sortMode === 'rating' }"
            :aria-pressed="sortMode === 'rating'"
            title="按我们的评分排序"
            @click="emit('update:sortMode', 'rating')"
          >
            <Star :size="14" aria-hidden="true" />
            <span>评分</span>
          </button>
          <button
            type="button"
            :class="{ 'is-active': sortMode === 'distance' }"
            :aria-pressed="sortMode === 'distance'"
            title="按距离排序"
            @click="emit('update:sortMode', 'distance')"
          >
            <MapPin :size="14" aria-hidden="true" />
            <span>距离</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="shops.length && searchStatus !== 'loading'" class="shop-list">
      <button
        v-for="shop in shops"
        :key="shop.id"
        type="button"
        class="shop-list-item"
        :class="{ 'is-selected': selectedId === shop.id }"
        @click="emit('select', shop.id)"
      >
        <img
          v-if="shop.markerPhotos[0]"
          :src="shop.markerPhotos[0]"
          :alt="`${shop.name}评价照片`"
        />
        <span v-else class="shop-list-photo-empty" aria-hidden="true">
          <ImageOff :size="22" />
        </span>
        <span class="shop-list-copy">
          <span class="shop-list-title">
            <strong>{{ shop.name }}</strong>
            <span>{{ shop.category }}</span>
          </span>
          <span class="shop-list-rating">
            <span v-if="shop.communityRating" class="rating-chip is-community">
              我们的 {{ shop.communityRating.toFixed(1) }} · {{ shop.reviewCount }} 条
            </span>
            <span v-if="shop.amapRating" class="rating-chip is-amap">
              高德 {{ shop.amapRating.toFixed(1) }}
            </span>
            <span v-if="!shop.communityRating && !shop.amapRating">暂无评分</span>
          </span>
          <span class="shop-list-address">
            <MapPin :size="13" aria-hidden="true" />
            {{ formatDistance(shop.distanceMeters) }} · {{ shop.address }}
          </span>
        </span>
        <ChevronRight class="row-arrow" :size="17" aria-hidden="true" />
      </button>
    </div>

    <div v-else-if="searchStatus === 'loading'" class="shop-empty" role="status">
      <LoaderCircle class="spin" :size="22" aria-hidden="true" />
      <strong>正在搜索高德店铺</strong>
    </div>

    <div v-else-if="searchStatus === 'error'" class="shop-empty shop-search-error" role="alert">
      <AlertTriangle :size="22" aria-hidden="true" />
      <strong>搜索暂时不可用</strong>
      <span>{{ errorMessage }}</span>
      <button type="button" @click="emit('search')">重新搜索</button>
    </div>

    <div v-else class="shop-empty" role="status">
      <SearchX :size="22" aria-hidden="true" />
      <strong>没有找到相关店铺</strong>
      <button type="button" @click="emit('clear')">查看实拍门店</button>
    </div>
  </aside>
</template>
