# 首页/知识库/我的三栏移植设计

**日期**: 2026-07-03
**范围**: 将 `D:/workspace/LemonTA-main/LemonTA-main` 源项目中的 **首页 / 知识库 / 我的** 三栏（含子页）完整移植到当前项目 `D:/工程/柠檬塔/程序/LemonTA-minor`；当前项目的 `plan-list`（"我的设计"）转变为 tabBar 中的 **"设计"** 栏。

## 1. 背景与目标

源项目是一个已上线的柜体定制小程序，含 4 个 tab：首页 / 设计 / 知识库 / 我的。其中"设计"栏是柜体 3D 设计流程的入口（跳 `packageDesign/*` 子包）。当前项目 `LemonTA-minor` 是基于 Three.js 的柜体 3D 编辑分支，只有 `plan-list` + `space-setup` + `cabinet` 子包，无 tabBar。

**目标**：把源项目的 3 个非设计栏（首页/知识库/我的）搬入当前项目，同时给当前项目建立 4-tab 导航，让 `plan-list` 承担"设计"栏角色。整个移植保留当前项目已有的柜体 3D 逻辑，云开发依赖统一 Mock，页面外壳视觉上贴齐源项目（iOS 毛玻璃 + 品牌橙 `#FC9700` + HarmonyOS Sans SC 字体）。

## 2. 核心决定（问答确认）

| 主题 | 决定 |
|---|---|
| "设计"栏实现方式 | 保留当前 `plan-list` 全部功能，仅套源项目 iOS 外壳 |
| 云开发依赖 | 全部 Mock，不接云函数/云数据库/云存储 |
| 目录命名 | 保持源目录名：`pages/home`、`pages/knowledge`、`pages/profile` |
| 知识库子页 | 4 个全搬（budget/needs/inspect/image），云存储图换本地占位（缺失即无背景，功能不阻塞） |
| tabBar 图标与字体 | 全量拷入 `miniprogram/assets/`（12 个 png + 2 个 ttf） |
| 全局样式 `app.wxss` | 追加到当前 app.wxss（不覆盖原样式）；源 `.container` 重命名为 `.page-container` 避免冲突 |
| "我的"登录/编辑弹窗 | UI 保留，头像可选但不持久化，昵称写本地 storage |
| 首页 CTA | 点击后 `switchTab` 到"设计"tab（即 plan-list） |
| 背景图 T2/T3 | 走本地相对路径 `/assets/bg/*.jpg`，图缺失时页面正常渲染 |
| profile 子页 | contact/feedback/email/downloads 全部拷入，全为纯前端逻辑无需改动 |
| share.js | 保留，行为静默失败（未接云资源时不阻塞） |
| 导航栏策略 | app.json 全局开 `navigationStyle: custom`；`space-setup` 与 `cabinet/pages/{design,materials,cost}` 4 个页面各自 json 覆盖回 default；plan-list 采用 custom（因要套新外壳） |

## 3. 目录布局

```
miniprogram/
├─ app.js                     [改] 追加 globalData 静态数据 + Mock 云方法 + _loadHarmonyFonts
├─ app.json                   [改] 追加 11 个页面路径、tabBar 4 项、navigationStyle: custom
├─ app.wxss                   [改] 追加源全局 class（.container 改名为 .page-container）
├─ assets/                    [新]
│  ├─ icons/                  [新] 12 个 png（home/design/knowledge/profile 各含 -active + menu-* 4 个）
│  ├─ fonts/                  [新] HarmonyOS_Sans_SC_Thin.ttf、HarmonyOS_Sans_SC_Black.ttf
│  └─ bg/                     [新] 空目录，后续补 T2.jpg T3.jpg
├─ pages/
│  ├─ home/                   [新] home.{js,json,wxml,wxss}
│  ├─ knowledge/              [新] 主页 + detail/budget/needs/inspect 4 个子页
│  ├─ profile/                [新] 主页 + contact/feedback/email/downloads 4 个子页
│  ├─ plan-list/              [改] index.wxml/wxss 重写套新外壳；index.js 不动；index.json 保留组件引用
│  └─ space-setup/            [改] index.json 加 "navigationStyle": "default"
├─ utils/
│  ├─ assets.js               [新] 拷源
│  ├─ assets.wxs              [新] 拷源，USE_CDN 改为 false
│  ├─ share.js                [新] 拷源
│  ├─ cloud.js                [不动]
│  ├─ plan-store.js           [不动]
│  └─ …其他                    [不动]
├─ cabinet/pages/{design,materials,cost}/index.json  [改] 各自加 "navigationStyle": "default"
├─ components/                [不动]
└─ images/                    [不动]（与新 assets/ 并存）

docs/superpowers/specs/
└─ 2026-07-03-migrate-home-knowledge-profile-design.md   [新] 本 spec
```

