export interface Shop {
  id: string
  source?: 'curated' | 'amap'
  amapId?: string
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
  floorLevel?: number
  floorLabel?: string
  gallery: string[]
}

export interface Review {
  id: string
  shopId: string
  author: string
  rating: number
  content: string
  photos: string[]
  createdAt: string
  isLocal?: boolean
}

export interface ShopView extends Shop {
  communityRating: number | null
  amapRating: number | null
  displayRating: number | null
  reviewCount: number
  markerPhotos: string[]
  reviews: Review[]
}

export interface ReviewDraft {
  author: string
  rating: number
  content: string
  photos: string[]
}
