# 选项横滑 + 图文说明区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把空间设置页的转角选项 (4 项) 与 materials 页的板材品牌/门板材质/门板工艺 (3 组) 改造为"横向自由滑动 · 默认可视 2 个 · 下方左图右文说明区"，图/文来自云存储 `option-images/{id}.png` (fallback `desc.png`) 与云表 `text_desc`。

**Architecture:** 抽 1 个可复用组件 `option-scroll-card`；文字缓存新增 `utils/text-desc-dict.js` (对齐现有 price-dict 缓存范式)；图片直接复用现有 `utils/img-cache.js`；`bootstrap.js` 追加 `ensureUiDescReady()`，`app.js onLaunch` fire-and-forget 触发。

**Tech Stack:** 微信小程序 (Component + wxml/wxss + wx.cloud.database) · Node 内建 test runner (`node --test`) 做单元测

**Design spec:** `docs/superpowers/specs/2026-07-17-option-scroll-and-desc-card-design.md`

---

## 文件清单

**Create:**
- `miniprogram/utils/text-desc-dict.js` — 文案字典（storage 缓存 + 云端 preload + 后台刷新）
- `miniprogram/components/option-scroll-card/index.js` — 组件逻辑
- `miniprogram/components/option-scroll-card/index.json` — 组件声明
- `miniprogram/components/option-scroll-card/index.wxml` — 组件模板
- `miniprogram/components/option-scroll-card/index.wxss` — 组件样式
- `tests/text-desc-dict.test.js` — 字典单元测

**Modify:**
- `miniprogram/utils/bootstrap.js` — 追加 `ensureUiDescReady()` 导出
- `miniprogram/app.js:82-90` 区块 — 追加 `ensureUiDescReady()` fire-and-forget
- `miniprogram/pages/space-setup/index.json` — 声明 `usingComponents`
- `miniprogram/pages/space-setup/index.wxml` — `.corner-grid` 区块替换为组件
- `miniprogram/pages/space-setup/index.js` — 加 `cornerOptions` 常量 + `onCornerChange` handler + `onLoad` 触发 `ensureUiDescReady`
- `miniprogram/pages/space-setup/index.wxss` — 删除废弃 `.corner-grid` `.corner-cell` 样式
- `miniprogram/cabinet/pages/materials/index.json` — 声明 `usingComponents`
- `miniprogram/cabinet/pages/materials/index.wxml` — 3 处 `.opts` 区块替换为组件
- `miniprogram/cabinet/pages/materials/index.js` — 3 个 pick handler 改从 `e.detail.id` 取值

**Test:**
- `tests/bootstrap.test.js` — 追加 `ensureUiDescReady` 覆盖用例（跟现有 pattern）

---

## Task 1: 新增 text-desc-dict 模块 (数据字典)

**Files:**
- Create: `miniprogram/utils/text-desc-dict.js`
- Test: `tests/text-desc-dict.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/text-desc-dict.test.js`：