## 4. app.json 改动

```json
{
  "pages": [
    "pages/plan-list/index",
    "pages/space-setup/index",
    "pages/home/home",
    "pages/knowledge/knowledge",
    "pages/knowledge/detail/detail",
    "pages/knowledge/budget/budget",
    "pages/knowledge/needs/needs",
    "pages/knowledge/inspect/inspect",
    "pages/profile/profile",
    "pages/profile/contact/contact",
    "pages/profile/feedback/feedback",
    "pages/profile/email/email",
    "pages/profile/downloads/downloads"
  ],
  "subPackages": [
    {
      "root": "cabinet/",
      "pages": [
        "pages/design/index",
        "pages/materials/index",
        "pages/cost/index"
      ]
    }
  ],
  "preloadRule": {
    "pages/plan-list/index": { "network": "all", "packages": ["cabinet"] }
  },
  "window": {
    "backgroundColor": "#F6F6F6",
    "backgroundTextStyle": "light",
    "navigationBarBackgroundColor": "#FFFFFF",
    "navigationBarTitleText": "LEMONTA",
    "navigationBarTextStyle": "black",
    "navigationStyle": "custom"
  },
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#FC9700",
    "backgroundColor": "#ffffff",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/home/home",         "text": "首页",   "iconPath": "assets/icons/home.png",       "selectedIconPath": "assets/icons/home-active.png" },
      { "pagePath": "pages/plan-list/index",   "text": "设计",   "iconPath": "assets/icons/design.png",     "selectedIconPath": "assets/icons/design-active.png" },
      { "pagePath": "pages/knowledge/knowledge","text": "知识库", "iconPath": "assets/icons/knowledge.png",  "selectedIconPath": "assets/icons/knowledge-active.png" },
      { "pagePath": "pages/profile/profile",   "text": "我的",   "iconPath": "assets/icons/profile.png",    "selectedIconPath": "assets/icons/profile-active.png" }
    ]
  },
  "sitemapLocation": "sitemap.json",
  "style": "v2",
  "lazyCodeLoading": "requiredComponents"
}
```

页面注册顺序中，`plan-list/index` 与 `space-setup/index` 放最前，避免主包首屏加载多余页面。

## 5. app.js 改动（Mock 策略）

追加 `globalData` 静态数据（源 app.js 第 12-72 行）：
- `tutorials`（教程数组，2 条 with sections）
- `knowledgeList`（知识库列表，4 条：budget/needs/inspect/image）
- `appConfig.downloadUrl`（保留兜底默认值，不再从云端拉取）
- `designs`（保留字段声明，Mock 环境下始终为空数组）

新增 `_loadHarmonyFonts()` 方法（原样拷源第 264-301 行），依赖 `/assets/fonts/HarmonyOS_Sans_SC_Thin.ttf` 与 `Black.ttf`；文件缺失时 `fm.copyFile` fail 只 warn，不抛异常。

`onLaunch` 简化为：
```js
onLaunch() {
  try {
    if (wx.cloud) wx.cloud.init({ env: 'cloud1-5gbuna7d27dafeba', traceUser: true });
  } catch (e) { /* 无云环境静默 */ }

  var userInfo = wx.getStorageSync('userInfo');
  if (userInfo) {
    this.globalData.userInfo = userInfo;
    this.globalData.isLoggedIn = !!userInfo.openid;
    this.globalData.openid = userInfo.openid || '';
    this.globalData.nickName = userInfo.nickName || '';
    this.globalData.avatarFileID = userInfo.avatarFileID || '';
    this.globalData.email = userInfo.email || '';
  }

  this._loadHarmonyFonts();
}
```

云调用方法降级（保留原签名与 Promise 返回类型，防止调用方链式崩溃）：

| 方法 | 降级实现 |
|---|---|
| `ensureLogin()` | `return Promise.resolve('')`（空 openid） |
| `loadUserProfile()` | `return Promise.resolve(null)` |
| `loadAppConfig()` | `return Promise.resolve(null)` |
| `saveUserProfile(patch)` | 只更新 globalData（`nickName`、`avatarFileID`）+ 写 `wx.setStorageSync('userInfo', merged)`，`return Promise.resolve({success:true})` |
| `saveUserInfo(info)` | 保留原实现（本已无云依赖） |
| `refreshDesigns()` | `return Promise.resolve([])` |
| `saveDesign(design)` | `return Promise.resolve({success:false, msg:'离线版暂不支持云端保存'})` |
| `deleteDesignById(id)` | `return Promise.resolve({success:false})` |
| `getDesignById(id)` | 保留原实现（纯内存） |

保留字段：`globalData.userInfo`、`isLoggedIn`、`openid`、`phone`、`email`、`avatarFileID`、`nickName`、`designs`、`appConfig`、`tutorials`、`knowledgeList`、`currentDesignPreview`。

