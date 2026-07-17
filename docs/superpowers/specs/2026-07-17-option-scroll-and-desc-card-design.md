# 选项横滑 + 图文说明区改造 · Design Spec

**日期**: 2026-07-17
**范围**: 空间设置页 (`pages/space-setup/`) + 成本预览页 (`cabinet/pages/materials/`)
**触发需求**: `docs/空间设置页面及成本五金选择页面选项改造.txt`

## 一、需求要点

原文档要求两处页面改造：

**空间设计页面**
- "是否有转角衣柜" 下的 4 个选项 (无转角 / 左转角柜 / 右转角柜 / 双侧转角柜) 从 2×2 网格改为**左右自由滑动**，默认可视 2 个，超出者靠横滑查看
- 选项条下方新增**图文说明区**：左图右文；点击不同选项切换到对应图文
- 图片：`cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/option-images/{id}.png`（若未上传专属图，fallback 到 `desc.png`）
- 文字：云数据库 `text_desc` 集合，`desc_type == "text_desc"` 且 `desc_code == 选项id` 的行的 `desc_name` 字段
- 需缓存，避免每次进页触网

**成本预览页面**
- "衣柜板材品牌" / "门板材质" / "门板工艺" 3 组选项做同样改造（横滑 + 图文说明区）
- **五金品牌 / 照明系统 保持原样**

**当前阶段**：所有选项暂时用同一张 `desc.png` + 同一段 `desc_name`（后续内容侧再补），代码路径需为差异化预留。

## 二、总体架构

抽 1 个可复用组件 + 1 个数据字典模块 + bootstrap 挂钩，共接入 4 处（空间设置页 1 处 + materials 页 3 处）。

```
miniprogram/
  utils/
    text-desc-dict.js        [新] 云表 text_desc 的本地字典 (storage + 后台刷新)
    bootstrap.js             [改] 新增 ensureUiDescReady()
  components/
    option-scroll-card/      [新] 横滑选项 + 图文说明区组件
      index.{js,json,wxml,wxss}
  pages/space-setup/
    index.{wxml,js,json,wxss}   [改] cornerType 区块换组件
  cabinet/pages/materials/
    index.{wxml,js,json,wxss}   [改] panel / doorPanel / doorCraft 3 区块换组件
  app.js                     [改] onLaunch 里 fire-and-forget 触发 ensureUiDescReady()
```

### 复用现有能力

- **图片缓存**：直接用 `utils/img-cache.js` 的 `resolve(fileID)`，已实现 storage 索引 + LRU 100 条 / 30MB + `getTempFileURL + downloadFile + copyFileSync` 全链。不再包一层。
- **数据字典**：`text-desc-dict.js` 完全参照 `price-dict.js` 骨架（读本地立即 ingest + 后台悄悄刷新覆盖）。

## 三、核心组件 `option-scroll-card`

### 接口

**properties**
| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `options` | `Array<{ id, name, desc? }>` | 是 | 选项列表；`desc` 是选项卡副标题（现有 materials 组数据有，corner 组没有） |
| `selectedId` | `string` | 是 | 当前选中的选项 id |
| `imageBase` | `string` | 否 | 默认 `cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/option-images` |
| `fallbackImageId` | `string` | 否 | 默认 `desc.png`（不带前缀，与 imageBase 拼接） |
| `showDesc` | `boolean` | 否 | 是否展示下方图文说明区，默认 `true` |

**events**
- `bind:change`：`detail = { id }`，用户选中新的选项

### 内部数据

- `descImagePath: string` —— 本地图片路径，`img-cache.resolve` 返回后 setData
- `descText: string` —— 云端文案，`text-desc-dict.getDesc(id)` 同步取

### 关键行为

1. `observers` 监听 `selectedId` 变化 → 重跑 `_refreshDesc(id)`
2. `_refreshDesc(id)`：
   - `descText = textDescDict.getDesc(id)`（miss → 空串）
   - `imgCache.resolve(`${imageBase}/${id}.png`)` → 命中或成功下载 → setData `descImagePath`
   - catch → fallback `imgCache.resolve(`${imageBase}/${fallbackImageId}`)` → setData
3. `onPick(e)` → `triggerEvent('change', { id: e.currentTarget.dataset.id })`（不做 setData，父页面控制 selectedId 是单向数据源）
4. `attached` 时如果 `textDescDict.isReady() === false`，setTimeout 300ms 后再 `_refreshDesc(this.data.selectedId)` 一次（等 preload 补上）

### wxml 结构

