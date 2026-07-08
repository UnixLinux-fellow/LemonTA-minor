# 登录/注册对齐 LemonTA-main、设计方案全面上云 设计方案

日期：2026-07-08
状态：待实施

## 一句话摘要

**登录/注册模块 100% 与 LemonTA-main 一致**（代码逐字段拷贝）；设计方案的存储范式改为"小程序端直连云数据库 `designs` 集合 + 云存储 fileID"，与 main 同款；minor 独有的所有字段（`wireframeFileID / photoFileID / materials / cabinets / layout` 等）作为 schema 并集全部上云。图片与设计文档在读路径统一走"内存 → 本地缓存 → 云端"三层回退，任何请求先命中本地就不打云。

## 背景

当前 LemonTA-minor（分支 `feat/migrate-3-tabs`，起点 `127a424`）里：

- 登录链路是空壳：`app.ensureLogin` 直接 `Promise.resolve('')`，`loadUserProfile / saveUserProfile / loadAppConfig` 全是 Mock；`packageDesign/register` 页整个不存在；`profile.onCardTap` 只弹一个"登录功能开发中"toast。云函数 `cloudfunctions/login/index.js` 是完整可用的，但小程序端从不调用它。
- 设计方案存储是"本地 `wx.storage.PLAN_LIST` 主库 + 云函数 `quickstartFunctions.savePlan/saveMaterials/listPlans` 旁挂"，云端集合 `lemonta_plans` 因前端从不回填 `_id` 会累积重复文档。图片（`previewImage / wireframeImage / photoPath`）全是 `wxfile://` 临时路径，重启即失效。
- 对比 LemonTA-main：登录用 `wx.cloud.callFunction({ name: 'login' })` 拿 openid，用户资料写 `users` 集合，头像走 `wx.cloud.uploadFile` 存 fileID；设计方案直连 `designs` 集合，预览图存 `previewFileID`。

本方案的目标是把 minor 一次性对齐到 main 的存储范式，同时保留 minor 已经跑通的业务字段（布局/柜体/材质/带编号线框图/墙面照片）。

## 目标

- **登录/注册模块与 LemonTA-main 100% 一致**：代码逐段拷贝，行为、时序、字段、异常处理、UI 全同款。以后合并回主仓零 diff。
- 设计方案改为"小程序端直连 `wx.cloud.database().collection('designs')`"，享用 `_openid` 自动隔离，与 main 一致。
- minor 独有的所有字段全部上云；三张图（3D 效果图 / 带编号线框图 / 墙面照片）全部 `wx.cloud.uploadFile` 存 fileID。
- 所有对象的读路径统一走"内存 → 本地缓存 → 云端"，写路径永远先写云、云成功后回填两层；不做本地→云的反向 flush。
- 保留 `cloudfunctions/quickstartFunctions` 用于服务端上下文任务（`requestDownload / listCabinetModels / listHardwareFittings / getModelInfo`），基本 CRUD（savePlan / saveMaterials / listPlans）前端下线。
- PDF 导出功能（导出方案信息、导出方案成本）在 fileID 时代继续可用；导出拆单规范完全不动。

## 非目标

- **不迁移旧数据**：`wx.storage.PLAN_LIST` 首次启动时一次性清理，云端 `lemonta_plans` 不动、自然废弃。
- **不改 `pdf-exporter.js` 内部渲染逻辑**：仅在 `plan-list.js` 的两个导出 handler 里加一层前置图片解析。
- **不改 `hardware-pdf-cloud.js`**：拆单规范导出跟 plan 数据无关。
- **不动 `cloudfunctions/login` / `cloudfunctions/quickstartFunctions` 云函数代码**：前端不再调用 `savePlan / saveMaterials / listPlans` 分支，但代码保留。
- **不做后台预热**：图片按需缓存，用户没导出过的 plan 不预下载。
- **不加 TTL**：fileID 在云存储对象生命周期内不会变，本地缓存仅在文件被清理时失效。
- **不做验证码 / 双因素 / 手机号登录**：main 是纯 openid 一键登录，本方案严格对齐。

## 架构总览

