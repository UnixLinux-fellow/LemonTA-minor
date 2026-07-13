# GLB 模型上传与元数据入库 · 设计文档

- 日期：2026-07-13
- 分支：待建（建议命名 `feat/glb-upload-metadata`）
- 状态：设计（待实施）

## 背景

现有柜体 GLB 通过运营/开发人员经腾讯云控制台上传到 `cabinet-model/{50cm,100cm,zj}/`，小程序 `model-sync` 每次启动镜像同步下来给渲染器用。这条链路是"只读"的：小程序端没有上传入口，也没有把每个 GLB 的板件、五金、面积、模型分类等元数据结构化落库。

拆单、成本、材料计算都依赖板件面积与五金清单。今后要开放给用户/管理员上传新柜型时，也需要一份能被 cost/materials 页面消费的元数据文档。本次目标：

- 在设计页面加"上传新模型"按钮 → 打开一个弹窗
- 弹窗内：文件选择 + `model_category` 下拉（wardrobe / shoe cabinet）+ 取消 / 上传
- 校验文件格式必须是 `.glb`，且文件名符合柜型命名规范
- 上传到腾讯云 `cabinet-model-standard/{50cm|100cm|zj}/<name>.glb`
- 用小程序端的 `three` GLTFLoader 解析 GLB，抽出板件 / 衣通 / 尺寸
- 拼装成 `docs/explain_example.json` 定义的结构，写入云数据库集合 `model_panel_hardware`

本次不改动现有 `cabinet-model/` 目录下的资源，也不修改 `model-sync.js` / picker 的行为。上传的模型不会立即出现在设计页 picker 中——这一步留给后续需求。

## 参考文件

- `docs/GLB文件上传给CC的prompt提示词.txt` — 需求
- `docs/explain_example.json` — 元数据结构参照
- `miniprogram/cabinet/utils/three-renderer.js` — 已有 GLTFLoader 用法
- `miniprogram/utils/model-sync.js` — 已有云 → 本地缓存同步器（本次仅参考，不改）
- `docs/superpowers/specs/2026-07-05-cabinet-model-cloud-sync-design.md` — 现有模型云同步的设计

## 数据库集合

**集合名：`model_panel_hardware`**（首次调用时前端自动 add 触发创建；如需权限也可在云函数里 `db.createCollection` 兜底）

每条文档结构完全对齐 `docs/explain_example.json`，字段说明见"元数据字段"一节。

## 云端目录约定

新增目录 `cabinet-model-standard/`，与现有 `cabinet-model/` 并列，互不影响：

| 子目录  | 内容 |
|---------|------|
| `50cm/` | `50A.glb` ~ `50L.glb` 等以 `50` 开头的柜体 |
| `100cm/`| `100A.glb` ~ `100L.glb` 等以 `100` 开头的柜体 |
| `zj/`   | 文件名以 `Y`/`Z`/`YG`/`ZG` 开头的转角柜 |