```wxml
<view class="osc-wrap">
  <scroll-view class="osc-list" scroll-x="{{true}}" show-scrollbar="{{false}}"
               enhanced="{{true}}" bounces="{{true}}">
    <view wx:for="{{options}}" wx:key="id"
          class="osc-item {{selectedId === item.id ? 'active' : ''}}"
          data-id="{{item.id}}" bindtap="onPick">
      <view class="osc-item-name">{{item.name}}</view>
      <view wx:if="{{item.desc}}" class="osc-item-desc">{{item.desc}}</view>
    </view>
  </scroll-view>

  <view class="osc-panel" wx:if="{{showDesc}}">
    <image wx:if="{{descImagePath}}" class="osc-panel-img"
           src="{{descImagePath}}" mode="aspectFill" />
    <view wx:else class="osc-panel-img osc-panel-img--placeholder"></view>
    <view class="osc-panel-text">{{descText}}</view>
  </view>
</view>
```

### 关键 CSS

```wxss
.osc-list { white-space: nowrap; }
.osc-item {
  display: inline-flex; flex-direction: column;
  width: calc((100% - 16rpx) / 2);   /* 精确 2 列 */
  margin-right: 16rpx;
  padding: 22rpx 18rpx;
  border: 2rpx solid #e5e7eb; border-radius: 14rpx;
  background: #fff; box-sizing: border-box;
  vertical-align: top;               /* 与 inline-flex 一起消基线间隙 */
}
.osc-item.active { border-color: #1f2937; background: #fef9c3; }
.osc-item-name  { font-size: 28rpx; color: #1f2937; font-weight: 500; }
.osc-item-desc  { font-size: 22rpx; color: #6b7280; margin-top: 4rpx; white-space: normal; }

.osc-panel {
  display: flex; margin-top: 20rpx;
  padding: 20rpx; background: #f9fafb; border-radius: 14rpx;
  align-items: flex-start; gap: 20rpx;
}
.osc-panel-img { width: 200rpx; height: 200rpx; border-radius: 12rpx; background: #e5e7eb; }
.osc-panel-img--placeholder { /* 灰底就好 */ }
.osc-panel-text { flex: 1; font-size: 26rpx; color: #4b5563; line-height: 1.6; word-break: break-all; }
```

`scroll-x + white-space: nowrap + inline-flex` 组合，用 `width: calc((100% - 16rpx) / 2)` 精确让首屏刚好显示 2 个卡片，第 3 个开始靠横滑露出。

## 四、数据字典 `utils/text-desc-dict.js`

参照 `price-dict.js`。

```js
const STORAGE_KEY = 'text_desc_v1';
const COLLECTION  = 'text_desc';
const PAGE_SIZE   = 20;

let _byCode = null;   // Map<desc_code, entry>
let _all = [];
let _ready = false;

function _ingest(rows) {
  _all = rows || [];
  _byCode = new Map();
  _all.forEach((r) => { if (r && r.desc_code) _byCode.set(r.desc_code, r); });
  _ready = true;
}

function _readStorage() { /* 与 price-dict 相同 */ }
function _writeStorage(rows) { /* 与 price-dict 相同 */ }

async function _fetchAll() {
  const db  = wx.cloud.database();
  const col = db.collection(COLLECTION).where({ desc_type: 'text_desc' });
  const { total } = await col.count();
  const out = [];
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const res = await col.skip(skip).limit(PAGE_SIZE).get();
    out.push(...(res.data || []));
  }
  return out;
}

async function preloadAll(opts) {
  const force = !!(opts && opts.force);
  if (!force) {
    const local = _readStorage();
    if (local) { _ingest(local); _refreshInBackground(); return; }
  }
  const remote = await _fetchAll();
  if (remote) { _ingest(remote); _writeStorage(remote); return; }
  if (_byCode === null) { _byCode = new Map(); _all = []; _ready = false; }
}

function _refreshInBackground() {
  _fetchAll().then((remote) => {
    if (remote && remote.length > 0) { _ingest(remote); _writeStorage(remote); }
  });
}

function get(descCode) { return _byCode ? _byCode.get(descCode) : undefined; }
function getDesc(descCode) {
  const e = get(descCode);
  return e ? (e.desc_name || '') : '';
}
function isReady() { return _ready; }

module.exports = { preloadAll, get, getDesc, isReady, _STORAGE_KEY: STORAGE_KEY };
```

**云端数据形状（每条文档）**
```js
{ _id: <auto>, desc_code: "corner_WZJ", desc_name: "无转角适用于…", desc_type: "text_desc" }
```

## 五、bootstrap 与 app.js

`utils/bootstrap.js`：
```js
const textDescDict = require('./text-desc-dict.js');
// ... 原有 imports

async function ensureUiDescReady(opts) {
  const force = !!(opts && opts.force);
  await textDescDict.preloadAll({ force })
    .catch((e) => console.warn('[bootstrap] text_desc fail', e));
}

module.exports = { ensureCostDataReady, isAllReady, ensureUiDescReady };
```