```
[小程序端]
├── app.js
│   ├── ensureLogin() ─────────────────► 云函数 login (整段拷贝 main)
│   ├── loadUserProfile() ─────────────► db.collection('users')
│   ├── saveUserProfile(patch) ────────► db.collection('users').upsert
│   ├── loadAppConfig() ───────────────► db.collection('config')
│   ├── refreshDesigns() ──────────────► db.collection('designs') + 回填缓存
│   ├── saveDesign(design) ────────────► designs.add / doc.update
│   ├── deleteDesignById(id) ──────────► deleteFile + doc.remove + 清 IMG_CACHE
│   ├── getDesignById(id) ─────────────► 从 globalData.designs 内存查
│   └── saveUserInfo(info) ────────────► 内存 + storage.userInfo
│
├── packageDesign/register/*.{js,wxml,wxss,json}  ← 整目录拷贝 main
│
├── app.json ─────────────────────────► 新增 packageDesign 分包 + preloadRule
│
├── pages/plan-list/index.js ─────────► 数据源改 globalData.designs;
│                                       两个导出加 _resolvePlanImages 前置;
│                                       删除走 app.deleteDesignById;
│                                       导出拆单规范一行不动
│
├── pages/profile/profile.js ─────────► onCardTap 跳注册页;
│                                       saveProfile 加 uploadFile 头像上传;
│                                       其他与 main 一致
│
├── cabinet/pages/design/index.js ────► onConfirmLayout 上传 3 张图 + saveDesign
├── cabinet/pages/materials/index.js ─► onCalc: saveDesign 更新 materials
├── cabinet/pages/cost/index.js ──────► 烘完带编号线框图 → uploadFile → saveDesign
│
└── utils/
    ├── img-cache.js ────────────────► 【新】fileID ↔ 本地路径缓存
    ├── plan-store.js ───────────────► 只保留 makeId/timestamp/timestampSec/photoName
    ├── cloud.js ────────────────────► 保留 requestDownload/listCabinetModels/
    │                                   listHardwareFittings/getModelInfo,下线其余
    ├── pdf-exporter.js ─────────────► 【不动】
    └── hardware-pdf-cloud.js ───────► 【不动】

[云端]
├── cloudfunctions/login/ ────────────► 【不动】(与 main 完全一致)
├── cloudfunctions/quickstartFunctions/ ► 【不动】(前端不再调 savePlan 类分支)
├── db.collection('designs') ────────► 主库,权限"仅创建者可读写"
├── db.collection('users') ──────────► main 已有(权限同上)
├── db.collection('config') ─────────► main 已有(权限"所有用户可读,仅创建者可读写")
└── cloud storage
    ├── avatars/{openid}_{ts}.{ext}
    └── designs/{planId}_{ts}_(preview|wire|photo).{png|jpg}
```

## 登录/注册模块 — 与 LemonTA-main 逐位一致声明

以下位面**代码逐字段拷贝自 LemonTA-main**，本方案不做任何修改、增强或简化。以后合并回主仓时，这些位面预期字节级 diff 为空（除路径调整外）。

| 位面 | 与 main 关系 |
|---|---|
| `app.js.globalData` 里 `userInfo / isLoggedIn / openid / phone / email / avatarFileID / nickName` 字段 | 拷贝 |
| `app.js.ensureLogin()`（含并发锁 `_loginPromise`、失败清空重试） | 拷贝 |
| `app.js.loadUserProfile()`（读 `users` 集合） | 拷贝 |
| `app.js.saveUserProfile(patch)`（`users` 集合 upsert + 回写内存/storage） | 拷贝 |
| `app.js.saveUserInfo(info)`（本地合并写 userInfo） | 拷贝 |
| `app.js.loadAppConfig()`（读 `config` 集合，回退 globalData.appConfig 默认值） | 拷贝 |
| `app.js.onLaunch` 恢复 `wx.getStorageSync('userInfo')` 到 globalData 那段 | 拷贝 |
| `app.js.onLaunch` 的 `ensureLogin → loadUserProfile → loadAppConfig → refreshDesigns` 启动链路 | 拷贝 |
| `cloudfunctions/login/index.js` | 两边本来就相同，不动 |
| `packageDesign/register/register.{js,wxml,wxss,json}` | 整目录拷贝，不改一行 |
| `app.json` 里 `packageDesign` 分包声明 + `preloadRule` | 拷贝 |
| `pages/profile/profile.js.onCardTap` → `wx.navigateTo('/packageDesign/register/register')` | 拷贝 |
| `pages/profile/profile.js.saveProfile`（临时头像 → `wx.cloud.uploadFile` → `saveUserProfile`） | 拷贝 |
| `pages/profile/profile.js._syncLoginState` 及其他 handlers | minor 现状与 main 已一致，不动 |

**关于启动链路的一处微差异**：`app.onLaunch` 在 `wx.cloud.init` 与 `ensureLogin` 之间会新增两小步——恢复 `DESIGNS_CACHE` 到 `globalData.designs`（用于秒渲），以及一次性清理旧 `PLAN_LIST` 键。这两步归属"设计存储缓存/迁移"域，不修改任何登录/注册相关字段与时序，登录/注册的行为不受影响。

## 数据模型

### 云端 `designs` 集合 schema（main + minor 并集）

