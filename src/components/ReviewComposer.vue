<script setup lang="ts">
import { ref } from 'vue'
import { ImagePlus, LoaderCircle, Star, Trash2, X } from 'lucide-vue-next'
import { compressPhoto } from '../services/reviewStorage'
import type { Review, ReviewDraft, ShopView } from '../types'

const props = defineProps<{
  shop: ShopView
  review?: Review | null
}>()

const emit = defineEmits<{
  cancel: []
  submit: [draft: ReviewDraft]
}>()

const rating = ref(props.review?.rating ?? 0)
const hoverRating = ref(0)
const author = ref(props.review?.author ?? '访客')
const content = ref(props.review?.content ?? '')
const photos = ref<string[]>([...(props.review?.photos ?? [])])
const processing = ref(false)
const errorMessage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return

  const room = 6 - photos.value.length
  if (room <= 0) {
    errorMessage.value = '最多添加 6 张照片。'
    return
  }

  processing.value = true
  errorMessage.value = ''
  try {
    const nextPhotos = await Promise.all(files.slice(0, room).map(compressPhoto))
    photos.value.push(...nextPhotos)
    if (files.length > room) errorMessage.value = '已保留前 6 张照片。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '照片处理失败。'
  } finally {
    processing.value = false
  }
}

function removePhoto(index: number) {
  photos.value.splice(index, 1)
}

function submitReview() {
  errorMessage.value = ''
  if (!Number.isFinite(rating.value) || rating.value < 1 || rating.value > 5) {
    errorMessage.value = '请输入 1.0 至 5.0 之间的评分。'
    return
  }
  if (!content.value.trim()) {
    errorMessage.value = '请填写评价内容。'
    return
  }
  emit('submit', {
    author: author.value,
    rating: rating.value,
    content: content.value,
    photos: photos.value,
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('cancel')">
      <section class="review-modal" role="dialog" aria-modal="true" :aria-label="`评价${shop.name}`">
        <header class="modal-header">
          <div>
            <span class="eyebrow">{{ review ? '编辑评价' : '到店评价' }}</span>
            <h2>{{ shop.name }}</h2>
          </div>
          <button type="button" class="icon-button" title="关闭" aria-label="关闭评价" @click="emit('cancel')">
            <X :size="20" aria-hidden="true" />
          </button>
        </header>

        <form @submit.prevent="submitReview">
          <fieldset class="rating-fieldset">
            <legend>评分</legend>
            <div class="rating-picker" @mouseleave="hoverRating = 0">
              <button
                v-for="value in 5"
                :key="value"
                type="button"
                :aria-label="`${value} 星`"
                :title="`${value} 星`"
                @mouseenter="hoverRating = value"
                @focus="hoverRating = value"
                @blur="hoverRating = 0"
                @click="rating = value"
              >
                <Star
                  :size="28"
                  :class="{ filled: value <= (hoverRating || rating) }"
                  aria-hidden="true"
                />
              </button>
              <input
                v-model.number="rating"
                class="rating-number"
                type="number"
                min="1"
                max="5"
                step="0.1"
                aria-label="评分数值"
              />
            </div>
          </fieldset>

          <label class="form-field">
            <span>称呼</span>
            <input v-model="author" maxlength="12" autocomplete="nickname" />
          </label>

          <label class="form-field">
            <span>评价</span>
            <textarea
              v-model="content"
              maxlength="300"
              rows="5"
              placeholder="记录味道、环境和你愿意再次到访的理由"
            />
            <small>{{ content.length }}/300</small>
          </label>

          <div class="photo-upload-section">
            <div class="form-label-row">
              <span>照片</span>
              <small>{{ photos.length }}/6</small>
            </div>
            <div class="upload-grid">
              <div v-for="(photo, index) in photos" :key="photo" class="upload-preview">
                <img :src="photo" alt="待上传评价照片" />
                <button
                  type="button"
                  class="remove-photo-button"
                  :aria-label="`删除第 ${index + 1} 张照片`"
                  title="删除照片"
                  @click="removePhoto(index)"
                >
                  <Trash2 :size="15" aria-hidden="true" />
                </button>
              </div>
              <button
                v-if="photos.length < 6"
                type="button"
                class="upload-button"
                :disabled="processing"
                @click="fileInput?.click()"
              >
                <LoaderCircle v-if="processing" class="spin" :size="22" aria-hidden="true" />
                <ImagePlus v-else :size="22" aria-hidden="true" />
                <span>{{ processing ? '处理中' : '添加照片' }}</span>
              </button>
            </div>
            <input
              ref="fileInput"
              class="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              @change="handleFiles"
            />
          </div>

          <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>

          <footer class="modal-actions">
            <button type="button" class="secondary-button" @click="emit('cancel')">取消</button>
            <button type="submit" class="primary-button" :disabled="processing">
              {{ review ? '保存修改' : '发布评价' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