`app.js onLaunch` 里在现有 `ensureCostDataReady()` 调用旁边追加：
```js
bootstrap.ensureUiDescReady().catch((err) => {
  console.warn('[bootstrap] ensureUiDescReady failed:', err);
});
```

fire-and-forget，不阻塞。

## 六、页面接入

### 空间设置页 `pages/space-setup/`

**`index.json`**：加 `"usingComponents": { "option-scroll-card": "/components/option-scroll-card/index" }`

**`index.wxml`** 中的 `.corner-grid` 整块替换为：
```wxml
<option-scroll-card
  options="{{cornerOptions}}"
  selectedId="{{cornerType}}"
  bind:change="onCornerChange" />
```

**`index.js`**：
- `data.cornerOptions` 新常量：`[{id:'WZJ',name:'无转角'},{id:'ZZJ',name:'左转角柜'},{id:'YZJ',name:'右转角柜'},{id:'ZYZJ',name:'双侧转角柜'}]`
- 新方法 `onCornerChange(e) { this.setData({ cornerType: e.detail.id }); this.validate(); }`
- 保留 `onPickCorner` 或直接删除（原 wxml 引用被替换后无引用者）
- `onLoad` 末尾追加：`require('../../utils/bootstrap.js').ensureUiDescReady();`

**`index.wxss`**：`.corner-grid`、`.corner-cell` 相关旧样式可以删除（组件内自带样式）。

### materials 页 `cabinet/pages/materials/`

**`index.json`**：加组件引用。

**`index.wxml`** 中 3 个 section 里的 `.opts` 区块（衣柜板材品牌 / 门板材质 / 门板工艺）替换为：
```wxml
<option-scroll-card options="{{panelOpts}}" selectedId="{{materials.panel}}"
                    bind:change="onPickPanel" />
<option-scroll-card options="{{doorPanelOpts}}" selectedId="{{materials.doorPanel}}"
                    bind:change="onPickDoorPanel" />
<option-scroll-card options="{{doorCraftOpts}}" selectedId="{{materials.doorCraft}}"
                    bind:change="onPickDoorCraft" />
```

**五金品牌、照明系统 section 不动。**

**`index.js`**：
- 原 `pickPanel(e) { this._pick('panel', e.currentTarget.dataset.id) }` 改为 `onPickPanel(e) { this._pick('panel', e.detail.id) }`（同理 doorPanel / doorCraft）
- 五金、照明的 pick 方法不动
- 不需要在 `onLoad` 里再触发 `ensureUiDescReady`：app.onLaunch 已 fire-and-forget；进 materials 页大概率已经 ready

## 七、错误 / 降级路径

| 情况 | 表现 |
|---|---|
| `text_desc` 云集合未建 / 权限不足 | `preloadAll` catch 静默；`getDesc()` 返回 `''`；说明区图片正常，文本区空白 |
| `text_desc` 中某选项 miss | 该选项文案 `''`；同上 |
| `option-images/{id}.png` 不存在 | `img-cache.resolve` reject → catch 回落到 `desc.png` |
| 连 `desc.png` 也失败 | `descImagePath = ''`；wxml `wx:else` 分支显示灰底占位 |
| 冷启动首次进页 preload 未完成 | 组件 `attached` 检测 `isReady=false` 时挂 `setTimeout(300ms)` 补一次 `_refreshDesc` |

## 八、测试

### 单元测（`minitest/`）

- `text-desc-dict.test.js`：mock `wx.cloud.database`，覆盖：
  - `preloadAll` 本地无缓存 → 拉云 → ingest
  - `preloadAll` 本地有缓存 → 立即 ingest + 后台刷新覆盖
  - `getDesc(existing)` 返回 desc_name；`getDesc(missing)` 返回 `''`
  - 云端 total=45 → 分页 3 次（PAGE_SIZE=20）

### 手测清单

1. 空间设置页横滑显示 4 个转角选项；说明区图文出现
2. materials 页 3 区块横滑；点击不同选项文案随之切换
3. materials 页五金/照明区块保持原网格布局不变
4. 关网络冷启动 → 空间设置页文案区空白；下次开网启动后进页文案出现
5. 清 storage 后重开 → 首次进页可能空白，300ms 内文案补齐
6. 快速切换选项 → 图/文都跟得上，无残影

## 九、非目标 / YAGNI

- 不做每个选项差异化的图片和文案配置界面（先都指向 desc.png / 通用文案，未来数据侧填充）
- 不做说明区图片的懒加载（首屏 4 处组件同时活着也就 4 张图，`img-cache` 本地命中后同步返回）
- 不做说明区文字的富文本渲染（`text_desc.desc_name` 就是纯字符串）
- 不改动 materials 页的费用预览吸顶 / 云函数保存等无关逻辑