```jsonc
{
  "_id":       "…",                       // 云端自动生成
  "_openid":   "…",                       // 云端自动注入，权限自动隔离

  // ─── 身份 & 时间(与 main 一致) ──────
  "id":            "p_1704628800_123",    // minor 客户端稳定 id，供去重
  "name":          "客厅衣柜",
  "createTime":    ServerDate,
  "updateTime":    ServerDate,

  // ─── 墙面基本信息 ────────────────
  "wall":          { "w": 300, "h": 260, "d": 150 },
  "cornerType":    "WZJ",                 // WZJ|ZZJ|YZJ|ZYZJ
  "cornerLabel":   "无转角",
  "hasRaise":      false,

  // ─── 布局与柜体(minor 独有,全上云) ─
  "layout":            { "items": [...], "meta": {...} },
  "layoutSerialized":  "…",
  "cabinets":          [ { "kind": "…", "width": …, ... }, ... ],
  "cabinetCount":      5,
  "planFullName":      "guest-2604070900-客厅衣柜-WZJ-H-260-W-300",
  "timestamp":         "2604070900",

  // ─── 材质(minor 独有) ─────────────
  "materials": {
    "panel": "…", "doorPanel": "…", "doorCraft": "…",
    "hardware": "…", "lighting": "…"
  },

  // ─── 显示态(minor 独有) ───────────
  "color":     "…",
  "showDoor":  true,

  // ─── 图片 fileID(全部上云) ──────
  "photoFileID":       "cloud://…/designs/xxx_photo.jpg",
  "previewFileID":     "cloud://…/designs/xxx_preview.png",
  "wireframeFileID":   "cloud://…/designs/xxx_wire.png",
  "wireframeHasLabels": true              // 前端做懒烘的门闸
}
```

**兼容原则**：读端统一 `plan.wall || {}`、`plan.materials || {}` 兜底（现有 `pdf-exporter.js` 已如此）；`previewFileID / wireframeFileID / photoFileID` 缺失时渲染层显示占位（"无预览" / "无照片"），不报错。

### 本地缓存 schema

```jsonc
// wx.storage.DESIGNS_CACHE
{
  "savedAt": 1741123456789,
  "openid":  "…",                         // 防串号：切账号后自动作废
  "data":    [ /* designs 文档数组，与云端 raw 一致 */ ]
}

// wx.storage.IMG_CACHE
{
  "cloud://…/designs/xxx_preview.png": {
    "path":     "wxfile://usr/img-cache/e1b3c9….png",
    "size":     123456,
    "lastUsed": 1741123456789
  }
}

// wx.storage.userInfo(与 main 一致，不动)
{
  "openid":       "…",
  "loginTime":    "2026-07-08T...",
  "registerTime": "2026-07-08T...",
  "avatarFileID": "cloud://…",
  "nickName":     "…"
}
```

## 三层读取 & 单向写入策略

**读路径**：内存 (`globalData`) → 本地存储 (`wx.storage`) → 云端。命中即返回，未命中打云并回填两层。

**写路径**：先写云；云成功后回填内存 + 本地。不做本地→云的反向 flush，避免脑裂。

| 对象 | 内存层 | 本地缓存 | 云权威源 | 失效条件 |
|---|---|---|---|---|
| 设计文档 | `globalData.designs` | `wx.storage.DESIGNS_CACHE` | `db.collection('designs')` | 无 TTL；`cache.openid !== 当前 openid` 时整体丢弃 |
| 用户资料 | `globalData.userInfo` 等 | `wx.storage.userInfo` | `db.collection('users')` | 与 main 同：成功保存即覆盖两层 |
| 图片 fileID→本地路径 | 会话内 Map（可选，或直接读 storage） | `wx.storage.IMG_CACHE` + `USER_DATA_PATH/img-cache/{md5(fileID)}.{ext}` | 云存储（通过 `getTempFileURL + downloadFile`） | 仅当 `fm.accessSync` 判定本地文件不存在时 |

**图片缓存补充**：

- **保存时登记**（uploadFile 成功后立刻做，命中率最高）：把上传前的 `wxfile://` 临时文件用 `fm.saveFile` 提升到 `img-cache/`，写 `IMG_CACHE[fileID] = savedPath`。避免刚保存完立刻导出还得再下一次云。
- **导出时兜底**：未命中时才走 `getTempFileURL + downloadFile + fm.saveFile`，写入缓存。
- **淘汰**：LRU 100 张 / 30 MB 上限，先触发者生效。超限时删最久未用条目 + 对应本地文件。

## 数据流（按场景）

### 3.1 冷启动

**目的**：小程序启动瞬间从本地缓存拉起登录态和设计列表，用户看到的第一屏就是有内容的，云端数据在后台异步覆盖。

**流程（箭头链）**：

