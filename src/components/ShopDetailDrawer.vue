<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Clock3,
  Database,
  Images,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Pencil,
  Phone,
  Route,
  Star,
  Trash2,
  WalletCards,
  X,
} from 'lucide-vue-next'
import type { Review, ShopView } from '../types'
import RatingStars from './RatingStars.vue'
import { MAP_CENTER } from '../data/shops'
import { formatDistance } from '../utils/geo'

const props = defineProps<{
  shop: ShopView
}>()

const emit = defineEmits<{
  close: []
  review: []
  editReview: [reviewId: string]
  deleteReview: [reviewId: string]
  openPhoto: [photos: string[], index: number, label: string]
}>()

const detailPhotos = computed(() => [...new Set(props.shop.gallery)])
const confirmDeleteId = ref<string | null>(null)

const navigationUrl = computed(() => {
  const parameters = new URLSearchParams({
    from: `${MAP_CENTER[0]},${MAP_CENTER[1]},微派`,
    to: `${props.shop.longitude},${props.shop.latitude},${props.shop.name}`,
    mode: 'walk',
    policy: '1',
    src: 'micro-food-map',
    coordinate: 'gaode',
    callnative: '1',
  })
  return `https://uri.amap.com/navigation?${parameters.toString()}`
})

function openDetailPhoto(src: string) {
  const index = detailPhotos.value.indexOf(src)
  emit('openPhoto', detailPhotos.value, Math.max(index, 0), props.shop.name)
}

function openReviewPhoto(review: Review, src: string) {
  const index = review.photos.indexOf(src)
  emit('openPhoto', review.photos, Math.max(index, 0), `${props.shop.name} · ${review.author}的评价`)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}
</script>

