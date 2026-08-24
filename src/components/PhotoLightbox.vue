<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'

const props = defineProps<{
  photos: string[]
  index: number
  label: string
}>()

const emit = defineEmits<{
  close: []
  change: [index: number]
}>()

function previous() {
  emit('change', (props.index - 1 + props.photos.length) % props.photos.length)
}

function next() {
  emit('change', (props.index + 1) % props.photos.length)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') previous()
  if (event.key === 'ArrowRight') next()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="lightbox" role="dialog" aria-modal="true" :aria-label="`${label}照片预览`">
      <header>
        <strong>{{ label }}</strong>
        <span>{{ index + 1 }} / {{ photos.length }}</span>
        <button type="button" class="lightbox-icon" title="关闭预览" aria-label="关闭预览" @click="emit('close')">
          <X :size="23" aria-hidden="true" />
        </button>
      </header>
      <div class="lightbox-stage" @click.self="emit('close')">
        <button
          v-if="photos.length > 1"
          type="button"
          class="lightbox-icon previous"
          title="上一张"
          aria-label="上一张"
          @click="previous"
        >
          <ChevronLeft :size="30" aria-hidden="true" />
        </button>
        <img :src="photos[index]" :alt="`${label}第 ${index + 1} 张照片`" />
        <button
          v-if="photos.length > 1"
          type="button"
          class="lightbox-icon next"
          title="下一张"
          aria-label="下一张"
          @click="next"
        >
          <ChevronRight :size="30" aria-hidden="true" />
        </button>
      </div>
      <div v-if="photos.length > 1" class="lightbox-thumbnails">
        <button
          v-for="(photo, photoIndex) in photos"
          :key="`${photo}-${photoIndex}`"
          type="button"
          :class="{ 'is-current': photoIndex === index }"
          :aria-label="`查看第 ${photoIndex + 1} 张照片`"
          @click="emit('change', photoIndex)"
        >
          <img :src="photo" alt="" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