```
wx.cloud.init(env)
        │
        ▼
storage.userInfo ──► globalData.userInfo/openid/nickName/…   （登录态秒恢复）
        │
        ▼
storage.DESIGNS_CACHE ──► globalData.designs   （列表秒填，UI 立即可渲染）
        │
        ▼
清理旧 storage.PLAN_LIST   （一次性迁移，忽略结果）
        │
        ▼
ensureLogin()
   ├─ 成功 ──► loadUserProfile ──► loadAppConfig ──► refreshDesigns
   │                                                      │
   │                                                      ▼
   │                              globalData.designs & DESIGNS_CACHE 被云端数据覆盖
   │
   └─ 失败 ──► loadAppConfig + refreshDesigns（静默，保持本地兜底显示）
        │
        ▼
加载 HarmonyOS 字体（并行，不阻塞上面链路）
```

**详细步骤**：

1. `wx.cloud.init({ env, traceUser: true })`（与 main 一致）。
2. 恢复 `storage.userInfo` 到 `globalData`（与 main 一致）——登录态刷新后仍然存在。
3. 【新】恢复 `storage.DESIGNS_CACHE.data` 到 `globalData.designs`；同时校验 `cache.openid` 与当前 openid 一致，不一致则丢弃。
4. 【新】一次性清理旧键 `PLAN_LIST`（`wx.removeStorageSync`），仅第一次升级后生效。
5. `ensureLogin() → loadUserProfile → loadAppConfig → refreshDesigns`（与 main 一致）；失败分支 `loadAppConfig + refreshDesigns` 静默。
6. `_loadHarmonyFonts()`（与 main 一致）。

### 3.2 一键登录（用户走 register 页）

**目的**：未登录用户从 profile 页点账户卡进入注册页，点一次按钮拿到 openid，回到 profile 页显示身份 ID；登录后自动拉取该用户的历史设计。**与 main 100% 一致**（整段拷贝，本节仅描述而不做任何行为改动）。

**流程（箭头链）**：

```
profile.onCardTap （未登录）
        │
        ▼
wx.navigateTo('/packageDesign/register/register')
        │
        ▼
register.onLogin
        │
        ▼
app.ensureLogin()
        │
        ▼
wx.cloud.callFunction({ name: 'login' })
        │
        ▼
云函数返回 { openid, appid, unionid }
        │
        ▼
globalData.openid ✔️  +  wx.setStorageSync('userInfo', { openid, loginTime })
        │
        ▼
无 registerTime? ──► saveUserInfo({ registerTime: now })
        │
        ▼
app.refreshDesigns()   （首次登录后立刻拉云端历史）
        │
        ▼
wx.showToast('登录成功')  +  navigateBack →  profile 页 _syncLoginState
```

**详细步骤**：

1. Profile 页 `onCardTap` 判断 `isLoggedIn === false`，`wx.navigateTo` 到分包 register 页。
2. Register 页 `onLogin` 加锁 `loading = true`，调 `app.ensureLogin()`。
3. `ensureLogin` 内部：若 `_loginPromise` 已在飞，直接复用；否则 `wx.cloud.callFunction({ name: 'login' })`，成功回填 `globalData.openid / isLoggedIn / userInfo` 并 `wx.setStorageSync('userInfo', ...)`；失败清空 `_loginPromise` 允许下次重试。
4. 若 `userInfo.registerTime` 缺失（新用户），调 `saveUserInfo({ openid, registerTime })` 打点。
5. 调 `app.refreshDesigns()`，拉取该 openid 的历史设计到 `globalData.designs`。
6. `wx.showToast({ title: '登录成功', icon: 'success' })`，800 ms 后 `navigateBack`；profile 页 `onShow` 走 `_syncLoginState` 显示 openid 尾 6 位。

### 3.3 设计保存链路

**目的**：用户走完 space-setup → design → materials → cost 四步，每一步都把当前状态落到云端 `designs` 集合的同一个文档上；图片全部先上云拿 fileID 再写文档；本地缓存同步更新，保证列表页秒渲。

**跨页流程（箭头链）**：

```
space-setup 页                design 页                materials 页             cost 页
 输入墙面/名称   ─draftPlan─►  摆柜子/换色/截图  ─CurrentPlan─► 选5项材质  ─CurrentPlan─► 计算成本/烘线框图
     (内存)                  ┌─────────┐               ┌─────────┐              ┌─────────────┐
                             │onConfirm│               │ onCalc  │              │_maybeBake…  │
                             │ Layout  │               │         │              │Wireframe    │
                             └────┬────┘               └────┬────┘              └──────┬──────┘
                                  ▼                         ▼                          ▼
                          uploadFile ×3               doc.update                uploadFile ×1
                          (preview/wire/photo)        (materials)               (wireframe带编号)
                                  │                         │                          │
                                  ▼                         ▼                          ▼
                          designs.add ──► _id       designs.doc(_id).update      designs.doc(_id).update
                                  │                         │                          │
                                  ▼                         ▼                          ▼
                          globalData + DESIGNS_CACHE  globalData + DESIGNS_CACHE  globalData + DESIGNS_CACHE
                                  │                                                    │
                                                                                       ▼
                                                                              旧 wireframeFileID
                                                                              wx.cloud.deleteFile
```