```js
// tests/text-desc-dict.test.js
// text_desc 字典: preloadAll 拉云表 (where desc_type='text_desc') → storage;
// get(desc_code)/getDesc(desc_code) 同步查缓存。Node 环境注入 mock wx。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh() {
  const p = path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js');
  delete require.cache[p];
  return require(p);
}

function makeStorageMock() {
  const store = {};
  return {
    store,
    setStorageSync(k, v) { store[k] = v; },
    getStorageSync(k) { return store[k]; },
    removeStorageSync(k) { delete store[k]; },
  };
}

// 支持 where(cond).skip.limit.count/get
function makeCloudMock(rows) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'text_desc');
          return {
            _cond: null, _skip: 0, _limit: 20,
            where(c) { this._cond = c; return this; },
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            count: async function () {
              const f = this._cond
                ? rows.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]))
                : rows;
              return { total: f.length };
            },
            get: async function () {
              const f = this._cond
                ? rows.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]))
                : rows;
              return { data: f.slice(this._skip, this._skip + this._limit) };
            },
          };
        },
      };
    },
  };
}

const SAMPLE = [
  { desc_code: 'WZJ', desc_name: '无转角适用于矩形墙面', desc_type: 'text_desc' },
  { desc_code: 'ZZJ', desc_name: '左转角柜适用于 L 型左角', desc_type: 'text_desc' },
  { desc_code: 'panel_e2_domestic', desc_name: 'E2 国产板性价比首选', desc_type: 'text_desc' },
  { desc_code: 'unrelated', desc_name: '与此模块无关', desc_type: 'other_type' },
];

test('preloadAll 首次: 拉云表 (只 text_desc 类型) 写 storage; get/getDesc 命中', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    assert.equal(dict.get('ZZJ').desc_name, '左转角柜适用于 L 型左角');
    assert.equal(dict.getDesc('nonexistent'), '');
    // 只应拿到 desc_type=text_desc 的 3 条 (不含 unrelated)
    assert.equal(wx.store['text_desc_v1'].length, 3);
    // 校验 unrelated 未被写入
    assert.ok(!wx.store['text_desc_v1'].some((r) => r.desc_code === 'unrelated'));
  } finally { delete global.wx; }
});

test('preloadAll 二次: 立即用本地缓存, isReady=true, 后台仍刷新一次', async () => {
  const wx = makeStorageMock();
  wx.store['text_desc_v1'] = SAMPLE.filter((r) => r.desc_type === 'text_desc');
  const FRESH = wx.store['text_desc_v1'].concat([
    { desc_code: 'NEW', desc_name: '新添说明', desc_type: 'text_desc' },
  ]);
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(FRESH) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    // 立即命中本地缓存,还没看到 NEW
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    assert.equal(dict.getDesc('NEW'), '');
    assert.equal(dict.isReady(), true);
    // 等后台 fire-and-forget 结束
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(dict.getDesc('NEW'), '新添说明');
    assert.equal(wx.store['text_desc_v1'].length, 4);
  } finally { delete global.wx; }
});

test('preloadAll force=true 云失败但有旧数据: isReady 仍 true, 保留旧值', async () => {
  const wx = makeStorageMock();
  wx.store['text_desc_v1'] = SAMPLE.filter((r) => r.desc_type === 'text_desc');
  let firstCall = true;
  const cloud = {
    database() {
      return {
        collection() {
          return {
            _cond: null, _skip: 0, _limit: 20,
            where(c) { this._cond = c; return this; },
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            count: async function () {
              if (!firstCall) throw new Error('down');
              const f = SAMPLE.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]));
              return { total: f.length };
            },
            get: async function () {
              const f = SAMPLE.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]));
              return { data: f.slice(this._skip, this._skip + this._limit) };
            },
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const dict = loadFresh();
    await dict.preloadAll({ force: true });
    assert.equal(dict.isReady(), true);
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    firstCall = false;
    await dict.preloadAll({ force: true });
    // 旧数据仍在,isReady 不因单次失败翻转
    assert.equal(dict.isReady(), true);
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
  } finally { delete global.wx; }
});

test('无 wx 环境: 所有 API 退化 no-op', async () => {
  delete global.wx;
  const dict = loadFresh();
  await dict.preloadAll();
  assert.equal(dict.getDesc('WZJ'), '');
  assert.equal(dict.get('WZJ'), undefined);
  assert.equal(dict.isReady(), false);
});

test('preloadAll 分页: >20 条要多次 get', async () => {
  const wx = makeStorageMock();
  const many = Array.from({ length: 47 }, (_, i) => ({
    desc_code: 'k' + i, desc_name: '说明' + i, desc_type: 'text_desc',
  }));
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(many) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.getDesc('k0'), '说明0');
    assert.equal(dict.getDesc('k46'), '说明46');
  } finally { delete global.wx; }
});
```

- [ ] **Step 2: 运行测试确认全部失败**

Run: `node --test tests/text-desc-dict.test.js`
Expected: 全部 FAIL（模块尚未创建），报错类似 `Cannot find module '../miniprogram/utils/text-desc-dict.js'`

- [ ] **Step 3: 实现 text-desc-dict.js**

创建 `miniprogram/utils/text-desc-dict.js`：

