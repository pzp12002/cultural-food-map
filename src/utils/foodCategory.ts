import type { Shop } from '../types'

type ShopCategoryCandidate = Pick<Shop, 'name' | 'category'>

const FOOD_KEYWORDS = [
  '餐饮', '餐厅', '中餐', '西餐', '快餐', '小吃', '烧烤', '烤肉', '火锅',
  '粤菜', '湘菜', '湖南菜', '川菜', '菜馆', '酒楼',
  '咖啡', '饮品', '茶饮', '奶茶', '甜品', '糕点', '蛋糕', '面包', '烘焙',
  '料理', '食堂', '饭店', '饭馆', '酒吧', '食品', '零食', '水果', '生鲜',
  '超市', '便利店', '面馆', '米粉', '饺子', '馄饨', '汉堡', '炸鸡',
  '猪脚', '盖饭', '炒饭', '简餐', '便当', '卤味', '鸭脖', '串串', '麻辣烫',
  '包子', '披萨', '牛排', '寿司',
  '冰淇淋', '糖水',
]

const NON_FOOD_CATEGORY_KEYWORDS = [
  '宾馆酒店', '住宿服务', '服装', '鞋帽', '美容', '美发', '医疗', '汽车',
  '金融保险', '公司企业', '政府机构', '商务住宅', '科教文化', '体育休闲',
  '家居建材', '数码电子', '生活服务',
]

export function isFoodRelatedShop(shop: ShopCategoryCandidate): boolean {
  const category = shop.category.trim()
  if (FOOD_KEYWORDS.some((keyword) => category.includes(keyword))) return true
  if (NON_FOOD_CATEGORY_KEYWORDS.some((keyword) => category.includes(keyword))) return false

  const name = shop.name.trim()
  return FOOD_KEYWORDS.some((keyword) => name.includes(keyword))
}