**3.3.1 space-setup.onConfirm**

与现状一致。仅在内存产生 `draftPlan`（含 id/name/wall/cornerType/hasRaise/photoPath），`redirectTo` design。**不涉及云**。

**3.3.2 design.onConfirmLayout**

**目的**：把 3D 布局定稿（含预览图 + 无编号线框图 + 墙面照片）作为一条新记录首次写入 `designs` 集合。

**流程（箭头链）**：

```
_renderer.captureLayoutImage ─► previewImage (wxfile://)
_renderer.captureWireframeImage ─► wireframeImage (wxfile://)
draftPlan.photoPath ─► photoPath (wxfile://)
                │
                ▼
        并行 uploadFile ×3
   ┌────────────┼────────────┐
   ▼            ▼            ▼
previewFileID  wireframeFileID  photoFileID
   │            │            │
   ▼            ▼            ▼
      fm.saveFile → img-cache/
      IMG_CACHE.register(fileID, savedPath)
                │
   ┌────────────┴────────────┐
   ▼                         ▼
写入云的 doc              回填内存的 plan
(仅 3 个 FileID)          (FileID + 本地路径都保留)
   │                         │
   ▼                         ▼
app.saveDesign(doc)      globalData.currentPlan = plan
   │
   ▼
designs.add → _id ─► plan._id
   │
   ▼
globalData.designs.unshift + DESIGNS_CACHE 覆盖
   │
   ▼
wx.redirectTo → materials
```

**详细步骤**：

1. 用现有代码构造 `updatedPlan`，其中 `previewImage / wireframeImage` 为 `_renderer.capture*Image` 返回的 wxfile 临时路径。
2. 【新】并行 `wx.cloud.uploadFile` 3 张图（`cloudPath` 分别为 `designs/{plan.id}_{ts}_preview.png`、`_wire.png`、`_photo.jpg`；`photoPath` 空则跳过第三张）。
3. 【新】上传成功后调 `imgCache.register(fileID, wxfilePath)`（内部 `fm.saveFile` 提升到 `img-cache/{md5(fileID)}.{ext}` 并写 storage.IMG_CACHE）。
4. 分两份对象：
   - **写入云的 doc**：移除 `previewImage / wireframeImage / photoPath`，只保留 `previewFileID / wireframeFileID / photoFileID`。
   - **回填内存的 plan**：FileID 字段与本地路径字段并存，供本会话后续渲染直接命中。
5. `app.saveDesign(doc)` → `db.collection('designs').add`，回填云端 `_id` 到 `plan._id`。
6. `globalData.designs.unshift(plan)`；`DESIGNS_CACHE.data` 同步整体覆盖。
7. `wx.redirectTo('/cabinet/pages/materials/index?from=design')`。

**3.3.3 materials.onCalc**

**目的**：把用户在 materials 页选的 5 项材质（panel / doorPanel / doorCraft / hardware / lighting）作为增量更新写到已有的设计文档上。

**流程（箭头链）**：

```
用户选 5 项材质 ─► plan.materials
        │
        ▼
app.saveDesign(plan)
        │
        ▼
db.collection('designs').doc(plan._id).update({ materials, updateTime })
        │
        ▼
globalData.designs 对应项覆盖 + DESIGNS_CACHE 同步
        │
        ▼
wx.redirectTo → cost
```

**详细步骤**：

1. 用户点击"计算成本"，`plan.materials = {panel,doorPanel,doorCraft,hardware,lighting}`。
2. `app.saveDesign(plan)`：内部识别 `plan._id` 存在，走 `doc(_id).update({ materials, updateTime: db.serverDate() })`。
3. 更新内存与本地缓存。
4. `wx.redirectTo('/cabinet/pages/cost/index?from=design&id=' + plan.id)`。

**3.3.4 cost._maybeBakeWireframe**

**目的**：cost 页首屏用 canvas 把无编号线框图叠上柜体编号，烘成新 PNG；替换掉原来的 `wireframeFileID`。这是 wireframe 图片的**第二次**上云（第一次在 design 页存的是无编号版）。

**流程（箭头链）**：

```
plan.wireframeImage + labels ─► canvas 叠字 ─► canvasToTempFilePath
        │
        ▼
wx.cloud.uploadFile ──► new wireframeFileID
        │
        ▼
imgCache.register(new_fileID, wxfilePath)
        │
        ▼
app.saveDesign({ ...plan, wireframeFileID: new_fileID, wireframeHasLabels: true })
        │
        ▼
db.collection('designs').doc(plan._id).update
        │
        ▼
旧 wireframeFileID ─► wx.cloud.deleteFile （避免云存储堆积）
                     imgCache.remove(旧 fileID)
        │
        ▼
globalData + DESIGNS_CACHE 同步 + this.setData({ plan: updated })
```