```js
// utils/text-desc-dict.js
// UI 文案字典: 小程序启动时预拉云表 `text_desc` (仅 desc_type='text_desc') 到 storage;
// 后续 get(desc_code) / getDesc(desc_code) 同步读, 不再触网。
// 消费方: option-scroll-card 组件 (下方图文说明区的文字部分)。
//
// 数据形状: { desc_code, desc_name, desc_type }, 我们只关心 desc_type='text_desc' 的行。

const STORAGE_KEY = 'text_desc_v1';
const COLLECTION  = 'text_desc';
const DESC_TYPE   = 'text_desc';
const PAGE_SIZE   = 20;  // 微信小程序 db 单次上限

let _byCode = null;  // Map<desc_code, entry>
let _all = [];       // entry[]
let _ready = false;

function _ingest(rows) {
  _all = rows || [];
  _byCode = new Map();
  _all.forEach((r) => { if (r && r.desc_code) _byCode.set(r.desc_code, r); });
  _ready = true;
}

function _readStorage() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch (e) { return null; }
}

function _writeStorage(rows) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return;
  try { wx.setStorageSync(STORAGE_KEY, rows); }
  catch (e) { console.warn('[text-desc-dict] setStorage fail', e && e.errMsg); }
}

async function _fetchAll() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION).where({ desc_type: DESC_TYPE });
    const { total } = await col.count();
    const out = [];
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await db.collection(COLLECTION).where({ desc_type: DESC_TYPE })
                          .skip(skip).limit(PAGE_SIZE).get();
      out.push(...(res.data || []));
    }
    return out;
  } catch (e) {
    console.warn('[text-desc-dict] fetch fail', e && e.errMsg);
    return null;
  }
}

// preloadAll: 读本地 → ingest → 后台悄悄拉云覆盖
//   force=true:  阻塞拉云 → 覆盖 storage/内存
//   force=false: 本地有 → 立即 ingest, 后台再拉一次静默覆盖; 本地无 → 阻塞拉云
async function preloadAll(opts) {
  const force = !!(opts && opts.force);
  if (!force) {
    const local = _readStorage();
    if (local) {
      _ingest(local);
      _refreshInBackground();
      return;
    }
  }
  const remote = await _fetchAll();
  if (remote) { _ingest(remote); _writeStorage(remote); return; }
  if (_byCode === null) {
    _byCode = new Map();
    _all = [];
    _ready = false;
  }
}

function _refreshInBackground() {
  _fetchAll().then((remote) => {
    if (remote && Array.isArray(remote) && remote.length > 0) {
      _ingest(remote);
      _writeStorage(remote);
    }
  });
}

function get(descCode) { return _byCode ? _byCode.get(descCode) : undefined; }

function getDesc(descCode) {
  const entry = get(descCode);
  return entry ? (entry.desc_name || '') : '';
}

function isReady() { return _ready; }

module.exports = { preloadAll, get, getDesc, isReady, _STORAGE_KEY: STORAGE_KEY };
```

**注：** `_fetchAll` 中 `count()` 后重新拿 `db.collection(...)` 重新 `where` 是为了避免 mock 里的链式 state 被 count 污染 (`_skip/_limit` 落到实例上)；同时避免真机上 `where + skip + limit` 的复用不一致。参照 `panel-dict.js`。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test tests/text-desc-dict.test.js`
Expected: 5 个 test 全 PASS

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/text-desc-dict.js tests/text-desc-dict.test.js
git commit -m "feat(utils): text-desc-dict for UI copy from cloud text_desc collection

- Mirrors price-dict cache pattern: storage read → immediate ingest → background refresh
- Filters cloud query to desc_type='text_desc' at DB level (server-side WHERE)
- getDesc(code) sync API for components; miss → empty string
- Full test coverage: pagination, cold start, hot start, force refresh, network fail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: bootstrap 追加 ensureUiDescReady

**Files:**
- Modify: `miniprogram/utils/bootstrap.js`
- Test: `tests/bootstrap.test.js` (追加用例)

- [ ] **Step 1: 追加失败测试**

在 `tests/bootstrap.test.js` 末尾追加：

```js
test('ensureUiDescReady: 拉 text_desc 后 text-desc-dict.isReady=true', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, {
    cloud: makeCloudMock({
      price: [{ code: 'panel_egger', price: 195, category: 'panel' }],
      panel_name_dict: [{ panel_code: 'top_panel_18', display_name: '顶板', category: 'cabinet_frame', enable: true }],
      model_panel_hardware: [{ glb_file_name: '50A.glb', is_online: true, total_body_area: 4.7 }],
      text_desc: [{ desc_code: 'WZJ', desc_name: '无转角', desc_type: 'text_desc' }],
    }),
  });
  try {
    // 需要在 loadFreshBootstrap 里带上 text-desc-dict 的清缓存, 见下一步
    const bootstrap = require(path.resolve(__dirname, '../miniprogram/utils/bootstrap.js'));
    delete require.cache[path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js')];
    delete require.cache[path.resolve(__dirname, '../miniprogram/utils/bootstrap.js')];
    const bootstrapFresh = require(path.resolve(__dirname, '../miniprogram/utils/bootstrap.js'));
    const textDesc = require(path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js'));
    assert.equal(textDesc.isReady(), false);
    await bootstrapFresh.ensureUiDescReady();
    assert.equal(textDesc.isReady(), true);
    assert.equal(textDesc.getDesc('WZJ'), '无转角');
  } finally { delete global.wx; }
});

