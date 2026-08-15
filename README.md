# Infoto 📷

桌面端 / 移动端通用的**共享相册**。暗黑科技风、扁平化、无登录。照片不裁剪尺寸，瀑布流采用**列容器法**动态排列；支持多选、框选、长按；卡片预览带四向手势（左滑支持 / 右滑反对 / 下滑下载 / 上滑菜单）。

前端为单文件 `public/index.html`（零外部 CDN 依赖），后端为 Cloudflare Worker（`src/worker.js`），照片元数据存 KV，图片本体由浏览器直传图床、服务端只收**直链**。

## 功能

- **瀑布流**：列数随视口 2(手机)~6(大屏) 自适应，最短列优先，保持原图宽高比不裁剪
- **上传**：右上角图标上传图片（浏览器端按逆向协议直传图床拿直链；图床 CORS 限制时自动经 Worker 透明代理），上传即入库刷新
- **排序**：左上角胶囊「最新 / 最热」，再次点击倒序（最旧 / 最冷）
- **多选**：右上角多选图标或长按图片进入；多选模式下单击单选、桌面端拖动框选；底部批量下载 / 删除
- **卡片预览**：单击照片进入；左右滑/方向键切换；左滑=支持(❤)、右滑=反对(❌)、下滑=下载、上滑=更多菜单，滑动超阈值显示高亮图标并自动切下一张
- **更多菜单**：复制原图、复制直链、转发分享、谷歌以图搜图
- **持久化**：默认同源 Worker API（KV），单机打开（file:// 或后端不可达）自动回退 localStorage

## 本地开发

```bash
npm ci
npx wrangler dev          # 本地跑 Worker + 静态资源（默认 http://localhost:8787）
```

## 部署到 Cloudflare Workers

### 1. 配置 GitHub Secrets

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 账户 API Token（权限含 `Workers Scripts: Edit`、`Workers KV Storage: Edit`、`Account Settings: Read`） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（右栏 Account ID） |

### 2. 触发部署

- push 到 `main` 自动部署；或
- Actions 页手动 **Run workflow**

首次部署 CI 会自动创建 `PHOTOS` KV namespace 并把 id 回填到 `wrangler.toml`（已幂等，之后跳过）。

### 3. 自定义域名（可选）

```toml
# wrangler.toml 增加
routes = [
  { pattern = "photos.example.com", custom_domain = true }
]
```

## 协议说明

上传链路（前端 → 图床）：

```
浏览器: 算 SHA-256 → 生成 HS256 JWT(X-Auth-Token) → FormData{file}
   ↓ 直传被 CORS 拦截时走同源 Worker
Worker : /api/upload-proxy  → 透明转发 tc.0147258.xyz/upload
   ↓
响应  : {"data": "<直链>"}   ← 服务端只存这个直链，不碰图片二进制
```

## 目录结构

```
Infoto/
├── public/index.html        # 前端单文件
├── src/worker.js            # Cloudflare Worker（静态+API+上传代理）
├── wrangler.toml            # Worker 配置（KV 绑定）
├── .github/workflows/deploy.yml  # CI/CD
└── package.json
```