**详细步骤**：

1. `canvasToTempFilePath` 得到叠好编号的 wxfile。
2. `wx.cloud.uploadFile` 得到新 `wireframeFileID`；调 `imgCache.register` 缓存。
3. `app.saveDesign({ ...plan, wireframeFileID, wireframeHasLabels: true })` 更新云文档。
4. 旧 `wireframeFileID` 存在则 `wx.cloud.deleteFile([旧])` + `imgCache.remove(旧)`（与 main `deleteDesignById` 清理 `previewFileID` 对称；失败仅 warn，不阻断）。
5. 更新 `globalData` 与 `DESIGNS_CACHE`。
6. `this.setData({ plan: updated })` 让页面立即用新图。

### 3.4 列表读取（plan-list.onShow）

**目的**：进入设计列表页，先用内存中的 `globalData.designs`（冷启动时来自本地缓存，热切换时可能已是云端最新）秒渲染，再异步用云端刷新覆盖；无网时保留本地兜底不弹错。

**流程（箭头链）**：

```
plan-list.onShow
        │
        ▼
this.setData({ plans: globalData.designs })   （立即渲染，来自内存 / 本地缓存）
        │
        ▼
app.refreshDesigns()
        │
        ├─ 成功 ──► globalData.designs 覆盖 + DESIGNS_CACHE 同步 ──► this.setData({ plans })
        │
        └─ 失败 ──► 静默，保持已渲染列表
```

**详细步骤**：

1. `this.setData({ plans: globalData.designs })` — 从内存直接渲染，可能是冷启动时刚从 DESIGNS_CACHE 恢复的、也可能已是最新云端数据。
2. `app.refreshDesigns()` — 内部 `db.collection('designs').orderBy('createTime','desc').limit(30).get()`；成功即覆盖 `globalData.designs` 与 `DESIGNS_CACHE`，回到步骤 1 再 setData 一次。
3. 失败静默 warn，不影响用户看到的列表。

### 3.5 单条读取（plan-list.onTapItem）

**目的**：用户点列表某条设计进入 materials 页做二次编辑，此时数据完全来自内存，不请求云。

**流程（箭头链）**：

```
plan-list.onTapItem(e)
        │
        ▼
app.getDesignById(e.currentTarget.dataset.id)
        │
        ▼
globalData.currentPlan = design    （跨页传递）
        │
        ▼
wx.navigateTo → materials(from=list&id=…)
```

**详细步骤**：

1. `app.getDesignById(id)` 从 `globalData.designs` 内存数组查找。
2. 命中即赋 `globalData.currentPlan`，`wx.navigateTo` 到 materials 页。
3. **无云请求**。

### 3.6 删除（plan-list.onConfirmDeleteOk）

**目的**：用户在列表页删除一条设计，同时清理云文档、云存储三张图、本地缓存的对应条目和图片，防止残留。

**流程（箭头链）**：

```
plan-list.onConfirmDeleteOk
        │
        ▼
app.deleteDesignById(id)
        │
        ▼
从 globalData.designs 找 target
        │
        ▼
wx.cloud.deleteFile([previewFileID, wireframeFileID, photoFileID].filter(Boolean))
        │
        ▼
db.collection('designs').doc(target._id).remove()
        │
        ▼
globalData.designs 剔除 + DESIGNS_CACHE 同步
        │
        ▼
imgCache.remove(每个 fileID)   （unlink 本地文件 + 摘 storage 条目）
```

**详细步骤**：

1. 从 `globalData.designs` 找到 target。
2. 先 `wx.cloud.deleteFile` 清云存储 3 张图；失败仅 warn。
3. `db.collection('designs').doc(target._id).remove()` 删云文档。
4. 剔除 `globalData.designs` 与 `DESIGNS_CACHE` 中对应项。
5. 对每个 fileID 调 `imgCache.remove(fileID)`：`fm.unlink` 本地文件 + storage.IMG_CACHE 摘除条目。

### 3.7 导出方案信息 / 导出方案成本

**目的**：把 N 条设计打包导出成 PDF。因为图片字段现在存的是 fileID（canvas 不认 `cloud://`），先前置一步把 fileID 解析成本地路径，再交给现有 pdf-exporter 一行不改地渲染。

**流程（箭头链）**：

```
用户在导出弹窗选中 ids
        │
        ▼
plans = ids.map(id => app.getDesignById(id))   （内存查，零请求）
        │
        ▼
await _resolvePlanImages(plans)   ← 本次改造新增的前置层
        │
        ▼
（对每个 plan 的 previewFileID/wireframeFileID/photoFileID，四级 fallback：见下）
        │
        ▼
pdf-exporter.exportPlans / exportPlansWithCost   ← 一行不动
        │
        ▼
生成 PDF ──► wx.openDocument
```

