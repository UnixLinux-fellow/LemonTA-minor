# 移植知识库「新家物品清单」与「搬家核对清单」页面 · 设计文档

- **日期**：2026-07-03
- **分支**：`feat/migrate-3-tabs`
- **源项目**：`D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main`
- **目标项目**：`D:/工程/柠檬塔/程序/LemonTA-minor`（即当前项目）

## 背景

用户最初提到的源路径 `D:\workshop\LemonTA-main\LemonTA-main` 磁盘上不存在；另一近似路径 `D:/workspace/LemonTA-main/LemonTA-main` 存在但其 `pages/knowledge/` 目录里没有 checklist / move 子页。通过全盘搜索"新家物品清单"关键字定位到实际源码位于 `D:/工程/柠檬塔/程序/LemonTA-main/LemonTA-main/pages/knowledge/checklist/`，与之搭配的还有 `pages/knowledge/move/`。本次移植以该目录为源。

当前项目 `LemonTA-minor` 已完成知识库主页（`pages/knowledge/knowledge`）与三个子页（`budget / needs / inspect`）的移植，架构、样式基线、`utils/share.js`、`utils/assets.wxs`、自定义导航栏尺寸方案与源项目完全同构，因此本次追加两个子页面几乎不引入结构差异。

## 目标

- 把源项目「新家物品清单」（checklist）与「搬家核对清单」（move）两个页面完整移植到当前项目 `miniprogram/pages/knowledge/` 下
- 内容数据（8 大分类 106 项物品；4 大搬家阶段共 47 条核对项）原样保留
- 知识库主页入口按源项目顺序追加两条（id=14 move、id=15 checklist）
- 页面容器 class 与当前项目已有子页对齐（`page-container`），其余交互、样式、结构与源项目一致

## 非目标

- 不重构 checklist.js / move.js 内嵌数据的加载方式（不引入云数据库、不做拆表）
- 不改动源项目原有的四态循环切换、长按 ActionSheet、关键词复制、说明文字展开等 UX
- 不新增测试框架（当前项目 `tests/` 目录未包含单测框架，验证以手动为主）
- 不动云函数

## 方案对比

- **方案 A · 直接复制 + 精准适配（采用）**：从源项目复制两个子页目录到当前项目，wxml 根容器 class 由 `container` 改为 `page-container` 与当前项目其他子页对齐，其余 4 处已有文件（`app.json` / `app.js` / `knowledge.js` / `share.js`）做小追加。改动集中、路径全部沿用现有约定、几乎零风险。
- **方案 B · 完整原样搬 + 保持源风格**：目录搬过来但不改根容器 class。与源码 100% 一致但与目标项目已有子页样式基线不一致，未来演化打架。
- **方案 C · 只加入口，暂不搬子页**：只加 knowledgeList 两条，subtitle 打"敬请期待"。与用户"保留全部内容"要求直接矛盾。

采用方案 A。

## 架构与文件结构

```
miniprogram/
├── app.js                             (改：globalData.knowledgeList 追加 2 条)
├── app.json                           (改：pages 数组追加 2 条注册)
├── pages/knowledge/
│   ├── knowledge.js                   (改：openArticle 追加 2 条 type 分支)
│   ├── knowledge.wxml                 (改：article-icon 追加 2 个 wx:if 图标)
│   ├── checklist/                     (新增)
│   │   ├── checklist.js
│   │   ├── checklist.json
│   │   ├── checklist.wxml
│   │   └── checklist.wxss
│   └── move/                          (新增)
│       ├── move.js
│       ├── move.json
│       ├── move.wxml
│       └── move.wxss
└── utils/share.js                     (改：SHARE_CONFIG 追加 checklist / move)
```

新增文件 8 个（两页 × 四件套），改动现有文件 5 个。

## checklist 页面

### 数据模型（Page.data）