test('ensureUiDescReady: 云失败不抛', async () => {
  const wx = makeStorageMock();
  const cloud = {
    database() {
      return {
        collection() {
          return {
            where() { return this; }, skip() { return this; }, limit() { return this; },
            count: async () => { throw new Error('down'); },
            get: async () => ({ data: [] }),
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    delete require.cache[path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js')];
    delete require.cache[path.resolve(__dirname, '../miniprogram/utils/bootstrap.js')];
    const bootstrap = require(path.resolve(__dirname, '../miniprogram/utils/bootstrap.js'));
    await bootstrap.ensureUiDescReady();  // 不抛
    const textDesc = require(path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js'));
    assert.equal(textDesc.isReady(), false);
  } finally { delete global.wx; }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bootstrap.test.js`
Expected: 新增 2 个 test FAIL —— `bootstrap.ensureUiDescReady is not a function`

- [ ] **Step 3: 修改 bootstrap.js**

用 Edit 工具把 `miniprogram/utils/bootstrap.js` 整个替换为：

```js
// 成本数据启动编排: 并行触发 price/panel/model_meta 三张字典的 preloadAll。
// 由 app.onLaunch 调 ensureCostDataReady(不 await, fire-and-forget), 每次成本页也会再校验。
// 目标是"启动写 storage → 成本页同步命中", 不阻塞其他业务。
//
// 另外提供 ensureUiDescReady 拉 text_desc 供 option-scroll-card 组件的图文说明区使用,
// 与成本无关, 独立编排, 命名分离。

const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMetaCache = require('./model-meta-cache.js');
const textDescDict = require('./text-desc-dict.js');

async function ensureCostDataReady(opts) {
  const force = !!(opts && opts.force);
  await Promise.all([
    priceDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] price fail', e)),
    panelDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] panel fail', e)),
    modelMetaCache.preloadAll().catch((e) => console.warn('[bootstrap] meta fail', e)),
  ]);
}

async function ensureUiDescReady(opts) {
  const force = !!(opts && opts.force);
  await textDescDict.preloadAll({ force })
    .catch((e) => console.warn('[bootstrap] text_desc fail', e));
}

function isAllReady() {
  return priceDict.isReady() && panelDict.isReady();
  // model-meta-cache 无 isReady: 成本页会按具体 fileName 判 peekMeta,
  // 缺哪个柜的元数据只影响那一柜, 不阻塞其他柜。
  // text-desc-dict 也不算入: UI 说明区可缺, 页面仍能正常用。
}

module.exports = { ensureCostDataReady, isAllReady, ensureUiDescReady };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/bootstrap.test.js`
Expected: 全部 test PASS (原有 3 + 新增 2 = 5 个)

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/bootstrap.js tests/bootstrap.test.js
git commit -m "feat(bootstrap): ensureUiDescReady() for text_desc dict

Adds a separate boot path for UI copy dict (text_desc). Named apart
from cost data because it's used by option-scroll-card component in
space-setup and materials, unrelated to cost. Fail-silent: caller
does not await; missing copy just leaves the description area blank.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: app.js onLaunch 触发 ensureUiDescReady

**Files:**
- Modify: `miniprogram/app.js:82-90` (在现有 `ensureCostDataReady` 触发块附近追加)

- [ ] **Step 1: 追加触发代码**

用 Edit 工具把这段：

```js
    // 成本模块 3 字典 (价格/板件中英/glb元数据) 启动预拉:不 await, 后台跑;
    // 成本页会再校验字典状态, 缺则 toast + "——" 降级 (Task 9 处理)。
    try {
      var bootstrap = require('./utils/bootstrap.js');
      bootstrap.ensureCostDataReady().catch(function (err) {
        console.warn('[bootstrap] ensureCostDataReady failed:', err);
      });
    } catch (e) {
      console.warn('[bootstrap] init failed:', e);
    }
```

替换成：

```js
    // 成本模块 3 字典 (价格/板件中英/glb元数据) 启动预拉:不 await, 后台跑;
    // 成本页会再校验字典状态, 缺则 toast + "——" 降级 (Task 9 处理)。
    // text_desc UI 文案字典同样 fire-and-forget, 供 option-scroll-card 组件使用。
    try {
      var bootstrap = require('./utils/bootstrap.js');
      bootstrap.ensureCostDataReady().catch(function (err) {
        console.warn('[bootstrap] ensureCostDataReady failed:', err);
      });
      bootstrap.ensureUiDescReady().catch(function (err) {
        console.warn('[bootstrap] ensureUiDescReady failed:', err);
      });
    } catch (e) {
      console.warn('[bootstrap] init failed:', e);
    }
```

- [ ] **Step 2: 提交**

```bash
git add miniprogram/app.js
git commit -m "feat(app): fire-and-forget ensureUiDescReady on onLaunch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 组件骨架 — index.json + wxml + wxss

**Files:**
- Create: `miniprogram/components/option-scroll-card/index.json`
- Create: `miniprogram/components/option-scroll-card/index.wxml`
- Create: `miniprogram/components/option-scroll-card/index.wxss`

- [ ] **Step 1: 创建 index.json**

```json
{
  "component": true
}
```

- [ ] **Step 2: 创建 index.wxml**

```xml
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

- [ ] **Step 3: 创建 index.wxss**

```wxss
.osc-wrap {
  width: 100%;
  box-sizing: border-box;
}

/* 横向滚动: white-space:nowrap + inline-flex 消基线间隙 + 定宽让首屏刚好 2 个 */
.osc-list {
  white-space: nowrap;
  width: 100%;
}

.osc-item {
  display: inline-flex;
  flex-direction: column;
  vertical-align: top;                       /* 与 inline-flex 一起消基线间隙 */
  width: calc((100% - 16rpx) / 2);           /* 精确 2 列, 间距 16rpx */
  margin-right: 16rpx;
  padding: 22rpx 18rpx;
  box-sizing: border-box;
  background: #fff;
  border: 2rpx solid #e5e7eb;
  border-radius: 14rpx;
}

.osc-item:last-child { margin-right: 0; }

.osc-item.active {
  border-color: #1f2937;
  background: #fef9c3;
}

.osc-item-name {
  font-size: 28rpx;
  color: #1f2937;
  font-weight: 500;
  white-space: normal;         /* 单独放开, 避免 osc-list 的 nowrap 影响卡片内 */
  word-break: break-all;
}

.osc-item-desc {
  font-size: 22rpx;
  color: #6b7280;
  margin-top: 4rpx;
  white-space: normal;
  word-break: break-all;
}

.osc-panel {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  background: #f9fafb;
  border-radius: 14rpx;
}

.osc-panel-img {
  width: 200rpx;
  height: 200rpx;
  border-radius: 12rpx;
  background: #e5e7eb;
  flex-shrink: 0;
}

.osc-panel-img--placeholder {
  /* 灰底 + 无 src, 已足够表达"加载中/无图" */
}

.osc-panel-text {
  flex: 1;
  font-size: 26rpx;
  color: #4b5563;
  line-height: 1.6;
  word-break: break-all;
}
```

- [ ] **Step 4: 提交（组件逻辑放到下一 Task）**

```bash
git add miniprogram/components/option-scroll-card/index.json miniprogram/components/option-scroll-card/index.wxml miniprogram/components/option-scroll-card/index.wxss
git commit -m "feat(components): option-scroll-card skeleton (json/wxml/wxss)

Horizontal-scroll options with 2 items visible + left-image right-text
description panel. Logic in following commit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 组件逻辑 — index.js

**Files:**
- Create: `miniprogram/components/option-scroll-card/index.js`

- [ ] **Step 1: 创建 index.js**

```js
// components/option-scroll-card/index.js
// 横向自由滑动的选项条 + 下方图文说明区 (左图 200×200 + 右文)。
// 消费方: 空间设置页的转角选择, materials 页的板材品牌/门板材质/门板工艺。
//
// 图片: 拼 imageBase/{id}.png fileID → img-cache.resolve → 本地路径; 失败 fallback desc.png。
// 文字: text-desc-dict.getDesc(id) 同步查缓存, 缓存未就绪 → 挂 setTimeout 补一次。

const imgCache = require('../../utils/img-cache.js');
const textDescDict = require('../../utils/text-desc-dict.js');

const DEFAULT_IMAGE_BASE = 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/option-images';
const DEFAULT_FALLBACK = 'desc.png';

Component({
  properties: {
    options: { type: Array, value: [] },
    selectedId: { type: String, value: '' },
    imageBase: { type: String, value: DEFAULT_IMAGE_BASE },
    fallbackImageId: { type: String, value: DEFAULT_FALLBACK },
    showDesc: { type: Boolean, value: true },
  },
  data: {
    descImagePath: '',
    descText: '',
  },
  observers: {
    // selectedId 变 或 imageBase 变 → 重刷图文
    'selectedId, imageBase, fallbackImageId': function (id) {
      if (id) this._refreshDesc(id);
    },
  },
  lifetimes: {
    attached() {
      const id = this.data.selectedId;
      if (!id) return;
      this._refreshDesc(id);
      // 冷启动首次进页 preload 可能还没完成; 挂一次补偿, 300ms 内基本就绪。
      if (!textDescDict.isReady()) {
        setTimeout(() => {
          // 只补文本, 图片链路是异步的自身会更新
          const cur = this.data.selectedId;
          if (cur) {
            this.setData({ descText: textDescDict.getDesc(cur) });
          }
        }, 300);
      }
    },
  },
  methods: {
    onPick(e) {
      const id = e.currentTarget.dataset.id;
      if (!id || id === this.data.selectedId) return;
      this.triggerEvent('change', { id });
      // 不本地 setData({selectedId}): 由父页面控制 (单向数据源, 与现有 materials 页 pattern 对齐)
    },

    _refreshDesc(id) {
      // 同步先把文字更新掉 (miss → 空串)
      this.setData({ descText: textDescDict.getDesc(id) });

      if (!this.data.showDesc) return;

      const base = this.data.imageBase || DEFAULT_IMAGE_BASE;
      const fallback = this.data.fallbackImageId || DEFAULT_FALLBACK;
      const primaryID = base + '/' + id + '.png';
      const fallbackID = base + '/' + fallback;

      // requestSeq 防串: 快速点选时旧请求 resolve 后不应覆盖新请求结果。
      this._reqSeq = (this._reqSeq || 0) + 1;
      const mySeq = this._reqSeq;
      const setIfCurrent = (path) => {
        if (mySeq !== this._reqSeq) return;   // 已被后续点选覆盖
        this.setData({ descImagePath: path || '' });
      };

      imgCache.resolve(primaryID)
        .then(setIfCurrent)
        .catch(() => {
          imgCache.resolve(fallbackID)
            .then(setIfCurrent)
            .catch(() => setIfCurrent(''));
        });
    },
  },
});
```

- [ ] **Step 2: 提交**

```bash
git add miniprogram/components/option-scroll-card/index.js
git commit -m "feat(components): option-scroll-card logic

- observers: selectedId/imageBase change → _refreshDesc
- attached: initial refresh + 300ms retry if text-desc-dict not yet ready
- _refreshDesc: sync text lookup + async img-cache.resolve with fallback
- request seq guards fast-clicks against stale image responses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 接入空间设置页

**Files:**
- Modify: `miniprogram/pages/space-setup/index.json`
- Modify: `miniprogram/pages/space-setup/index.wxml:33-40` (`.corner-grid` 区块)
- Modify: `miniprogram/pages/space-setup/index.js` (cornerOptions 常量 + onCornerChange + onLoad 触发 ensureUiDescReady)
- Modify: `miniprogram/pages/space-setup/index.wxss` (删除 .corner-grid / .corner-cell 样式)

- [ ] **Step 1: 修改 index.json**

用 Edit 把内容替换为：

```json
{
  "usingComponents": {
    "option-scroll-card": "/components/option-scroll-card/index"
  }
}
```

(若原文件有其他键，保留原有键，仅追加 `usingComponents`。用 Read 确认后决定。)

- [ ] **Step 2: 修改 index.wxml — 替换 `.corner-grid` 区块**

用 Edit 把：

```xml
    <view class="corner-grid">
      <view class="corner-cell {{cornerType === 'WZJ' ? 'active' : ''}}" data-v="WZJ" bindtap="onPickCorner">无转角</view>
      <view class="corner-cell {{cornerType === 'ZZJ' ? 'active' : ''}}" data-v="ZZJ" bindtap="onPickCorner">左转角柜</view>
      <view class="corner-cell {{cornerType === 'YZJ' ? 'active' : ''}}" data-v="YZJ" bindtap="onPickCorner">右转角柜</view>
      <view class="corner-cell {{cornerType === 'ZYZJ' ? 'active' : ''}}" data-v="ZYZJ" bindtap="onPickCorner">双侧转角柜</view>
    </view>
```

替换为：

```xml
    <option-scroll-card
      options="{{cornerOptions}}"
      selectedId="{{cornerType}}"
      bind:change="onCornerChange" />
```

- [ ] **Step 3: 修改 index.js**

在 `data:{...}` 里追加 `cornerOptions` 常量数组。用 Edit 把：

```js
  data: {
    photoPath: '',
    name: '',
    wallW: '',
    wallH: '',
    cornerType: 'WZJ',
    errorMsg: '',
    canSubmit: false,
  },
```

替换为：

```js
  data: {
    photoPath: '',
    name: '',
    wallW: '',
    wallH: '',
    cornerType: 'WZJ',
    errorMsg: '',
    canSubmit: false,
    cornerOptions: [
      { id: 'WZJ',  name: '无转角' },
      { id: 'ZZJ',  name: '左转角柜' },
      { id: 'YZJ',  name: '右转角柜' },
      { id: 'ZYZJ', name: '双侧转角柜' },
    ],
  },
```

在 `onLoad` 里追加 `ensureUiDescReady`。用 Edit 把：

```js
  onLoad() {
    const draft = getApp().globalData.draftPlan;
    if (draft) {
```

替换为：

```js
  onLoad() {
    // 首次进页触发 UI 文案字典拉取 (fire-and-forget, 命中缓存即零耗时)
    require('../../utils/bootstrap.js').ensureUiDescReady();

    const draft = getApp().globalData.draftPlan;
    if (draft) {
```

替换旧的 `onPickCorner` (要保留 validate 逻辑)。用 Edit 把：

```js
  onPickCorner(e) {
    this.setData({ cornerType: e.currentTarget.dataset.v });
    this.validate();
  },
```

替换为：

```js
  onCornerChange(e) {
    this.setData({ cornerType: e.detail.id });
    this.validate();
  },
```

- [ ] **Step 4: 修改 index.wxss**

用 Edit 把这段整块删除（无引用者）：

```css
.corner-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.corner-cell {
  border: 2rpx solid #e5e7eb;
  border-radius: 12rpx;
  padding: 24rpx;
  text-align: center;
  font-size: 28rpx;
  color: #4b5563;
}

.corner-cell.active {
  border-color: #1f2937;
  background: #fef9c3;
  color: #1f2937;
  font-weight: 500;
}
```

替换为（空串或直接留空行）：

```css
```

- [ ] **Step 5: 提交**

```bash
git add miniprogram/pages/space-setup/index.json miniprogram/pages/space-setup/index.wxml miniprogram/pages/space-setup/index.js miniprogram/pages/space-setup/index.wxss
git commit -m "feat(space-setup): use option-scroll-card for corner picker

- 4 corner options now horizontally scroll (2 visible at a time)
- description card below shows image + text for selected option
- onLoad triggers ensureUiDescReady fire-and-forget for cold-start
- drops the 2x2 grid CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 接入 materials 页 3 个区块

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.json`
- Modify: `miniprogram/cabinet/pages/materials/index.wxml` (3 处 .opts 区块)
- Modify: `miniprogram/cabinet/pages/materials/index.js` (3 个 pick handler)

- [ ] **Step 1: 修改 index.json**

用 Read 看现有 json，然后用 Edit 追加 usingComponents。假设原内容仅 `{}` 或 backgroundTextStyle 等，改后包含：

```json
{
  "usingComponents": {
    "option-scroll-card": "/components/option-scroll-card/index"
  }
}
```

（若原有其他键，用 Edit 合并保留。）

- [ ] **Step 2: 修改 index.wxml — 板材品牌区块**

用 Edit 把：

```xml
    <view class="sub">板材品牌决定柜体环保等级与寿命</view>
    <view class="opts">
      <view class="opt {{materials.panel === item.id ? 'active' : ''}}"
            wx:for="{{panelOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickPanel">
        <view class="opt-name">{{item.name}}</view>
        <view class="opt-desc">{{item.desc}}</view>
      </view>
    </view>
```

替换为：

```xml
    <view class="sub">板材品牌决定柜体环保等级与寿命</view>
    <option-scroll-card
      options="{{panelOpts}}"
      selectedId="{{materials.panel}}"
      bind:change="onPickPanel" />
```

- [ ] **Step 3: 修改 index.wxml — 门板材质区块**

用 Edit 把：

```xml
    <view class="sub">门板表面材质（加价项）</view>
    <view class="opts">
      <view class="opt {{materials.doorPanel === item.id ? 'active' : ''}}"
            wx:for="{{doorPanelOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickDoorPanel">
        <view class="opt-name">{{item.name}}</view>
        <view class="opt-desc">{{item.desc}}</view>
      </view>
    </view>
```

替换为：

```xml
    <view class="sub">门板表面材质（加价项）</view>
    <option-scroll-card
      options="{{doorPanelOpts}}"
      selectedId="{{materials.doorPanel}}"
      bind:change="onPickDoorPanel" />
```

- [ ] **Step 4: 修改 index.wxml — 门板工艺区块**

用 Edit 把：

```xml
    <view class="sub">门板造型工艺（加价项）</view>
    <view class="opts row-4">
      <view class="opt {{materials.doorCraft === item.id ? 'active' : ''}}"
            wx:for="{{doorCraftOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickDoorCraft">
        <view class="opt-name">{{item.name}}</view>
      </view>
    </view>
```

替换为：

```xml
    <view class="sub">门板造型工艺（加价项）</view>
    <option-scroll-card
      options="{{doorCraftOpts}}"
      selectedId="{{materials.doorCraft}}"
      bind:change="onPickDoorCraft" />
```

**注意：** 五金品牌、照明系统的 `.opts.row-2 / .opts.row-3` 区块**不改**，`pickHardware / pickLighting` 方法也**不动**。

- [ ] **Step 5: 修改 index.js — pick handlers**

用 Edit 把：

```js
  pickPanel(e) {
    this._pick('panel', e.currentTarget.dataset.id);
  },
  pickDoorPanel(e) {
    this._pick('doorPanel', e.currentTarget.dataset.id);
  },
  pickDoorCraft(e) {
    this._pick('doorCraft', e.currentTarget.dataset.id);
  },
```

替换为：

```js
  // 三个 handler 名带 on 前缀, 从 e.detail.id 取值 (option-scroll-card 组件的 change 事件)
  onPickPanel(e) {
    this._pick('panel', e.detail.id);
  },
  onPickDoorPanel(e) {
    this._pick('doorPanel', e.detail.id);
  },
  onPickDoorCraft(e) {
    this._pick('doorCraft', e.detail.id);
  },
```

（`pickHardware`、`pickLighting`、`_pick` 均保持原样。）

- [ ] **Step 6: 提交**

```bash
git add miniprogram/cabinet/pages/materials/index.json miniprogram/cabinet/pages/materials/index.wxml miniprogram/cabinet/pages/materials/index.js
git commit -m "feat(materials): use option-scroll-card for panel/doorPanel/doorCraft

- 3 groups now horizontally scroll (2 visible), each with left-image right-text
  description card below
- pickHandler renamed to onPickXxx and reads e.detail.id from component event
- hardware and lighting sections stay grid-layout (unchanged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 跑全量单元测确认无回归

**Files:** (无改动)

- [ ] **Step 1: 跑测试**

Run: `node --test tests/`
Expected: 全部测试 PASS，特别关注：
- `text-desc-dict.test.js`: 5/5 PASS
- `bootstrap.test.js`: 5/5 PASS (原 3 + 新 2)
- 其他测试（cost-engine, price-dict, panel-dict, model-meta-cache 等）0 回归

若有失败：先看是否与本次改动相关；不相关的失败在本次改动前就存在，跳过。

- [ ] **Step 2: 手测清单（人肉过一遍）**

打开微信开发者工具，编译预览。逐项验证：

1. **首次冷启动进空间设置页**：
   - 转角选项条横向可滑，默认可视 2 个（无转角 + 左转角柜），滑动后能看到 右转角柜 / 双侧转角柜
   - 下方图文说明区显示 200×200 图 + 右侧文字
   - 点击不同选项，图文区图片和文字更新（现阶段都是同一份 desc.png / 同一段文本，看是否能触发 setData）
2. **空间设置页填完后进 materials 页**：
   - 板材品牌 / 门板材质 / 门板工艺 3 组都是横滑 + 图文说明
   - 五金品牌 / 照明系统 保持原网格布局
   - 点选任一板材，费用预览刷新且图文区跟着换
3. **关网络冷启动**：
   - 首次进空间设置页：文字空白（wx:if 没有 descText 就不渲染，或直接空文本），不 crash；图会拉不到但有灰底占位
   - 开网后杀掉重开，第二次进：文/图正常出现
4. **快速切换选项**：
   - 连点 3 个不同选项 → 最终显示的图文对应最后一次点击的（`_reqSeq` 防串）
5. **返回上一页再进来**：
   - 无残影，selectedId 与 cornerType 一致

- [ ] **Step 3: 若有 bug 修完再进入 Task 9；如无 bug 直接进 Task 9**

---

## Task 9: 一次性最终提交（若手测暴露小问题）

**Files:** 视情况而定

- [ ] **Step 1: 若 Task 8 手测未发现问题，跳过本 Task**

- [ ] **Step 2: 若发现问题**，用 Edit 修完对应文件，跑 `node --test tests/` 无回归后 commit：

```bash
git commit -m "fix(option-scroll-card): <具体描述>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 自查清单（写完 plan 自审）

- ✅ Spec 每节都有 task 覆盖：
  - 空间设置改造 → Task 6
  - materials 3 组改造 → Task 7
  - text_desc 缓存 → Task 1
  - img-cache 复用 → Task 5（组件内直接调 `imgCache.resolve`，无新模块）
  - bootstrap 集成 → Task 2
  - app.onLaunch 触发 → Task 3
  - 组件实现 → Task 4 + 5
  - 冷启动兜底 (300ms setTimeout) → Task 5 `attached` 生命周期
  - 快速点选防串 → Task 5 `_reqSeq`
  - fallback 到 desc.png → Task 5 `_refreshDesc`
  - 测试 → Task 1, 2, 8
- ✅ 无占位符 / TBD
- ✅ 类型 / 方法名一致：
  - `getDesc` 在 Task 1 定义，Task 5 用 `textDescDict.getDesc(id)` 一致
  - `preloadAll / isReady / get` 三个 API 名字通篇一致
  - `_refreshDesc` 在 Task 5 内一致
  - 组件事件 `bind:change` + `e.detail.id` 在 Task 5/6/7 三处一致
