# 微派食集地图

微派 B 阶段文化任务的地图交互原型。地图以武汉市洪山区高新大道 758 号大悦中心 T1 写字楼微派为中心，默认展示周边约 10 公里的实拍门店；搜索时通过高德 `AMap.PlaceSearch` 合并附近结果与武汉市文本检索结果，不再把餐饮类型和 10 公里半径作为硬限制。照片合集作为地图 Marker；选择商铺后可查看详情、距离、导航和两套独立评分，也可在本地添加文字、星级和照片。

## 本地运行

```bash
npm install
npm run dev
```

高德凭证放在 `.env.local`，字段参考 `.env.example`。`.env.local` 已被 Git 忽略，不应提交或公开。

## 发布到 GitHub Pages

项目已包含 `.github/workflows/deploy-pages.yml`。将代码推送到 GitHub 仓库的 `main` 分支后，Actions 会自动构建并发布页面。

1. 在 GitHub 新建一个仓库，例如 `cultural-food-map`，不要自动添加 README 或 `.gitignore`。
2. 在仓库 Settings → Secrets and variables → Actions → New repository secret 中添加 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_CODE`。
3. 在 Settings → Pages → Build and deployment 中将 Source 设为 `GitHub Actions`。
4. 等待 Actions 完成，访问 `https://<你的用户名>.github.io/<仓库名>/`。
5. 在高德控制台为 Web 端 Key 配置使用域名，加入 `<你的用户名>.github.io`，否则线上地图可能被高德拦截。

GitHub Pages 是静态托管，不能像本地 Vite 服务一样写入 `data/user-data.json` 和 `public/uploads/`。线上评价会退回浏览器 `localStorage`，只对当前浏览器保留；构建时会把仓库中的评价数据作为初始快照发布。若需要所有访问者共享新增评价和照片，需要再接入带数据库和文件存储的后端（例如 Vercel/Render + Supabase），GitHub 只负责代码和前端页面。

## 数据说明

- 默认实拍商铺位于 `src/data/shops.ts`，可编辑评价位于 `data/user-data.json`。
- 搜索输入有 260ms 防抖，停止输入后同时调用高德附近检索和武汉市文本检索，合并餐饮相关结果并按距微派的距离排序；回车可立即搜索。
- 在店铺级缩放下点击高德底图地点时，通过逆地理查询识别点击位置 45 米内最近的 POI，再读取完整详情；空白位置只移动地图。
- 总览时会把屏幕上距离过近的照片 Marker 合并并显示门店数量，放大到 16 级以上自动展开。
- 高德商铺的店名、坐标、地址、电话和照片以接口实际返回为准，部分字段可能暂无。
- “我们的评分”只由项目内评价计算，“高德参考评分”单独展示，不混为综合评分。
- 实拍榜单默认按“我们的评分”从高到低排序，可切换为距离从近到远。
- 详情顶部只显示高德 POI 返回的店铺详情照片；我们上传的照片仅用于地图 Marker、榜单缩略图和评价内容。
- 用户提交的评价和评价过的高德商铺会写入 `data/user-data.json`，照片会写入 `public/uploads/`；浏览器 `localStorage` 作为写入失败时的备份。
- 本地评价可编辑或删除，编辑时可移除已上传照片；不再被任何评价使用的本地照片会移入 `data/deleted-uploads/` 以便恢复。
- 首次启动时会把当前浏览器中已有的评价和商铺资料自动合并到本地数据文件。
- “高德参考评分”只显示高德 POI 详情实际返回的评分；手工收录且未绑定高德 POI ID 的门店，或高德未返回评分的 POI，会显示暂无。
- 实拍门店会用店名相似度和坐标距离与高德 POI 做高置信关联，关联结果持久化保存。搜索到同一家店时继续使用实拍门店 ID，因此评价、照片和高德参考评分会同时显示；距离过远的同名分店不会自动关联。
- 导航使用固定中心点“微派”作为起点，唤起高德步行导航。
- 正式上线前应接入带鉴权的服务端存储，并确认 `public/images` 中实拍照片的发布授权。

## 实拍照片

默认 6 家门店使用项目提供的 8 张实拍照片；上线前仍需确认门店、人物和图片的公开发布授权。