命名不匹配时**拒绝上传**并提示规则。

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│ upload-model-modal 组件（新）                                 │
│  properties: visible, defaultCategory                        │
│  events: cancel / confirm({file, category})                  │
│  UI: 文件选择区 + category 下拉 + 取消 / 上传                 │
└──────────────────────────────────────────────────────────────┘
                            │ confirm
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ design/index.js 里的 onConfirmUploadModel                    │
│  1) 二次校验 .glb 扩展 + 文件名规则                            │
│  2) parseSubdir(name) → '50cm' / '100cm' / 'zj'              │
│  3) wx.cloud.uploadFile → cabinet-model-standard/{sub}/{name}│
│  4) glbMetadata.parse(filePath, category) → meta            │
│  5) 拼装 explain_example 结构，cos_path = fileID              │
│  6) db.collection('model_panel_hardware').add({ data: doc }) │
│  7) 关闭 modal + toast 成功 / wx.showModal 失败               │
└──────────────────────────────────────────────────────────────┘
                            │ uses
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ glb-metadata.js（新，miniprogram/utils/）                    │
│  parse(filePath, category) → Promise<meta>                   │
│  - 读文件 → GLTFLoader.parse                                 │
│  - 遍历 scene，按 mesh.name 分类：                             │
│      board / shelf / vertical / top / bottom → board_list    │
│      rail / hanging_rail                       → hanging_rail│
│      door / door_panel                         → door_area   │
│  - Box3 算 overall_size (cm) + 每个 mesh 尺寸/面积             │
│  - hardware_list 用 explain_example.json 默认值               │
└──────────────────────────────────────────────────────────────┘
```

## 组件与文件改动

### 新增

**`miniprogram/components/upload-model-modal/`** (index.wxml / .wxss / .js / .json)

- 参照 `filename-input-modal` 的风格与 `plan-select-modal` 的遮罩样式
- 属性：
  - `visible: Boolean` — 显示/隐藏
- data：
  - `file: { name, size, path } | null` — 选中的文件（临时路径）
  - `category: 'wardrobe' | 'shoe cabinet'`
  - `uploading: Boolean` — 显示进度态
  - `progressPct: Number` — 0-100
- 事件：
  - `cancel` — 用户取消
  - `confirm({ file, category })` — 用户点上传
- UI 结构：
  ```
  ┌────────────────────────────┐
  │ 上传新模型                  │
  │ ┌────────────────────────┐ │
  │ │  [+] 选择 GLB 文件      │ │  ← wx.chooseMessageFile
  │ │  已选：50A.glb (128 KB) │ │
  │ └────────────────────────┘ │
  │ 模型类型：[wardrobe ▼]      │
  │                            │
  │ [========>       ] 45%     │  ← 上传中显示
  │                            │
  │ [取消]        [上传]        │
  └────────────────────────────┘
  ```

**`miniprogram/utils/glb-metadata.js`** — GLB 元数据抽取器

- 依赖：`three` npm 包（已装）+ 项目里的 `GLTFLoader` vendor
- 导出 `parse(filePath, opts) → Promise<{...}>`
  - `opts = { fileName, modelCategory, fileSize, uploadOpenid, sourceType }`
  - 返回值即元数据文档（不含 `cos_path`；`cos_path` 由调用方在上传成功后回填）
- 内部：
  - `_readGlbBuffer(path)` — 走 `wx.getFileSystemManager().readFile`
  - `GLTFLoader.parse(buffer, '', onLoad, onErr)`
  - `_extractOverallSize(root, fileName)` — 见"GLB 解析细节 / overall_size"
  - `_extractBoardList(root, unitToCm)` — 遍历 mesh，`_classifyMesh(name)` 决定归属；每个 mesh Box3 尺寸 × unitToCm 得 cm
  - `_meshDims(mesh, unitToCm)` — Box3 得 length/width/thickness (cm)
  - `_computeArea(l, w)` — `(l*w)/10000` 得 m²

### 修改

**`miniprogram/cabinet/pages/design/index.wxml`**

在 `.info-bar` 右侧添加"上传新模型"文字按钮：

```xml
<view class="info-bar">
  <view class="info-name">{{plan.name}}</view>
  <view class="info-meta">{{plan.wall.w}}×{{plan.wall.h}}cm · {{cornerLabel}}{{plan.hasRaise ? ' · 加高' : ''}}</view>
  <view class="info-upload" bindtap="onOpenUploadModal">上传新模型</view>
</view>
...
<upload-model-modal
  visible="{{uploadModalVisible}}"
  binduploadcancel="onCancelUploadModal"
  binduploadconfirm="onConfirmUploadModel" />
