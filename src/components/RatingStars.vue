<script setup lang="ts">
import { Star } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    rating: number
    size?: number
  }>(),
  {
    size: 15,
  },
)
</script>

<template>
  <span class="rating-stars" :aria-label="`${rating.toFixed(1)} 分`">
    <Star
      v-for="index in 5"
      :key="index"
      :size="size"
      :class="{ filled: index <= Math.round(rating) }"
      aria-hidden="true"
    />
  </span>
</template>