## 6. app.wxss 追加

将源 `app.wxss` 第 5-340 行内容（`page` 规则之后的所有类）追加到当前 app.wxss 之后。

**唯一改动**：源 `.container` 定义（第 164-170 行）改名为 `.page-container`：
```css
.page-container {
  min-height: 100vh;
  position: relative;
  width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}
```
所有新拷入页面（home/knowledge/profile 及子页）wxml 中 `<view class="container">` 一律替换为 `<view class="page-container">`。

现有 `.container`（flex 布局，被 space-setup / cabinet 使用）保持不动。

## 7. 页面级改动

### 7.1 pages/home（新）
- 4 个文件原样拷。
- `home.js` 的 `goToDesign`：`wx.switchTab({ url: '/pages/plan-list/index' })`（源为 `/pages/design/design`）。
- `home.wxml` 中 `<view class="container">` → `<view class="page-container">`。

### 7.2 pages/knowledge（新，5 页）
- 主页 `knowledge/knowledge.*` 原样拷；wxml 中 container 改 page-container。
- 子页 4 个：`detail/`、`budget/`、`needs/`、`inspect/` 全部原样拷；wxml 中 container 改 page-container。
- 无云依赖，全部前端计算与静态文案。
- image 类型（"全屋水路图"）点击时 `wx.cloud.getTempFileURL` 会失败，源代码已有 fail Toast，行为符合预期。

### 7.3 pages/profile（新，5 页）
- 主页 `profile/profile.*` 拷入，两处修改：
  - `onCardTap`：源为 `wx.navigateTo('/packageDesign/register/register')` → 改为 `wx.showToast({ title: '登录功能开发中', icon: 'none' })`。
  - `saveProfile`：删除 `wx.cloud.uploadFile` 段落。改为：若存在 `editAvatarTemp`（wxfile 临时路径），直接把该临时路径作为 `avatarFileID` 字段值传入 `app.saveUserProfile({avatarFileID: editAvatarTemp, nickName})`。**语义上** `avatarFileID` 字段本表示云存储 fileID，此处复用同一字段承载 wxfile 临时路径 —— profile.wxml 里 `<image src="{{avatarUrl}}">` 能加载 wxfile 路径，本次会话中头像可显示；小程序重启后临时路径失效，头像回到空态、昵称仍保留（因昵称写入了 storage）。
- 子页 4 个：`contact/`、`feedback/`、`email/`、`downloads/` 全部原样拷（读源码确认均无云依赖）。
- 所有 wxml 中 container 改 page-container。

### 7.4 pages/plan-list（改）
- `index.js`：不动。
- `index.json`：保留组件引用，追加 `"navigationStyle"` **不需要**（页面 json 无需覆盖，页面继承 app.json 的 custom 即可）。
- `index.wxml` 重写，套 iOS 外壳：
  - 顶部 `<image class="bg-image bg-image-light" src="{{assets.bg('T3')}}">` 背景
  - `<view class="custom-nav">` 自定义导航栏含 "设计" 标题
  - 头部块含 eyebrow + h1-title "我的设计" + subtitle
  - "开始新设计" CTA 使用 `.btn-primary` 全局类
  - 方案列表使用 `.section-card` 卡片
  - 导出三按钮（"导出方案信息"、"导出拆单规范"、"导出方案成本"）保留在页面底部
  - 删除弹窗使用 `.modal-mask` / `.modal-content` 全局类
- `index.wxss` 重写：删除原黄色 hero 与旧样式；只保留 `.pdf-canvas` 离屏 canvas 定义（PDF 导出必需）与页面内独有的布局微调。全局 class 从 app.wxss 拿。

### 7.5 pages/space-setup（改）
- `index.json` 追加 `"navigationStyle": "default"`，其他不动。

### 7.6 cabinet/pages/{design,materials,cost}/index.json（改）
- 各自追加 `"navigationStyle": "default"`。

## 8. utils 新增

### 8.1 utils/assets.js
拷源；无云调用，导出 `getAssetPath(rel)` / `bg(name)` / `picture(sub)`。

### 8.2 utils/assets.wxs
拷源，`USE_CDN = false`。结果：
- `assets.bg('T3')` → `/assets/bg/T3.jpg`
- `assets.icon('home')` → `/assets/icons/home.png`
- `assets.picture(sub)` → `/packageDesign/picture/{sub}.png`（本项目无 packageDesign 目录，picture 若被调用会 404，但源 3 页与其子页不调 picture）

### 8.3 utils/share.js
拷源。内容为分享标题/图/路径的静态映射；`onShare`/`onTimeline` 两个方法。当前项目不接分享云资源，行为为静默返回默认对象。