```

**`miniprogram/cabinet/pages/design/index.wxss`**

新增：

```css
.info-bar { justify-content: space-between; }
.info-upload {
  font-size: 22rpx;
  color: #14532d;
  border: 2rpx solid #14532d;
  border-radius: 999rpx;
  padding: 6rpx 20rpx;
  margin-left: auto;
}
```

**`miniprogram/cabinet/pages/design/index.js`**

- 顶部常量：
  ```js
  const ADMIN_OPENIDS = []; // TODO: 填入运营/管理员 openid
  const MODEL_PANEL_HARDWARE = 'model_panel_hardware';
  const UPLOAD_ROOT = 'cabinet-model-standard';
  ```
- data 增：`uploadModalVisible: false`
- 新方法：
  - `onOpenUploadModal` — 置 visible
  - `onCancelUploadModal` — 置 visible=false
  - `onConfirmUploadModel(e)` — 主流程（校验 → 上传 → 解析 → 入库 → toast）
  - `_parseSubdir(name)` — 见"命名规则"
  - `_getSourceType(openid)` — `ADMIN_OPENIDS.includes(openid) ? 'official_standard' : 'normal_user'`

**`miniprogram/cabinet/pages/design/index.json`**

```json
{
  "navigationBarTitleText": "设计衣柜",
  "usingComponents": {
    "cabinet-toast": "/components/cabinet-toast/index",
    "upload-model-modal": "/components/upload-model-modal/index"
  },
  "navigationStyle": "default"
}
```

### 保持不变

- 云函数 `quickstartFunctions/index.js`（本次不新增分支；`model_panel_hardware` 集合前端 add 即可，若日后发现集合不存在的 add 失败，再补 `ensureCollection`）
- `model-sync.js` / `cabinet-model.js` / picker 展示逻辑
- 现有 `cabinet-model/` 目录

## 命名规则与子目录归类

`parseSubdir(name)`：

- 去掉扩展名，取 basename
- 正则匹配（大小写不敏感）：
  - `^50[A-Z]+$` → `50cm`
  - `^100[A-Z]+$` → `100cm`
  - `^(Y|Z|YG|ZG)([-_][A-Za-z0-9]+)?$` → `zj`
- 都不匹配 → 抛出 `invalid_name`，拒绝上传，弹 modal 提示：

  > 文件名格式无效。请使用形如 `50A.glb`、`100C.glb`、`Y110.glb`、`YG120.glb` 的命名。

## 元数据字段

对齐 `docs/explain_example.json`，逐字段说明：

| 字段 | 来源 |
|------|------|
| `glb_file_name` | 上传文件的原始名（含扩展名） |
| `model_category` | 弹窗下拉：`wardrobe` / `shoe cabinet` |
| `platform` | 常量 `'wechat'` |
| `cos_path` | `uploadFile` 返回的 `fileID`（`cloud://<env>.<bucket>/cabinet-model-standard/<sub>/<name>.glb`） |
| `file_size` | `wx.chooseMessageFile` 返回的 `size` |
| `source_type` | `_getSourceType(openid)` |
| `upload_openid` | `wx.cloud.callFunction('getOpenId')` 返回值；已缓存到 `app.globalData.openid` 时直接取 |
| `is_online` | 常量 `true` |
| `remark` | 常量 `''` |
| `overall_size` | GLB Box3 × unitToCm（见"GLB 解析细节 / 单位换算"）；round 到整数 |
| `board_list` | 见"GLB 解析" |
| `total_body_area` | `board_list.reduce((s,b) => s + b.area, 0)` |
| `total_door_area` | door mesh 面积之和（若无 door mesh 则 `0`，与 explain_example 保持相同精度） |
| `total_raw_board_area` | `total_body_area + total_door_area` |
| `hanging_rail_list` | 见"GLB 解析" |
| `hardware_list` | 硬编码为 `docs/explain_example.json` 的 `hardware_list` 拷贝 |
| `create_time` | `new Date().toISOString()` |
| `update_time` | 同 `create_time` |

`hardware_list` 的默认值由 `glb-metadata.js` 内部常量提供，不需要再从 `docs/explain_example.json` 运行时读文件。

## GLB 解析细节

**Mesh 分类**（`_classifyMesh(name)`）：

- name 转小写后：
  - 包含 `door` → `door`
  - 包含 `rail` 或 `hanging` → `rail`
  - 包含 `board`、`shelf`、`vertical`、`top`、`bottom`、`side`、`front`、`back` → `board`
  - 其他 → `other`（不计入任何 list，避免脏数据）

**单位换算 (unitToCm)**：

现有 `three-renderer.js` 加载 GLB 时按 `item.w / bbox.size.x`（业务尺寸/GLB 尺寸）算等比缩放因子，说明 GLB 的原始坐标**不是可靠的 cm/mm，而是各柜型作者自己的单位**。因此本次解析必须显式建立单位换算：

1. 由 `fileName` 反推目标宽度 `expectedWidthCm`：
   - `^50[A-Z]+$` → 50 cm
   - `^100[A-Z]+$` → 100 cm
   - `^(Y|Z|YG|ZG)([-_].*)?$` → 110 cm（沿用现有转角柜宽度约定，见 `model-sync.js:parseName`）
2. `unitToCm = expectedWidthCm / rootBox3.getSize().x`
3. 若 `rootBox3.size.x ≤ 0` → `unitToCm = 1`（等价于承认 GLB 已按 cm 建模），并 wx.showModal 告警。

`unitToCm` 一路带下去用来把每个 mesh 的 Box3 尺寸转 cm。

**overall_size**：

- 用 root（gltf.scene）Box3.getSize
- `total_width = round(size.x * unitToCm)`（cm，整数）
- `total_height = round(size.y * unitToCm)`
- `total_depth = round(size.z * unitToCm)`

**每个 mesh 尺寸/面积**：