**四级 fallback 逻辑**（对每张图片独立执行）：

```
FileID 字段
     │
     ├─ 为空 ──► 跳过，pdf-exporter 显示"无预览/无照片"占位
     │
     ├─ 内存 plan.previewImage 等已有本地路径 ──► 保持不变
     │     （本会话保存时已 register 缓存，直接用）
     │
     ├─ 查 imgCache.resolve(fileID)：
     │     命中且 fm.accessSync 通过 ──► 本地字段 = cachedPath
     │
     └─ 全部未命中：
           wx.cloud.getTempFileURL → wx.downloadFile → fm.saveFile 到 img-cache/
                                                            │
                                                            ▼
                                                   imgCache.register(fileID, savedPath)
                                                            │
                                                            ▼
                                                   本地字段 = savedPath
```

**详细步骤**：

1. 用户在导出选择弹窗确认 ids。
2. `plans = ids.map(id => app.getDesignById(id)).filter(Boolean)` — 内存直接拿。
3. `await _resolvePlanImages(plans)`：对每个 plan 的三个字段执行四级 fallback，产出 `plan.previewImage / wireframeImage / photoPath` 三个本地路径。
4. 调用现有 `pdf-exporter.exportPlans({ canvas, plans, fileName })` 或 `exportPlansWithCost`。**pdf-exporter.js 内部一行不改。**
5. 生成的 tempFilePath 交 `wx.openDocument` 打开。

`pdf-exporter.js` 内部读的仍是 `plan.photoPath / previewImage / wireframeImage`（现在是本地路径），与旧行为完全兼容。

### 3.8 导出拆单规范

**目的**：拉一份固定的 `hardware-fittings/*.pdf` 让用户下载查看，跟 plan 数据无关。

**流程（箭头链）**：

```
plan-list.onTapExportHardware
        │
        ▼
hardware-pdf-cloud.fetchHardwarePdf({ onProgress })
        │
        ▼
（本地 md5 缓存命中 → 直接返回本地路径；否则拉云端）
        │
        ▼
wx.openDocument
```

**本节完全不动**，仅列出便于理解全景。

### 3.9 用户资料保存（profile 页 saveProfile）

**目的**：用户在 profile 编辑弹窗改头像 + 昵称并保存；头像先上传云存储拿 fileID，再把 fileID + 昵称写入 `users` 集合。**与 main 100% 一致**（整段拷贝）。

**流程（箭头链）**：

```
profile.saveProfile
        │
        ├─ editAvatarTemp 空 ──► 沿用旧 avatarFileID
        │
        └─ editAvatarTemp 非空 ──► wx.cloud.uploadFile
                                    (cloudPath: avatars/{openid}_{ts}.{ext})
                                    │
                                    ▼
                                new avatarFileID
        │
        ▼
app.saveUserProfile({ avatarFileID, nickName })
        │
        ▼
db.collection('users').limit(1).get()
        │
        ├─ existing ──► db.collection('users').doc(_id).update
        │
        └─ 无 ────────► db.collection('users').add
        │
        ▼
globalData.avatarFileID/nickName 覆盖 + storage.userInfo 同步
        │
        ▼
wx.showToast('已保存') + 关弹窗 + _syncLoginState 刷新
```

**详细步骤**：与 main `profile.js:saveProfile`（`packageDesign` 之外的 profile 页版本）逐行一致，本节仅描述而不做行为改动。

## 错误处理

| 场景 | 处理 |
|---|---|
| `ensureLogin` 云函数失败 | `_loginPromise = null` 允许下次重试；`loadUserProfile / refreshDesigns` 走 catch，静默返回默认值。**与 main 一致** |
| `uploadFile` 单张失败 | 该字段留空串，不阻断保存流程（**与 main `confirmSave` 一致**）；用户下次进 design 页再点确认时会重传 |
| `saveDesign(add)` 失败 | `showModal("保存失败，请检查网络")`，不做自动重试（避免累积） |
| `saveDesign(update)` 失败 | 同上 |
| `refreshDesigns` 失败 | 静默；`globalData.designs` 保持本地缓存值 |
| `deleteFile` 失败 | `console.warn`，不阻断 `doc.remove`；云存储会残留孤儿文件，可接受（**与 main 一致**） |
| `downloadFile / getTempFileURL` 失败 | 该图片在 PDF 里显示占位；不阻断导出 |
| `fm.saveFile` 失败 | 当次直接用 `downloadFile` 拿到的 tempFilePath，不进 IMG_CACHE；下次仍会重下（降级但可用） |
| 集合不存在（`designs / users / config`） | 读走 catch 返回空；写时云开发自动创建集合（**与 main 一致**） |
| IMG_CACHE 超限 | LRU 淘汰，失败静默 |
| `DESIGNS_CACHE.openid` 与当前 openid 不一致 | 直接丢弃缓存，以云端拉取为准 |
| 30 条上限触发（`saveDesign` 内部判） | `showModal("设计库已满 30 条，需删除部分设计后新建")`，不入库（**与 main 一致**） |