- `statusBarHeight / navBarHeight` — 自定义导航栏尺寸
- `categories` — 分类总览列表（8 项：玄关/客厅/厨房/卫生间/餐厅/阳台/通用/清洁用品）
- `currentCategory` — `-1` 总览态；`>=0` 某分类详情态
- `currentCategoryData` — 当前分类完整物品数组
- `itemStates` — 稀疏字典 `{ 'c<catIndex>_<itemId>': 'owned'|'purchased'|'received' }`，`unowned` 不落盘
- `expandedItems` — 说明文字展开状态字典
- `searchQuery / searchResults / filteredItems` — 搜索态
- `overallStats / categoryStats` — 统计缓存

### 交互流

- **总览态**：8 张分类卡片显示进度条 + 顶部环形完成率 + 跨分类搜索
- **详情态**：物品卡片列表，短按物品循环切换四态 `unowned → purchased → received → owned → unowned`；长按弹 `wx.showActionSheet` 直接选任一态；"复制关键词"按钮把 keywords 写入剪贴板并 toast 提示
- **状态持久化**：`wx.setStorageSync('checklist_states', sparseStates)`，写入使用 500ms debounce
- **重置**：`resetCurrentCategory` 弹 `wx.showModal` 确认后清空当前分类状态
- **返回**：详情态点返回 → 回到总览态；总览态点返回 → 退出页面

### 依赖

- `../../../utils/assets.wxs`（当前项目已有）
- `../../../utils/share.js`（当前项目已有，本次需补 checklist 配置）
- 无云函数、无网络请求

### 数据源

- 全部 8 大分类共 106 项物品数据内嵌在 `checklist.js` 顶部的 `checklistData` 常量里，源码原样保留（含 keywords 与 description 字段；部分 items 的 keywords/description 为空字符串，wxml 已用 `wx:if` 处理）

## move 页面

### 数据模型（Page.data）

- `statusBarHeight / navBarHeight` — 自定义导航栏尺寸
- `steps` — 4 大搬家阶段卡片列表（搬家前准备 / 打包整理 / 搬家当天 / 新家入住）
- `currentStep` — `-1` 总览态；`>=0` 某阶段详情态
- `currentData` — 当前阶段完整数据对象（含 items 数组 / notes / contract）
- `checkStates` — 字典 `{ 'step<stepNum>_<itemId>': true }`，未勾选不写值

### 交互流

- **总览态**：4 张阶段卡片列出，每卡显示该阶段核对项数量
- **详情态**：核对项列表，点击切换勾选二态；显示阶段 `notes`（贴士）与 `contract`（红字警示，仅部分阶段有）
- **状态持久化**：`wx.setStorageSync('move_checks', checkStates)`，写入使用 500ms debounce
- **重置**：`resetCurrentStep` 弹 `wx.showModal` 确认后清空当前阶段
- **返回**：与 checklist 一致（详情态 → 总览态 → 退出页面）

### 依赖

- `../../../utils/assets.wxs`
- `../../../utils/share.js`
- 无云函数、无网络请求

### 数据源

- 4 大阶段共 47 条核对项 + 每阶段的 `notes` / `contract` 全部内嵌在 `move.js` 顶部的 `moveData` 常量里，源码原样保留

**与 checklist 的差异**：move 只有二态勾选（不是四态循环），没有搜索、没有说明文字展开、没有关键词复制。

## knowledge 主页与全局配置改动

### `app.js` — `globalData.knowledgeList`

按源项目 id 顺序在末尾追加两条：

```javascript
{ id: 14, title: '搬家核对清单', subtitle: '从准备到入住 · 逐项核对零遗漏', type: 'move' },
{ id: 15, title: '新家物品清单', subtitle: '106项物品核对 · 采购与签收跟踪', type: 'checklist' }
```

### `app.json` — `pages` 数组

在 `pages/knowledge/inspect/inspect` 之后追加：

```json
"pages/knowledge/move/move",
"pages/knowledge/checklist/checklist",
```