<template>
  <aside class="detail-drawer" aria-label="商铺详情">
    <header class="drawer-header">
      <div>
        <span class="eyebrow">{{ shop.category }}</span>
        <h2>{{ shop.name }}</h2>
      </div>
      <button type="button" class="icon-button" title="关闭详情" aria-label="关闭详情" @click="emit('close')">
        <X :size="20" aria-hidden="true" />
      </button>
    </header>

    <div class="drawer-scroll">
      <button
        v-if="detailPhotos.length"
        type="button"
        class="detail-cover"
        aria-label="查看商铺照片合集"
        @click="openDetailPhoto(detailPhotos[0])"
      >
        <img :src="detailPhotos[0]" :alt="`${shop.name}主图`" />
        <span class="photo-count">
          <Images :size="16" aria-hidden="true" />
          {{ detailPhotos.length }}
        </span>
      </button>

      <div v-else class="detail-photo-empty">
        <Images :size="24" aria-hidden="true" />
        <span>高德暂无店铺详情照片</span>
      </div>

      <div v-if="detailPhotos.length > 1" class="photo-strip" aria-label="商铺照片">
        <button
          v-for="photo in detailPhotos.slice(1, 6)"
          :key="photo"
          type="button"
          @click="openDetailPhoto(photo)"
        >
          <img :src="photo" :alt="`${shop.name}照片`" />
        </button>
      </div>

      <section class="rating-summary" aria-label="评分概览">
        <div class="rating-source-card is-community">
          <span>我们的评分</span>
          <strong>{{ shop.communityRating ? shop.communityRating.toFixed(1) : '--' }}</strong>
          <RatingStars v-if="shop.communityRating" :rating="shop.communityRating" :size="14" />
          <small>{{ shop.reviewCount ? `${shop.reviewCount} 条到店评价` : '等待第一条评价' }}</small>
        </div>
        <div class="rating-source-card is-amap">
          <span>高德参考评分</span>
          <strong>{{ shop.amapRating ? shop.amapRating.toFixed(1) : '--' }}</strong>
          <RatingStars v-if="shop.amapRating" :rating="shop.amapRating" :size="14" />
          <small>{{ shop.amapRating ? '来自高德地图' : '高德暂无评分' }}</small>
        </div>
        <button type="button" class="primary-button" @click="emit('review')">
          <MessageSquarePlus :size="18" aria-hidden="true" />
          写评价
        </button>
      </section>

      <section class="detail-section shop-facts">
        <div class="detail-section-heading">
          <h3>商铺详情</h3>
          <a
            class="navigation-button"
            :href="navigationUrl"
            target="_blank"
            rel="noopener noreferrer"
            title="使用高德地图步行导航"
          >
            <Navigation :size="16" aria-hidden="true" />
            去这里
          </a>
        </div>
        <p>{{ shop.summary }}</p>
        <dl>
          <div>
            <dt><Route :size="17" aria-hidden="true" />距离</dt>
            <dd>距微派约 {{ formatDistance(shop.distanceMeters) }}</dd>
          </div>
          <div>
            <dt><MapPin :size="17" aria-hidden="true" />地址</dt>
            <dd>{{ shop.address }}</dd>
          </div>
          <div>
            <dt><Clock3 :size="17" aria-hidden="true" />营业</dt>
            <dd>{{ shop.businessHours }}</dd>
          </div>
          <div>
            <dt><WalletCards :size="17" aria-hidden="true" />人均</dt>
            <dd>{{ shop.averagePrice ? `¥${shop.averagePrice}` : '暂无' }}</dd>
          </div>
          <div v-if="shop.telephone">
            <dt><Phone :size="17" aria-hidden="true" />电话</dt>
            <dd><a :href="`tel:${shop.telephone}`">{{ shop.telephone }}</a></dd>
          </div>
          <div>
            <dt><Database :size="17" aria-hidden="true" />来源</dt>
            <dd>{{ shop.source === 'amap' ? '高德地图 POI' : '微派实拍门店' }}</dd>
          </div>
        </dl>
        <div v-if="shop.signatureDishes.length" class="dish-tags" aria-label="招牌菜">
          <span v-for="dish in shop.signatureDishes" :key="dish">{{ dish }}</span>
        </div>
      </section>

      <section class="detail-section review-section">
        <div class="section-heading">
          <h3>到店评价</h3>
          <span>{{ shop.reviewCount }} 条</span>
        </div>

        <div class="review-list">
          <article v-for="review in shop.reviews" :key="review.id" class="review-item">
            <header>
              <span class="review-avatar" aria-hidden="true">{{ review.author.slice(0, 1) }}</span>
              <span class="review-author">
                <strong>{{ review.author }}</strong>
                <span>
                  <RatingStars :rating="review.rating" :size="12" />
                  {{ formatDate(review.createdAt) }}
                </span>
              </span>
              <span v-if="review.isLocal" class="review-actions">
                <button
                  type="button"
                  title="编辑评价"
                  aria-label="编辑评价"
                  @click="emit('editReview', review.id)"
                >
                  <Pencil :size="14" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="删除评价"
                  aria-label="删除评价"
                  @click="confirmDeleteId = review.id"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </span>
            </header>
            <p>{{ review.content }}</p>
            <div v-if="review.photos.length" class="review-photos">
              <button
                v-for="photo in review.photos"
                :key="photo"
                type="button"
                @click="openReviewPhoto(review, photo)"
              >
                <img :src="photo" :alt="`${review.author}上传的评价照片`" />
              </button>
            </div>
            <div v-if="confirmDeleteId === review.id" class="review-delete-confirm" role="alert">
              <span>删除这条评价及其上传照片？</span>
              <button type="button" @click="confirmDeleteId = null">取消</button>
              <button
                type="button"
                class="is-danger"
                @click="emit('deleteReview', review.id); confirmDeleteId = null"
              >
                删除
              </button>
            </div>
          </article>
        </div>

        <button type="button" class="review-empty-action" @click="emit('review')">
          <Star :size="18" aria-hidden="true" />
          添加我的评价
        </button>
      </section>
    </div>
  </aside>
</template>