## 迁移策略（"新环境从 0 开始"）

`app.onLaunch` 一次性清理：

```js
try {
  if (wx.getStorageSync('PLAN_LIST')) {
    wx.removeStorageSync('PLAN_LIST');
    console.log('[migrate] cleaned legacy PLAN_LIST');
  }
} catch (e) {}
```

云端 `lemonta_plans` **不动**——前端不再读写，自然废弃。云函数 `savePlan / saveMaterials / listPlans` 分支代码保留但注释 `// deprecated, front-end no longer calls`。

## 交付范围

**新增文件**：

- `packageDesign/register/register.{js,wxml,wxss,json}` — 从 main 复制
- `miniprogram/utils/img-cache.js` — 导出 `resolve(fileID) → Promise<localPath>` / `register(fileID, localPath, size?) → void` / `remove(fileID) → void` / 内部 `_evictIfNeeded()`

**修改文件**：

- `miniprogram/app.js` — 替换 5 个方法为 main 版本；新增 `saveDesign(add/update)`、`deleteDesignById`、`getDesignById` 的云版本；`onLaunch` 恢复 DESIGNS_CACHE 与一次性清理 PLAN_LIST
- `miniprogram/app.json` — 新增 `packageDesign` 分包 + `preloadRule`
- `miniprogram/pages/profile/profile.js` — `onCardTap` 跳注册页；`saveProfile` 加头像上传
- `miniprogram/pages/plan-list/index.js` — `onShow / onTapItem / onConfirmDeleteOk` 改数据源；两个导出加 `_resolvePlanImages` 前置；`onTapExportHardware` 不动
- `miniprogram/cabinet/pages/design/index.js` — `onConfirmLayout` 加 3 张图上传 + `saveDesign`
- `miniprogram/cabinet/pages/materials/index.js` — `onCalc` 改为 `saveDesign` 更新
- `miniprogram/cabinet/pages/cost/index.js` — `_maybeBakeWireframe` 加 `uploadFile` + `saveDesign`
- `miniprogram/utils/plan-store.js` — 只保留 `makeId / timestamp / timestampSec / photoName`
- `miniprogram/utils/cloud.js` — 只保留 `requestDownload / listCabinetModels / listHardwareFittings / getModelInfo`

**明确不改文件**（避免误伤）：

- `miniprogram/utils/pdf-exporter.js`
- `miniprogram/utils/hardware-pdf-cloud.js`
- `miniprogram/pages/plan-list/index.js` 中的 `onTapExportHardware`
- `miniprogram/cabinet/pages/design/index.js` 除 `onConfirmLayout` 之外
- `cloudfunctions/quickstartFunctions/index.js`
- `cloudfunctions/login/index.js`

## 测试与验证要点

- 全新账号首次进入：register 页点"微信一键登录" → toast + navigateBack → profile 页显示 openid 尾 6 位；重启后仍保留登录态。
- 编辑资料：选头像 + 输入昵称 + 保存 → users 集合出现 1 条记录（`_openid = 当前 openid`）；重启后头像仍能渲染（走 fileID）。
- 完整设计流程：space-setup → design.onConfirmLayout → materials.onCalc → cost：走完后 designs 集合出现 1 条记录，含 3 个 fileID 与全字段；重启后列表页仍能看到、进入详情图片正常显示。
- 删除：删设计后 designs 集合对应文档消失；云存储 `designs/` 下 3 张图消失；IMG_CACHE 对应条目和本地文件也消失。
- 导出方案信息 / 成本：选中 3 条设计 → 生成 PDF → 打开确认图片渲染正确。首次导出：IMG_CACHE 增加 9 条条目（3 plans × 3 imgs）；第二次导出：无云端请求（全命中）。
- 导出拆单规范：一次性行为，无变化。
- 无网场景：冷启动仍能看到列表（本地缓存）；点导出失败 → 图片显示占位，PDF 生成成功。
- 迁移：安装升级版后启动，`wx.getStorageInfoSync().keys` 里不再有 `PLAN_LIST`。

## 参考

- LemonTA-main 代码路径 `D:\workspace\LemonTA-main\LemonTa-main`
- 起点提交 `127a424`（分支 `feat/migrate-3-tabs`，tag `v-milestone-flow-verified`）
- `cloudfunctions/login/index.js`、`cloudfunctions/quickstartFunctions/index.js`（后者继续保留）