### `pages/knowledge/knowledge.js` — `openArticle` 分支

参照现有 `budget / needs / inspect` 分支格式，在 `inspect` 分支后追加：

```javascript
if (type === 'move') {
  wx.navigateTo({ url: '/pages/knowledge/move/move' });
  return;
}
if (type === 'checklist') {
  wx.navigateTo({ url: '/pages/knowledge/checklist/checklist' });
  return;
}
```

### `pages/knowledge/knowledge.wxml` — `article-icon` 图标行

在现有 `article-icon` view 里追加两条：

```xml
<text wx:if="{{item.type === 'move'}}">🚛</text>
<text wx:if="{{item.type === 'checklist'}}">🏠</text>
```

### `utils/share.js` — `SHARE_CONFIG` 追加

参照 `inspect` 条目格式，在合适位置追加两条：

```javascript
move:      { title: '搬家核对清单 · 从准备到入住', path: '/pages/knowledge/move/move' },
checklist: { title: '新家物品清单 · 106项零遗漏', path: '/pages/knowledge/checklist/checklist' }
```

## 样式对齐

源与目标项目已有子页的唯一显著差异是根容器 class：

- 源：`<view class="container">`
- 目标已有子页（budget/needs/inspect）：`<view class="page-container">`

移植过程中把 `checklist.wxml` 与 `move.wxml` 里的根容器 class 从 `container` 改为 `page-container`，其余样式类名保留。若 `.wxss` 中有 `.container { ... }` 全局选择器需要一并改名到 `.page-container`（若源 wxss 使用的是页面本地类如 `.overview / .item-card` 等，则不需要改）——实施时按当前 wxss 内容判断。

## 错误处理与边界

- `wx.getWindowInfo() / getMenuButtonBoundingClientRect()`：源码已有 try/catch 兜底默认值（`statusBarHeight=20, navBarHeight=44`）
- `wx.setStorageSync` 抛异常：源码未处理；沿用源逻辑不改（本地存储失败极罕见，且用户下次切换状态还会再写入）
- `wx.getStorageSync` 读回空：源码已用 `|| {}` 兜底
- 数据完整性：源 `checklistData` 里部分 items 的 `keywords / description` 为空字符串，wxml 里已用 `wx:if` 处理为不渲染
- 稀疏字典：未拥有物品不占存储，读回时通过 `|| 'unowned'` 默认态渲染
- 分享调用点：`require('../../../utils/share.js').onShare('checklist', this, res)` 与 `.onTimeline('checklist', this)` 已由源码固化，本次仅补 SHARE_CONFIG 中的 `checklist / move` 两条即可

## 手动验证清单

1. 从知识库主页看到两条新入口（🚛 搬家核对清单 / 🏠 新家物品清单），点击能进入
2. checklist 分类总览渲染 8 张卡片；点入某分类能进入详情
3. 详情页点击物品循环切换四态；长按弹 ActionSheet；点复制关键词有 toast 提示
4. 退出后重进 checklist，状态保留
5. 顶部搜索能跨分类命中；详情态搜索能在当前分类内过滤
6. move 页面 4 阶段能进入，勾选/取消勾选能保存；重置弹框正常
7. 分享菜单点开有"搬家核对清单"/"新家物品清单"两条自定义分享
8. 在开发者工具"编译"模式下无 JS/WXML 报错

## 测试策略

当前项目 `tests/` 目录未包含单元测试框架，采用手动验证。已提供上文"手动验证清单"作为验收路径。若后续引入 Jest/miniprogram-simulate，可参考源项目 `__tests__/checklist.test.js` 的形式补测。

## 未纳入本次范围

- 数据云端化（当前 106 项物品数据仍是硬编码，未来若需运营侧动态维护，可迁至云数据库集合，非本次目标）
- 云同步（当前状态仅本地缓存，跨端不同步，非本次目标）