## 9. 资源目录

### 9.1 assets/icons（12 个 PNG）
从源项目 `assets/icons/` 全量拷贝：
- `home.png`, `home-active.png`
- `design.png`, `design-active.png`
- `knowledge.png`, `knowledge-active.png`
- `profile.png`, `profile-active.png`
- `menu-contact.png`, `menu-download.png`, `menu-email.png`, `menu-feedback.png`

### 9.2 assets/fonts（2 个 TTF）
从源项目 `assets/fonts/` 全量拷贝：
- `HarmonyOS_Sans_SC_Thin.ttf`
- `HarmonyOS_Sans_SC_Black.ttf`

### 9.3 assets/bg（空）
建立空目录（放一个 `.gitkeep` 或 `README.txt`），后续补 T2.jpg / T3.jpg（页面缺失时正常渲染，仅无背景图）。

## 10. 错误处理原则

- 所有云调用点用 try/catch 包裹或 `.catch(() => defaultValue)` 兜底。
- 图片资源加载失败静默（wxml `wx:if` 与 `mode="aspectFill"` 已保护）。
- 首次加载 storage 无 userInfo 是正常路径 → profile 显示"未登录"卡。
- `ensureLogin()` 返回空 openid 时，profile 保持未登录外壳，符合已定策略。
- 保留源代码内已有的 `.catch(function(err) { console.warn(...); })` 结构，无需额外包装。

## 11. 验收标准

| 页面 | 判定 |
|---|---|
| 首页 | tab 切到首页 → 显示 "Hi 欢迎来到 柠檬塔定制系统" + 特性行 + CTA。点击 CTA → 切到"设计" tab。console 无阻断性报错（图片 404 忽略）。 |
| 知识库 | tab 切到知识库 → 显示 4 项列表。点柠檬🍋"柠檬塔快速预算" → budget 页。点📋 → needs 页。点✅ → inspect 页。点🗺️"全屋水路图" → Toast "图片加载失败"。 |
| 我的 | tab 切到我的 → 显示未登录卡片 + "联系我们"菜单 + 版本号。点账户卡 → Toast "登录功能开发中"。点"联系我们" → contact 子页可进入。子页 feedback/email/downloads 各自可进入且不白屏。 |
| 设计（plan-list） | tab 切到设计 → 显示 iOS 风格外壳；"开始新设计"跳 space-setup；已有方案列表可点、可删；三个导出按钮位置不变、PDF 生成链路正常。 |
| space-setup | 从 plan-list 进入，系统顶栏可见，"下一步"能进 cabinet/design。 |
| cabinet 3 页 | 3D 页面正常渲染、系统顶栏可见。 |
| 登录态测试 | `wx.setStorageSync('userInfo', {openid:'test123', nickName:'测试'})` 后重启 → profile 显示已登录卡 + 编辑按钮。点铅笔 → 弹窗打开；改昵称保存 → Toast "已保存"；重启后昵称仍是"测试"，头像若选过则回到空态。 |

## 12. YAGNI

不做：
- 不添加 CI / lint 配置
- 不写 e2e / 单测
- 不重构 cabinet 或 plan-store 内部
- 不动 cloudfunctions/
- 不接云函数 login / 云数据库 users/config/designs
- 不迁移源项目 `packageDesign/` 子包（当前项目"设计"用 plan-list + cabinet）

## 13. 风险点

- **HarmonyOS 字体**：`_loadHarmonyFonts` 依赖 `/assets/fonts/HarmonyOS_*.ttf`；文件缺失时函数 warn 但不抛，页面回退到 fallback 字体（-apple-system, PingFang SC, …），不影响布局。
- **背景图 T2/T3 缺失**：源 4 页均使用 `<image class="bg-image" src="{{assets.bg('T2/T3')}}">`。缺失时 image 显示为空，父容器已定尺寸，不影响布局。
- **wx.cloud 未 init 时的调用**：现有 `plan-list/index.js` require `utils/cloud.js` 调 `cloud.listPlans()`；`wx.cloud.init` 用 try/catch 包裹后失败会导致 `wx.cloud.callFunction` 抛 "wx.cloud is uninitialized"，但 `plan-list/index.js` 已有 `if (res.ok && ...)` 保护，忽略即可。
- **`packageDesign/*` 路径引用**：源 profile.js `onCardTap` 指向 `/packageDesign/register/register`，已改 Toast；源 assets.js/wxs 的 `picture()` 走 `/packageDesign/picture/*`，但本次移植的 4 页均不调 `assets.picture`，无实际影响。
- **plan-list wxml 重写风险**：既有 4 个 modal 组件（`plan-select-modal` / `filename-input-modal` / `cabinet-toast`）与离屏 `pdf-canvas` 必须保留原样，仅外层容器与列表卡片重写。