- Box3.setFromObject(mesh).getSize(v) → `{x,y,z}` × unitToCm 得到 cm 三元组
- length = round(max × unitToCm, 1)
- width  = round(mid × unitToCm, 1)
- thickness = round(min × unitToCm, 2)（板件厚度通常 1.8cm，保留两位）
- area = round((length * width) / 10000, 4) m²

**特殊情况**：

- 若解析失败（Box3 全 0、GLB 无 scene 等）→ 元数据文档仍构造出来但 `board_list=[]`、`overall_size` 全 0，并 wx.showModal 告警："GLB 解析失败，元数据已按空值入库，请人工核对"。仍继续入库以便运维知情。
- 若上传成功但入库失败 → `wx.showModal` 报错，并将已上传的 `cos_path` 打印到 log 供运维追踪；不做自动回滚（COS 上留个孤儿文件不影响任何业务）。

## 交互流程

1. 用户在设计页点"上传新模型" → `uploadModalVisible = true`
2. 用户在 modal 点"选择 GLB 文件" → `wx.chooseMessageFile({ count: 1, type: 'file', extension: ['glb'] })`
3. 若返回的 `name` 不以 `.glb` 结尾 → toast "仅支持 GLB 格式"
4. 用户选 `model_category` → data 变
5. 用户点"上传"：
   - Modal 内部 `triggerEvent('confirm', { file, category })`
   - 页面 `onConfirmUploadModel`：
     a. `_parseSubdir(file.name)` — 失败即 wx.showModal 拒绝
     b. 显示进度态（modal 内部由页面透传 `uploading` prop）——**可选简化：直接用 `wx.showLoading`，MVP 阶段先不接组件内 progress**
     c. `wx.cloud.uploadFile({ cloudPath, filePath })`
     d. `glbMetadata.parse(file.path, { fileName, category, ... })`
     e. `db.collection('model_panel_hardware').add({ data: meta })`
     f. `wx.hideLoading()` + `uploadModalVisible = false` + toast "上传成功"
6. 任一步失败：`wx.hideLoading()` + `wx.showModal` 展示错误消息

**进度反馈简化**：MVP 用 `wx.showLoading('上传中...')`；组件里的进度条 UI 保留但由后续迭代接线（避免这一版把 upload 的 `onProgressUpdate` 也扯进来）。

## 权限与安全

- `wx.chooseMessageFile` 已由框架处理（用户从聊天/文件选择器选文件）
- 云 COS 上传：目前项目 `cloud://.../designs/` 图片上传就是前端直接 `wx.cloud.uploadFile`，权限模式相同（默认所有登录用户可写自己的路径；集合 `model_panel_hardware` 应设置为"仅创建者可读写"或"所有用户可读、仅创建者可写"，由部署时在云开发控制台调整）
- ADMIN_OPENIDS 目前为空数组，所有上传均记 `normal_user`；运营后续手动填入 openid 后重新发版即可
- 上传的 GLB 未做恶意文件扫描——这是与现有 `designs/` 图片上传一致的信任模型，本次不引入新的安全表面

## 测试策略

新增的 `glb-metadata.js` 是纯函数（模块级 IO 走 `wx.getFileSystemManager`，测试可注入 mock）：

- `tests/glb-metadata.test.js`（Node 环境）：
  - `_classifyMesh` 各关键字命中
  - `_meshDims` 输入 Box3 尺寸组合，验证 length/width/thickness 排序
  - `_computeArea` 精度
  - `parse` 端到端：mock GLTFLoader.parse 返回一棵手工构造的 scene，断言输出 JSON 与 `docs/explain_example.json` 结构一致

上传编排（`onConfirmUploadModel`）与组件 UI 因涉及 `wx.chooseMessageFile` / `wx.cloud.uploadFile`，用真机走一遍手工验证：

- 命名合法 → 成功入库；控制台里能看到 `model_panel_hardware` 新增文档
- 命名非法 → 拒绝提示
- 非 glb 文件 → 拒绝提示
- 取消 → 无副作用

## YAGNI

以下功能刻意不做：

- 上传的模型立即出现在 picker 中（依赖 `model-sync` 或"上传即刷新" 逻辑，本次不做）
- 组件级上传进度条 UI 接线（用 `wx.showLoading` 代替）
- GLB mesh 命名不规范时的自动矫正（脏数据入库让运维知道即可）
- ADMIN openid 后端管理界面（手工在代码里维护数组）
- 元数据入库后的编辑 / 下线 / 删除（`is_online` 字段先只写不消费）
- COS 上传失败的自动重试与断点续传
