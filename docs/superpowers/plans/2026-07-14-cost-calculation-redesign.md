# 成本透视模块改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `cost-engine.js` 从硬编码 xlsx 公式重写为数据驱动:价格从云表 `price` 查, 板件面积/五金数量从云表 `model_panel_hardware` 的 glb 元数据取, 明细中文名从 `panel_name_dict` 查; 非标(50A/100A)与加高(50G1/100G1/YG*/ZG*)按严格公式实时重算板件尺寸。

**Architecture:** 三个新字典模块(`price-dict.js` / `panel-dict.js` / `panel-formulas.js`)+ 扩展 `model-meta-cache.js` 补 `preloadAll` + 新增 `bootstrap.js` 编排三张表启动预拉 + 重写 `cost-engine.js`。materials/cost 页做 id 与错误 UI 的小改。

**Tech Stack:** 微信小程序 (wx.cloud.database) · Node 内置 test runner (`node --test`) · CommonJS。

**Reference spec:** `docs/superpowers/specs/2026-07-14-cost-calculation-redesign-design.md` — 有细节冲突时以本 plan 为准, 但两文档设计一致。

---

## 文件影响清单

**新增**:
- `miniprogram/utils/price-dict.js` — 价格字典 (preloadAll / get / all / getByCategory)
- `miniprogram/utils/panel-dict.js` — 板件中英映射
- `miniprogram/utils/panel-formulas.js` — 严格板件公式表
- `miniprogram/utils/bootstrap.js` — 三字典启动编排
- `tests/price-dict.test.js`
- `tests/panel-dict.test.js`
- `tests/panel-formulas.test.js`
- `tests/cost-engine.test.js`
- `tests/bootstrap.test.js`

**修改**:
- `miniprogram/utils/model-meta-cache.js` — 补 `preloadAll()`
- `miniprogram/utils/cost-engine.js` — 完全重写
- `miniprogram/app.js` — `onLaunch` 里调 bootstrap
- `miniprogram/cabinet/pages/materials/index.js` — 选项 id 全部换 code
- `miniprogram/cabinet/pages/cost/index.js` — 错误 UI、`——` 占位
- `miniprogram/cabinet/pages/cost/index.wxml` — 五金"规格"列绑 spec 字段
- `tests/model-meta-cache.test.js` — 补 preloadAll 用例

**不改**: `layout-engine.js`, `cabinet-model.js`, `three-renderer.js`, `wireframe*`, `design` 页, glb 上传编排。

**约束**: 每个 task 结束后 `commit`;所有测试用 `node --test tests/<name>.test.js`(与 `model-meta-cache.test.js` 同风格,不用 `run.js`)。

---

## Task 1: `price-dict.js` — 价格字典模块

**Files:**
- Create: `miniprogram/utils/price-dict.js`
- Test: `tests/price-dict.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/price-dict.test.js`:

```js
// tests/price-dict.test.js
// 价格字典:preloadAll 分页拉云表 + 写 storage;get(code)/all()/getByCategory(cat) 同步读缓存。
// Node 环境无 wx,注入 mock wx。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh() {
  const p = path.resolve(__dirname, '../miniprogram/utils/price-dict.js');
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

// 模拟微信云 DB:count() + get({skip,limit=20})
function makeCloudMock(rows) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'price');
          return {
            _skip: 0, _limit: 20,
            count: async () => ({ total: rows.length }),
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            get: async function () {
              return { data: rows.slice(this._skip, this._skip + this._limit) };
            },
          };
        },
      };
    },
  };
}

const SAMPLE = [
  { code: 'panel_egger', name: '爱格', price: 195, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'panel_e2_domestic', name: 'E2', price: 70, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'door_material_piano_lacquer', name: '钢琴烤漆', price: 200, category: 'door_material', unit: '㎡', brand_type: null },
  { code: 'hinge_domestic', name: 'DTC铰链', price: 6.2, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'hinge_import', name: '百隆铰链', price: 27, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'transport_fee', name: '运费', price: 15, category: 'transport', unit: '㎡', brand_type: null },
];

test('preloadAll 首次:拉云表写 storage;get/all/getByCategory 命中', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('panel_egger').price, 195);
    assert.equal(dict.get('hinge_import').brand_type, 'import');
    assert.equal(dict.get('nonexistent'), undefined);
    assert.equal(dict.all().length, 6);
    assert.equal(dict.getByCategory('panel').length, 2);
    assert.equal(dict.getByCategory('hardware').length, 2);
    // 已写 storage
    assert.ok(wx.store['cost_data_v1_price']);
    assert.equal(wx.store['cost_data_v1_price'].length, 6);
  } finally { delete global.wx; }
});

test('preloadAll 二次:立即用本地缓存, isReady=true, 但后台仍刷新一次', async () => {
  const wx = makeStorageMock();
  wx.store['cost_data_v1_price'] = SAMPLE;
  const FRESH = SAMPLE.concat([{ code: 'panel_new', name: '新板', price: 300, category: 'panel', unit: '㎡', brand_type: null }]);
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(FRESH) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    // 立即拿到本地缓存, 还没看到新品
    assert.equal(dict.get('panel_egger').price, 195);
    assert.equal(dict.get('panel_new'), undefined);
    assert.equal(dict.isReady(), true);
    // 等一小段 tick 让后台 fire-and-forget 结束
    await new Promise((r) => setTimeout(r, 50));
    // 后台已把云端新数据覆盖进内存 + storage
    assert.equal(dict.get('panel_new').price, 300);
    assert.equal(wx.store['cost_data_v1_price'].length, FRESH.length);
  } finally { delete global.wx; }
});

test('preloadAll 二次 + 后台刷新失败: 保留老缓存, 不抛不报', async () => {
  const wx = makeStorageMock();
  wx.store['cost_data_v1_price'] = SAMPLE;
  const cloud = {
    database() { return { collection() { return { count: async () => { throw new Error('bg net'); }, skip() { return this; }, limit() { return this; }, get: async () => ({ data: [] }) }; } }; },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('panel_egger').price, 195);
    await new Promise((r) => setTimeout(r, 50));
    // 老缓存仍在
    assert.equal(dict.get('panel_egger').price, 195);
    assert.equal(wx.store['cost_data_v1_price'].length, SAMPLE.length);
  } finally { delete global.wx; }
});

test('preloadAll force=true:忽略本地缓存重新拉云', async () => {
  const wx = makeStorageMock();
  wx.store['cost_data_v1_price'] = [{ code: 'stale', price: 1, category: 'panel' }];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll({ force: true });
    assert.equal(dict.get('stale'), undefined);
    assert.equal(dict.get('panel_egger').price, 195);
  } finally { delete global.wx; }
});

test('preloadAll 分页:>20 条要多次 get', async () => {
  const wx = makeStorageMock();
  const many = Array.from({ length: 47 }, (_, i) => ({
    code: 'k' + i, name: 'n' + i, price: i, category: 'panel', unit: '㎡', brand_type: null,
  }));
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(many) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.all().length, 47);
    assert.equal(dict.get('k46').price, 46);
  } finally { delete global.wx; }
});

test('preloadAll 云失败:warn + 返回空, 不抛', async () => {
  const wx = makeStorageMock();
  const cloud = {
    database() { return { collection() { return { count: async () => { throw new Error('net'); }, skip() { return this; }, limit() { return this; }, get: async () => ({ data: [] }) }; } }; },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const dict = loadFresh();
    await dict.preloadAll();   // 不抛
    assert.equal(dict.all().length, 0);
    assert.equal(dict.get('any'), undefined);
    // storage 未被覆写
    assert.equal(wx.store['cost_data_v1_price'], undefined);
  } finally { delete global.wx; }
});

test('无 wx 环境:所有 API 退化 no-op', async () => {
  delete global.wx;
  const dict = loadFresh();
  await dict.preloadAll();   // 不抛
  assert.equal(dict.get('anything'), undefined);
  assert.deepEqual(dict.all(), []);
  assert.deepEqual(dict.getByCategory('panel'), []);
});

test('isReady:preload 前 false, 后 true', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    assert.equal(dict.isReady(), false);
    await dict.preloadAll();
    assert.equal(dict.isReady(), true);
  } finally { delete global.wx; }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/price-dict.test.js`
Expected: FAIL — 模块尚未创建,require 报错。

- [ ] **Step 3: 实现 `price-dict.js`**

Create `miniprogram/utils/price-dict.js`:

```js
// 价格字典:小程序启动时预拉云表 `price` 到本地 storage;
// 后续 get(code) / all() / getByCategory(cat) 同步读内存映射, 不再触网。
// 数据形状: { code, name, price, category, unit, brand_type }

const STORAGE_KEY = 'cost_data_v1_price';
const COLLECTION = 'price';
const PAGE_SIZE = 20;   // 微信小程序 db 单次上限

let _byCode = null;    // Map<code, entry>
let _all = [];         // entry[]
let _ready = false;

function _ingest(rows) {
  _all = rows || [];
  _byCode = new Map();
  _all.forEach((r) => { if (r && r.code) _byCode.set(r.code, r); });
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
  catch (e) { console.warn('[price-dict] setStorage fail', e && e.errMsg); }
}

async function _fetchAll() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION);
    const { total } = await col.count();
    const out = [];
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await col.skip(skip).limit(PAGE_SIZE).get();
      out.push(...(res.data || []));
    }
    return out;
  } catch (e) {
    console.warn('[price-dict] fetch fail', e && e.errMsg);
    return null;
  }
}

// preloadAll: 读老 + 后台悄悄刷新
//   force=true:  阻塞拉云 → 覆盖 storage/内存
//   force=false: 本地有 → 立即 ingest, fire-and-forget 后台再拉一次静默覆盖;本地无 → 阻塞拉云
async function preloadAll(opts) {
  const force = !!(opts && opts.force);
  if (!force) {
    const local = _readStorage();
    if (local) {
      _ingest(local);
      _refreshInBackground();   // 不 await, 悄悄刷新
      return;
    }
  }
  const remote = await _fetchAll();
  if (remote) { _ingest(remote); _writeStorage(remote); return; }
  if (!_ready) _ingest([]);
  _ready = false;
}

// 后台静默刷新:成功覆写内存 + storage;失败静默(保留老缓存)
function _refreshInBackground() {
  _fetchAll().then((remote) => {
    if (remote && Array.isArray(remote) && remote.length > 0) {
      _ingest(remote);
      _writeStorage(remote);
    }
  }).catch(() => { /* 静默 */ });
}

function get(code) { return _byCode ? _byCode.get(code) : undefined; }
function all() { return _all.slice(); }
function getByCategory(cat) { return _all.filter((r) => r && r.category === cat); }
function isReady() { return _ready; }

module.exports = { preloadAll, get, all, getByCategory, isReady, _STORAGE_KEY: STORAGE_KEY };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/price-dict.test.js`
Expected: PASS 全部 7 用例。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/price-dict.js tests/price-dict.test.js
git commit -m "feat(price-dict): 价格字典模块 preloadAll/get/all/getByCategory + 分页拉云

- storage key: cost_data_v1_price
- 分页拉 collection('price'), 单页 20 条
- 读老 + 后台悄悄刷新: force=false 且有本地缓存时立即 ingest, 后台 fire-and-forget 拉云覆盖
- 无 wx / 云失败 / 空数据兼容处理
- 8 个单测覆盖 preload / 缓存复用(后台刷新命中) / 缓存复用(后台失败保留) / force / 分页 / 失败 / no-wx / isReady

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `panel-dict.js` — 板件中英映射字典

**Files:**
- Create: `miniprogram/utils/panel-dict.js`
- Test: `tests/panel-dict.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/panel-dict.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh() {
  const p = path.resolve(__dirname, '../miniprogram/utils/panel-dict.js');
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

function makeCloudMock(rows) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'panel_name_dict');
          return {
            _skip: 0, _limit: 20,
            count: async () => ({ total: rows.length }),
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            get: async function () {
              return { data: rows.slice(this._skip, this._skip + this._limit) };
            },
          };
        },
      };
    },
  };
}

const SAMPLE = [
  { panel_code: 'side_left_panel_18', display_name: '左侧板', category: 'cabinet_frame', enable: true },
  { panel_code: 'top_panel_18', display_name: '柜体顶板', category: 'cabinet_frame', enable: true },
  { panel_code: 'door_single_18', display_name: '门板', category: 'door_panel', enable: true },
  { panel_code: 'hanging_rail_01', display_name: '01衣通', category: 'hanging_component', enable: true },
  { panel_code: 'deprecated_panel', display_name: '废弃', category: 'cabinet_frame', enable: false },
];

test('preloadAll:enable=false 的条目被过滤', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('side_left_panel_18').display_name, '左侧板');
    assert.equal(dict.get('deprecated_panel'), undefined);   // 被 enable 过滤
    assert.equal(dict.all().length, 4);
  } finally { delete global.wx; }
});

test('get(code) miss 返回 undefined', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('nonexistent'), undefined);
  } finally { delete global.wx; }
});

test('preloadAll 二次:立即用本地 + 后台悄悄拉云覆盖', async () => {
  const wx = makeStorageMock();
  wx.store['cost_data_v1_panel'] = SAMPLE.filter((r) => r.enable);
  const FRESH = SAMPLE.filter((r) => r.enable).concat([
    { panel_code: 'new_panel_18', display_name: '新板', category: 'cabinet_frame', enable: true },
  ]);
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(FRESH) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('side_left_panel_18').display_name, '左侧板');
    assert.equal(dict.get('new_panel_18'), undefined);
    await new Promise((r) => setTimeout(r, 50));
    // 后台已覆盖
    assert.equal(dict.get('new_panel_18').display_name, '新板');
  } finally { delete global.wx; }
});

test('云失败:warn 不抛, all()=[]', async () => {
  const wx = makeStorageMock();
  const cloud = {
    database() { return { collection() { return { count: async () => { throw new Error('net'); }, skip() { return this; }, limit() { return this; }, get: async () => ({ data: [] }) }; } }; },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.deepEqual(dict.all(), []);
  } finally { delete global.wx; }
});

test('无 wx 环境:no-op', async () => {
  delete global.wx;
  const dict = loadFresh();
  await dict.preloadAll();
  assert.equal(dict.get('any'), undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/panel-dict.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: 实现 `panel-dict.js`**

Create `miniprogram/utils/panel-dict.js`:

```js
// 板件中英映射字典:云表 panel_name_dict, 只保留 enable=true 的条目。
// 数据形状: { panel_code, display_name, category, enable }

const STORAGE_KEY = 'cost_data_v1_panel';
const COLLECTION = 'panel_name_dict';
const PAGE_SIZE = 20;

let _byCode = null;
let _all = [];
let _ready = false;

function _ingest(rows) {
  _all = (rows || []).filter((r) => r && r.enable !== false);
  _byCode = new Map();
  _all.forEach((r) => { if (r.panel_code) _byCode.set(r.panel_code, r); });
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
  catch (e) { console.warn('[panel-dict] setStorage fail', e && e.errMsg); }
}

async function _fetchAll() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION);
    const { total } = await col.count();
    const out = [];
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await col.skip(skip).limit(PAGE_SIZE).get();
      out.push(...(res.data || []));
    }
    return out;
  } catch (e) {
    console.warn('[panel-dict] fetch fail', e && e.errMsg);
    return null;
  }
}

// 读老 + 后台悄悄刷新 (与 price-dict 同模式)
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
  if (!_ready) _ingest([]);
  _ready = false;
}

function _refreshInBackground() {
  _fetchAll().then((remote) => {
    if (remote && Array.isArray(remote) && remote.length > 0) {
      _ingest(remote);
      _writeStorage(remote);
    }
  }).catch(() => { /* 静默 */ });
}

function get(code) { return _byCode ? _byCode.get(code) : undefined; }
function all() { return _all.slice(); }
function isReady() { return _ready; }

module.exports = { preloadAll, get, all, isReady, _STORAGE_KEY: STORAGE_KEY };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/panel-dict.test.js`
Expected: PASS 全部 5 用例。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/panel-dict.js tests/panel-dict.test.js
git commit -m "feat(panel-dict): 板件中英映射字典 preloadAll + enable 过滤

- storage key: cost_data_v1_panel
- 分页拉 collection('panel_name_dict'), 过滤 enable=false
- 读老 + 后台悄悄刷新 (同 price-dict 模式)
- 5 个单测覆盖 preload / miss / 缓存复用+后台覆盖 / 失败 / no-wx

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 扩展 `model-meta-cache.js` — 补 `preloadAll`

**Files:**
- Modify: `miniprogram/utils/model-meta-cache.js`
- Modify: `tests/model-meta-cache.test.js`

- [ ] **Step 1: 追加失败测试**

Append to `tests/model-meta-cache.test.js` (在文件末尾, 现有 test 后面):

```js

// ---- preloadAll:一次性拉 is_online=true 的元数据, 按 glb_file_name 写单条 storage ----

function makeCloudMockForPreload(rows) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'model_panel_hardware');
          const chain = {
            _cond: null, _skip: 0, _limit: 20,
            where(c) { this._cond = c; return this; },
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            count: async function () {
              const filtered = rows.filter((r) => this._cond ? r.is_online === this._cond.is_online : true);
              return { total: filtered.length };
            },
            get: async function () {
              const filtered = rows.filter((r) => this._cond ? r.is_online === this._cond.is_online : true);
              return { data: filtered.slice(this._skip, this._skip + this._limit) };
            },
          };
          return chain;
        },
      };
    },
  };
}

test('preloadAll:拉所有 is_online=true 的 meta 并按 fileName 写单条 storage', async () => {
  const wx = makeStorageMock();
  const rows = [
    { glb_file_name: '50A.glb', is_online: true, total_body_area: 4.7 },
    { glb_file_name: '100A.glb', is_online: true, total_body_area: 6.9 },
    { glb_file_name: '50X.glb', is_online: false, total_body_area: 1 },   // 应过滤
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMockForPreload(rows) });
  try {
    const cache = loadFreshCache();
    await cache.preloadAll();
    assert.equal(cache.peekMeta('50A.glb').total_body_area, 4.7);
    assert.equal(cache.peekMeta('100A.glb').total_body_area, 6.9);
    assert.equal(cache.peekMeta('50X.glb'), null);   // is_online=false 未预拉
  } finally { delete global.wx; }
});

test('preloadAll 总是覆盖已有 fileName (后台悄悄刷新: glb 修正常见)', async () => {
  const wx = makeStorageMock();
  wx.store['model_meta_50A.glb'] = { glb_file_name: '50A.glb', total_body_area: 999 };   // 老值
  const cloud = {
    database() {
      return {
        collection() {
          return {
            where() { return this; }, skip() { return this; }, limit() { return this; },
            count: async () => ({ total: 1 }),
            get: async () => ({ data: [{ glb_file_name: '50A.glb', is_online: true, total_body_area: 4.7 }] }),
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const cache = loadFreshCache();
    await cache.preloadAll();
    // 与字典模块不同:模型元数据总是覆盖(允许 glb 数据修正)
    assert.equal(cache.peekMeta('50A.glb').total_body_area, 4.7);
  } finally { delete global.wx; }
});

test('preloadAll 云失败:warn 不抛', async () => {
  const wx = makeStorageMock();
  const cloud = {
    database() {
      return {
        collection() {
          return {
            where() { return this; }, skip() { return this; }, limit() { return this; },
            count: async () => { throw new Error('net'); },
            get: async () => ({ data: [] }),
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const cache = loadFreshCache();
    await cache.preloadAll();   // 不抛
    assert.equal(cache.peekMeta('50A.glb'), null);
  } finally { delete global.wx; }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/model-meta-cache.test.js`
Expected: FAIL — `cache.preloadAll is not a function`

- [ ] **Step 3: 在 `model-meta-cache.js` 中实现 `preloadAll`**

Modify `miniprogram/utils/model-meta-cache.js` — 在 module.exports 之前追加 `preloadAll` 函数, 并把它加到 exports:

Find (near the top):
```js
const COLLECTION = 'model_panel_hardware';
```

After that line and other existing helpers, append the following function BEFORE `module.exports`:

```js
const PAGE_SIZE = 20;

// 一次性把 is_online=true 的元数据拉进 storage(按 fileName 单条写)。
// 总是覆盖已有条目:glb 数据的修正(节点尺寸/五金修正)常见, 缓存不应挡新数据。
// force 参数保留只是 API 一致性, 语义与字典模块的 force=true 一致(阻塞拉云)。
// 与字典模块的差异:
//   - 字典模块 preloadAll: 读老 + 后台悄悄刷新, force=false 时立即返回
//   - 本模块 preloadAll: 阻塞拉云并覆盖(数据量小, 直接同步刷更可控)
async function preloadAll(opts) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION).where({ is_online: true });
    const { total } = await col.count();
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await db.collection(COLLECTION).where({ is_online: true })
        .skip(skip).limit(PAGE_SIZE).get();
      (res.data || []).forEach((doc) => {
        if (!doc || !doc.glb_file_name) return;
        setMeta(doc.glb_file_name, doc);   // 直接覆盖
      });
    }
  } catch (e) {
    console.warn('[model-meta-cache] preloadAll fail', e && e.errMsg);
  }
}
```

And update `module.exports`:

Find:
```js
module.exports = {
  setMeta,
  peekMeta,
  getMeta,
  removeMeta,
  _STORAGE_PREFIX: STORAGE_PREFIX,
};
```

Replace with:
```js
module.exports = {
  setMeta,
  peekMeta,
  getMeta,
  removeMeta,
  preloadAll,
  _STORAGE_PREFIX: STORAGE_PREFIX,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/model-meta-cache.test.js`
Expected: PASS 全部用例(原有 8 + 新增 3 = 11)。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/model-meta-cache.js tests/model-meta-cache.test.js
git commit -m "feat(model-meta-cache): 补 preloadAll 分页拉 is_online 元数据

- 分页 (PAGE_SIZE=20) 拉 collection('model_panel_hardware'), where is_online=true
- 总是覆盖已有单条缓存 (glb 修正常见, 缓存不应挡新数据)
- 云失败 warn 不抛
- 3 个新单测(过滤 is_online / 总覆盖 / 云失败)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `panel-formulas.js` — 严格板件公式表

**Files:**
- Create: `miniprogram/utils/panel-formulas.js`
- Test: `tests/panel-formulas.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/panel-formulas.test.js`:

```js
// panel-formulas: 按 panel_code 返回 (W, H) → {length, width, thickness} 的公式函数。
// 只测代表性 code(每个板类各一个), 保证公式与 spec §6.3 一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../miniprogram/utils/panel-formulas.js');

const F = formulas.PANEL_FORMULAS;

test('side_left_panel_18: 长 = H-6, 宽 58', () => {
  assert.deepEqual(F.side_left_panel_18(50, 230), { length: 224, width: 58, thickness: 1.8 });
  assert.deepEqual(F.side_left_panel_18(100, 300), { length: 294, width: 58, thickness: 1.8 });
});

test('side_right_panel_18: 长 = H-6, 宽 58', () => {
  assert.deepEqual(F.side_right_panel_18(50, 230), { length: 224, width: 58, thickness: 1.8 });
});

test('top_panel_18: 长 58, 宽 = W-3.6', () => {
  assert.deepEqual(F.top_panel_18(50, 230), { length: 58, width: 46.4, thickness: 1.8 });
  assert.deepEqual(F.top_panel_18(100, 230), { length: 58, width: 96.4, thickness: 1.8 });
});

test('bottom_panel_18: 长 58, 宽 = W-3.6', () => {
  assert.deepEqual(F.bottom_panel_18(80, 230), { length: 58, width: 76.4, thickness: 1.8 });
});

test('back_panel_18: 长 = H-9.6, 宽 = W-3.6', () => {
  assert.deepEqual(F.back_panel_18(50, 230), { length: 220.4, width: 46.4, thickness: 1.8 });
});

test('kick_front_18: 长 = W, 宽 5.5', () => {
  assert.deepEqual(F.kick_front_18(50, 230), { length: 50, width: 5.5, thickness: 1.8 });
  assert.deepEqual(F.kick_front_18(30, 230), { length: 30, width: 5.5, thickness: 1.8 });
});

test('shelf_panel_01_18..10 同一公式: 长 56.2, 宽 = W-3.6', () => {
  for (let i = 1; i <= 10; i++) {
    const code = `shelf_panel_${String(i).padStart(2,'0')}_18`;
    assert.deepEqual(F[code](50, 230), { length: 56.2, width: 46.4, thickness: 1.8 }, code + ' 公式');
  }
});

test('door_single_18: 长 = H-6.44, 宽 = W-0.6', () => {
  assert.deepEqual(F.door_single_18(50, 230), { length: 223.56, width: 49.4, thickness: 1.8 });
});

test('door_left/right_18: 宽 = (W-0.6)/2', () => {
  assert.deepEqual(F.door_left_18(100, 230), { length: 223.56, width: 49.7, thickness: 1.8 });
  assert.deepEqual(F.door_right_18(100, 230), { length: 223.56, width: 49.7, thickness: 1.8 });
});

test('access_panel_18: 长 19.8, 宽 = W-4', () => {
  assert.deepEqual(F.access_panel_18(50, 230), { length: 19.8, width: 46, thickness: 1.8 });
});

test('drawer_box_front_01..05_18: 长 = W-4, 宽 16', () => {
  for (let i = 1; i <= 5; i++) {
    const code = `drawer_box_front_${String(i).padStart(2,'0')}_18`;
    assert.deepEqual(F[code](50, 230), { length: 46, width: 16, thickness: 1.8 }, code);
  }
});

test('drawer_side_left/right/bottom: 长 56.2, 宽 16', () => {
  assert.deepEqual(F.drawer_side_left_01_18(50, 230), { length: 56.2, width: 16, thickness: 1.8 });
});

test('drawer_box_back_XX_18: 长 = W-8.5, 宽 10.7', () => {
  assert.deepEqual(F.drawer_box_back_01_18(50, 230), { length: 41.5, width: 10.7, thickness: 1.8 });
});

test('drawer_box_bottom_XX_18: 长 47.2, 宽 = W-8.5', () => {
  assert.deepEqual(F.drawer_box_bottom_01_18(50, 230), { length: 47.2, width: 41.5, thickness: 1.8 });
});

test('未在表中的 panel_code 返回 undefined', () => {
  assert.equal(F.unknown_panel_18, undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/panel-formulas.test.js`
Expected: FAIL, 模块不存在。

- [ ] **Step 3: 实现 `panel-formulas.js`**

Create `miniprogram/utils/panel-formulas.js`:

```js
// 板件严格公式表:非标/加高柜按此表根据实际 (W, H) 重算每块板的三维尺寸。
// 与 spec §6.3 对齐;公式与 (旧)cost-engine.js 的 R6..R23 一致, 但改用 panel_code 作 key
// (旧代码用中文 name 硬编码, 现全换成 glb 元数据的 node_name)。
//
// 单位 cm;返回 {length, width, thickness}, thickness 恒 1.8。
// length 是长边, width 是短边 —— 与 glb 元数据 board_list[i] 的存法一致。
// 未在表中的 panel_code, 调用方(cost-engine) 会 fallback 到 baseMeta 原尺寸 + warn。

const round = (v) => Math.round(v * 100) / 100;

function _shelf(W, H) { return { length: 56.2, width: round(W - 3.6), thickness: 1.8 }; }
function _drawerFront(W, H) { return { length: round(W - 4), width: 16, thickness: 1.8 }; }
function _drawerSideBoard(W, H) { return { length: 49, width: 12, thickness: 1.8 }; }
function _drawerBack(W, H) { return { length: round(W - 8.5), width: 10.7, thickness: 1.8 }; }
function _drawerBottom(W, H) { return { length: 47.2, width: round(W - 8.5), thickness: 1.8 }; }
function _drawerSide(W, H) { return { length: 56.2, width: 16, thickness: 1.8 }; }

const PANEL_FORMULAS = {
  // ---- 柜体 ----
  side_left_panel_18:  (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  side_right_panel_18: (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  top_panel_18:        (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  bottom_panel_18:     (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  back_panel_18:       (W, H) => ({ length: round(H - 9.6), width: round(W - 3.6), thickness: 1.8 }),
  kick_front_18:       (W, H) => ({ length: round(W), width: 5.5, thickness: 1.8 }),
  access_panel_18:     (W, H) => ({ length: 19.8, width: round(W - 4), thickness: 1.8 }),

  // ---- 门板 ----
  door_single_18: (W, H) => ({ length: round(H - 6.44), width: round(W - 0.6), thickness: 1.8 }),
  door_left_18:   (W, H) => ({ length: round(H - 6.44), width: round((W - 0.6) / 2), thickness: 1.8 }),
  door_right_18:  (W, H) => ({ length: round(H - 6.44), width: round((W - 0.6) / 2), thickness: 1.8 }),
};

// 层板 shelf_panel_01..10 (同一公式,批量注入)
for (let i = 1; i <= 10; i++) {
  const k = 'shelf_panel_' + String(i).padStart(2, '0') + '_18';
  PANEL_FORMULAS[k] = _shelf;
}

// 抽屉 (01..05, 每组 7 个 panel_code)
for (let i = 1; i <= 5; i++) {
  const id = String(i).padStart(2, '0');
  PANEL_FORMULAS['drawer_box_front_'  + id + '_18'] = _drawerFront;
  PANEL_FORMULAS['drawer_box_left_'   + id + '_18'] = _drawerSideBoard;
  PANEL_FORMULAS['drawer_box_right_'  + id + '_18'] = _drawerSideBoard;
  PANEL_FORMULAS['drawer_box_back_'   + id + '_18'] = _drawerBack;
  PANEL_FORMULAS['drawer_box_bottom_' + id + '_18'] = _drawerBottom;
  PANEL_FORMULAS['drawer_side_left_'  + id + '_18'] = _drawerSide;
  PANEL_FORMULAS['drawer_side_bottom_' + id + '_18'] = _drawerSide;
}

module.exports = { PANEL_FORMULAS };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/panel-formulas.test.js`
Expected: PASS 全部 15 用例。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/panel-formulas.js tests/panel-formulas.test.js
git commit -m "feat(panel-formulas): 板件严格公式表 (侧板/顶底/背板/层板/门板/踢脚/抽屉)

- 按 panel_code (glb node_name) 分派公式, 输入 (W,H), 输出 {length,width,thickness}
- 层板 01..10、抽屉 01..05 循环批量注入
- 未在表中的 code 返回 undefined, 由 cost-engine fallback + warn
- 15 个单测覆盖各代表性 panel_code

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `bootstrap.js` — 三字典启动编排

**Files:**
- Create: `miniprogram/utils/bootstrap.js`
- Test: `tests/bootstrap.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/bootstrap.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFreshBootstrap() {
  const modulesToClear = [
    '../miniprogram/utils/bootstrap.js',
    '../miniprogram/utils/price-dict.js',
    '../miniprogram/utils/panel-dict.js',
    '../miniprogram/utils/model-meta-cache.js',
  ];
  modulesToClear.forEach((rel) => {
    const p = path.resolve(__dirname, rel);
    delete require.cache[p];
  });
  return {
    bootstrap: require(path.resolve(__dirname, '../miniprogram/utils/bootstrap.js')),
    priceDict: require(path.resolve(__dirname, '../miniprogram/utils/price-dict.js')),
    panelDict: require(path.resolve(__dirname, '../miniprogram/utils/panel-dict.js')),
    modelMeta: require(path.resolve(__dirname, '../miniprogram/utils/model-meta-cache.js')),
  };
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

function makeCloudMock(byCollection) {
  return {
    database() {
      return {
        collection(name) {
          const rows = byCollection[name] || [];
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

test('ensureCostDataReady 并行触发三 preloadAll, 全部成功后 isAllReady=true', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, {
    cloud: makeCloudMock({
      price: [{ code: 'panel_egger', price: 195, category: 'panel' }],
      panel_name_dict: [{ panel_code: 'top_panel_18', display_name: '顶板', category: 'cabinet_frame', enable: true }],
      model_panel_hardware: [{ glb_file_name: '50A.glb', is_online: true, total_body_area: 4.7 }],
    }),
  });
  try {
    const { bootstrap, priceDict, panelDict, modelMeta } = loadFreshBootstrap();
    assert.equal(bootstrap.isAllReady(), false);
    await bootstrap.ensureCostDataReady();
    assert.equal(priceDict.isReady(), true);
    assert.equal(panelDict.isReady(), true);
    assert.equal(modelMeta.peekMeta('50A.glb').total_body_area, 4.7);
    assert.equal(bootstrap.isAllReady(), true);
  } finally { delete global.wx; }
});

test('ensureCostDataReady 任一失败:不抛, isAllReady=false', async () => {
  const wx = makeStorageMock();
  // price 云调用失败, 其他成功
  const cloud = {
    database() {
      return {
        collection(name) {
          if (name === 'price') {
            return {
              where() { return this; }, skip() { return this; }, limit() { return this; },
              count: async () => { throw new Error('price down'); },
              get: async () => ({ data: [] }),
            };
          }
          const rows = name === 'panel_name_dict'
            ? [{ panel_code: 'x', display_name: 'X', category: 'c', enable: true }]
            : [{ glb_file_name: 'x.glb', is_online: true }];
          return {
            _cond: null, _skip: 0, _limit: 20,
            where(c) { this._cond = c; return this; },
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            count: async () => ({ total: rows.length }),
            get: async function () { return { data: rows.slice(this._skip, this._skip + this._limit) }; },
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const { bootstrap, priceDict } = loadFreshBootstrap();
    await bootstrap.ensureCostDataReady();   // 不抛
    assert.equal(priceDict.isReady(), false);
    assert.equal(bootstrap.isAllReady(), false);
  } finally { delete global.wx; }
});

test('无 wx: ensureCostDataReady 不抛, isAllReady=false', async () => {
  delete global.wx;
  const { bootstrap } = loadFreshBootstrap();
  await bootstrap.ensureCostDataReady();
  assert.equal(bootstrap.isAllReady(), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/bootstrap.test.js`
Expected: FAIL, bootstrap 模块不存在。

- [ ] **Step 3: 实现 `bootstrap.js`**

Create `miniprogram/utils/bootstrap.js`:

```js
// 成本数据启动编排:并行触发 price/panel/model_meta 三张字典的 preloadAll。
// 由 app.onLaunch 调 ensureCostDataReady(不 await, fire-and-forget), 每次成本页也会再校验。
// 目标是"启动写 storage → 成本页同步命中", 不阻塞其他业务。

const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMetaCache = require('./model-meta-cache.js');

async function ensureCostDataReady(opts) {
  const force = !!(opts && opts.force);
  await Promise.all([
    priceDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] price fail', e)),
    panelDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] panel fail', e)),
    modelMetaCache.preloadAll({ force }).catch((e) => console.warn('[bootstrap] meta fail', e)),
  ]);
}

function isAllReady() {
  return priceDict.isReady() && panelDict.isReady();
  // model-meta-cache 无 isReady:成本页会按具体 fileName 判 peekMeta,
  // 缺哪个柜的元数据只影响那一柜,不阻塞其他柜。
}

module.exports = { ensureCostDataReady, isAllReady };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/bootstrap.test.js`
Expected: PASS 全部 3 用例。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/bootstrap.js tests/bootstrap.test.js
git commit -m "feat(bootstrap): 成本三字典启动编排 ensureCostDataReady

- 并行触发 price / panel / model-meta 三 preloadAll, catch 各自异常不互相拖累
- isAllReady() 用于成本页降级判定 (只看 price/panel, meta 按柜逐个判)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 重写 `cost-engine.js` — 数据驱动计算

**Files:**
- Modify (完全重写): `miniprogram/utils/cost-engine.js`
- Create: `tests/cost-engine.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/cost-engine.test.js`:

```js
// cost-engine 端到端算例:mock 三张字典 + 元数据, 验证核心公式对齐 spec §6.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh() {
  const modules = [
    '../miniprogram/utils/cost-engine.js',
    '../miniprogram/utils/price-dict.js',
    '../miniprogram/utils/panel-dict.js',
    '../miniprogram/utils/model-meta-cache.js',
    '../miniprogram/utils/panel-formulas.js',
  ];
  modules.forEach((rel) => {
    const p = path.resolve(__dirname, rel);
    delete require.cache[p];
  });
  return {
    costEngine: require(path.resolve(__dirname, '../miniprogram/utils/cost-engine.js')),
    priceDict: require(path.resolve(__dirname, '../miniprogram/utils/price-dict.js')),
    panelDict: require(path.resolve(__dirname, '../miniprogram/utils/panel-dict.js')),
    modelMeta: require(path.resolve(__dirname, '../miniprogram/utils/model-meta-cache.js')),
  };
}

// 构造 mock 环境:注入三张字典的数据(直接调 preloadAll 用 mock cloud)
function makeWx(byCollection) {
  const store = {};
  return {
    setStorageSync(k, v) { store[k] = v; },
    getStorageSync(k) { return store[k]; },
    removeStorageSync(k) { delete store[k]; },
    _store: store,
    cloud: {
      database() {
        return {
          collection(name) {
            const rows = byCollection[name] || [];
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
    },
  };
}

const PRICES = [
  { code: 'panel_egger', name: '爱格', price: 195, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'panel_e2_domestic', name: 'E2', price: 70, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'door_material_same_as_cabinet', name: '同柜体', price: 0, category: 'door_material', unit: '㎡', brand_type: null },
  { code: 'door_material_piano_lacquer', name: '钢琴烤漆', price: 200, category: 'door_material', unit: '㎡', brand_type: null },
  { code: 'door_craft_none', name: '无', price: 0, category: 'door_craft', unit: '㎡', brand_type: null },
  { code: 'transport_fee', name: '运费', price: 15, category: 'transport', unit: '㎡', brand_type: null },
  { code: 'install_fee', name: '安装费', price: 20, category: 'install', unit: '㎡', brand_type: null },
  // hardware domestic
  { code: 'hinge_domestic', name: 'DTC铰链', price: 6.2, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'slide_domestic', name: '滑轨', price: 60, category: 'hardware', unit: '副', brand_type: 'domestic' },
  { code: 'hanging_rail_domestic', name: '衣通', price: 40, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'minifix_domestic', name: '三合一', price: 0.2, category: 'hardware', unit: '套', brand_type: 'domestic' },
  { code: 'countersunk_screw_domestic', name: '沉头螺丝', price: 0.5, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'wood_dowel_domestic', name: '木销', price: 0.1, category: 'hardware', unit: '根', brand_type: 'domestic' },
  { code: 'push_latch_domestic', name: '反弹器', price: 2.2, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'self_tapping_screw_16_domestic', name: 'M4x16', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'self_tapping_screw_30_domestic', name: 'M4x30', price: 0.01, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'support_arm_domestic', name: '支撑杆', price: 14.5, category: 'hardware', unit: '支', brand_type: 'domestic' },
  { code: 'plinth_domestic', name: '基座', price: 9.95, category: 'hardware', unit: '只', brand_type: 'domestic' },
  { code: 'nylon_pre_inserted_nut_domestic', name: '尼龙螺丝', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'dust_strip_domestic', name: '防尘条', price: 0.5, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'liquid_nails_domestic', name: '免钉胶', price: 15.9, category: 'hardware', unit: '支', brand_type: 'domestic' },
  { code: 'access_panel_handle_domestic', name: '拉手', price: 7.76, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'cable_channel_domestic', name: '线槽', price: 2, category: 'hardware', unit: '米', brand_type: 'domestic' },
  // LED (domestic + import)
  { code: 'led_light_strip_domestic', name: '国产LED灯带', price: 19.4, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'led_light_power_domestic', name: '国产电源', price: 85, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_switch_domestic', name: '国产开关', price: 47, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_strip_import', name: '进口LED', price: 40, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'led_light_power_import', name: '进口电源', price: 200, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'led_light_switch_import', name: '进口开关', price: 49.39, category: 'hardware', unit: '个', brand_type: 'import' },
  // import hardware (只列 hinge 用于 case 2)
  { code: 'hinge_import', name: '百隆铰链', price: 27, category: 'hardware', unit: '个', brand_type: 'import' },
];

const PANELS = [
  { panel_code: 'side_left_panel_18', display_name: '左侧板', category: 'cabinet_frame', enable: true },
  { panel_code: 'side_right_panel_18', display_name: '右侧板', category: 'cabinet_frame', enable: true },
  { panel_code: 'top_panel_18', display_name: '顶板', category: 'cabinet_frame', enable: true },
  { panel_code: 'bottom_panel_18', display_name: '底板', category: 'cabinet_frame', enable: true },
  { panel_code: 'back_panel_18', display_name: '背板', category: 'cabinet_frame', enable: true },
  { panel_code: 'shelf_panel_01_18', display_name: '01层板', category: 'cabinet_frame', enable: true },
  { panel_code: 'shelf_panel_02_18', display_name: '02层板', category: 'cabinet_frame', enable: true },
  { panel_code: 'kick_front_18', display_name: '踢脚', category: 'kick_component', enable: true },
  { panel_code: 'door_single_18', display_name: '门板', category: 'door_panel', enable: true },
  { panel_code: 'hanging_rail_01', display_name: '01衣通', category: 'hanging_component', enable: true },
];

// 用 docs/model_panel_hardware.json 的 50A / 100C 数据构造
const META_50A = {
  glb_file_name: '50A.glb', is_online: true,
  overall_size: { total_width: 50, total_height: 230, total_depth: 60 },
  board_list: [
    { node_name: 'kick_front_18', length: 50, width: 5.5, thickness: 1.8, area: 0.0275 },
    { node_name: 'side_left_panel_18', length: 224, width: 58, thickness: 1.8, area: 1.2992 },
    { node_name: 'side_right_panel_18', length: 224, width: 58, thickness: 1.8, area: 1.2992 },
    { node_name: 'bottom_panel_18', length: 58, width: 46.4, thickness: 1.8, area: 0.2691 },
    { node_name: 'top_panel_18', length: 58, width: 46.4, thickness: 1.8, area: 0.2691 },
    { node_name: 'back_panel_18', length: 220.4, width: 46.4, thickness: 1.8, area: 1.0227 },
    { node_name: 'shelf_panel_02_18', length: 56.2, width: 46.4, thickness: 1.8, area: 0.2608 },
    { node_name: 'shelf_panel_01_18', length: 56.2, width: 46.4, thickness: 1.8, area: 0.2608 },
  ],
  total_body_area: 4.7084,
  total_door_area: 1.11,
  total_raw_board_area: 5.8184,
  hardware_list: {
    hinge: 4, slide: 0, hanging_rail: 1, minifix: 36,
    countersunk_screw: 46, wood_dowel: 28, push_latch: 1,
    self_tapping_screw_16: 16, self_tapping_screw_30: 0,
    support_arm: 0, plinth: 4, nylon_pre_inserted_nut: 50,
    dust_strip: 1, liquid_nails: 1, access_panel_handle: 1,
    cable_channel: 1, led_light_strip: 2.184, led_light_power: 1, led_light_switch: 1,
  },
};

const META_100A = {
  glb_file_name: '100A.glb', is_online: true,
  overall_size: { total_width: 100, total_height: 230, total_depth: 60 },
  board_list: [
    { node_name: 'side_left_panel_18', length: 224, width: 58, thickness: 1.8, area: 1.2992 },
    { node_name: 'side_right_panel_18', length: 224, width: 58, thickness: 1.8, area: 1.2992 },
    { node_name: 'bottom_panel_18', length: 96.4, width: 58, thickness: 1.8, area: 0.5591 },
    { node_name: 'top_panel_18', length: 96.4, width: 58, thickness: 1.8, area: 0.5591 },
    { node_name: 'back_panel_18', length: 220.4, width: 96.4, thickness: 1.8, area: 2.1247 },
    { node_name: 'kick_front_18', length: 100, width: 5.5, thickness: 1.8, area: 0.055 },
    { node_name: 'shelf_panel_02_18', length: 96.4, width: 56.2, thickness: 1.8, area: 0.5418 },
    { node_name: 'shelf_panel_01_18', length: 96.4, width: 56.2, thickness: 1.8, area: 0.5418 },
  ],
  total_body_area: 6.9799,
  total_door_area: 2.227,
  total_raw_board_area: 9.2069,
  hardware_list: {
    hinge: 8, slide: 0, hanging_rail: 1, minifix: 0,
    countersunk_screw: 86, wood_dowel: 28, push_latch: 2,
    self_tapping_screw_16: 48, self_tapping_screw_30: 0,
    support_arm: 0, plinth: 4, nylon_pre_inserted_nut: 50,
    dust_strip: 1, liquid_nails: 1, access_panel_handle: 48,
    cable_channel: 1.8, led_light_strip: 2.2, led_light_power: 1, led_light_switch: 1,
  },
};

const META_100G1 = {
  glb_file_name: '100G1.glb', is_online: true,
  overall_size: { total_width: 100, total_height: 70, total_depth: 60 },
  board_list: [
    { node_name: 'side_left_panel_18', length: 64, width: 58, thickness: 1.8, area: 0.3712 },
    { node_name: 'side_right_panel_18', length: 64, width: 58, thickness: 1.8, area: 0.3712 },
    { node_name: 'top_panel_18', length: 58, width: 96.4, thickness: 1.8, area: 0.5591 },
    { node_name: 'bottom_panel_18', length: 58, width: 96.4, thickness: 1.8, area: 0.5591 },
    { node_name: 'back_panel_18', length: 60.4, width: 96.4, thickness: 1.8, area: 0.5822 },
  ],
  total_body_area: 2.4428,
  total_door_area: 0.6,
  total_raw_board_area: 3.0428,
  hardware_list: { hinge: 4, plinth: 4, countersunk_screw: 20, wood_dowel: 12, minifix: 12 },
};

async function primeDicts(byCollection) {
  const { costEngine, priceDict, panelDict, modelMeta } = loadFresh();
  global.wx = makeWx(byCollection);
  await priceDict.preloadAll({ force: true });
  await panelDict.preloadAll({ force: true });
  await modelMeta.preloadAll({ force: true });
  return { costEngine, priceDict, panelDict, modelMeta };
}

function _round2(v) { return Math.round(v * 100) / 100; }

test('case 1: 标准 50A + panel_egger + 同柜体 + 无工艺 + domestic + 无灯', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 50, h: 230, label: 'A柜' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    // 板材合计 = 4.7084 * 195 + 1.11 * (0+0) = 918.14
    assert.equal(m.panelCost, _round2(4.7084 * 195));
    // 五金:hinge 4*6.2=24.8, hanging_rail 1*40=40, minifix 36*0.2=7.2, countersunk 46*0.5=23,
    //       wood_dowel 28*0.1=2.8, push_latch 1*2.2=2.2, self_tapping_16 16*0.05=0.8,
    //       plinth 4*9.95=39.8, nylon 50*0.05=2.5, dust_strip 1*0.5=0.5,
    //       liquid_nails 1*15.9=15.9, access_panel_handle 1*7.76=7.76, cable_channel 1*2=2
    //       LED 三项因 lighting=none → 0
    const expectHw = 24.8 + 40 + 7.2 + 23 + 2.8 + 2.2 + 0.8 + 39.8 + 2.5 + 0.5 + 15.9 + 7.76 + 2;
    assert.equal(m.hardwareCost, _round2(expectHw));
    assert.equal(cost.transport, _round2(5.8184 * 15));
    assert.equal(cost.install, _round2(5.8184 * 20));
  } finally { delete global.wx; }
});

test('case 2: 标准 100A + E2 + 钢琴烤漆 + import + led_import → 门板加价 + 铰链 27 + LED import', async () => {
  const { costEngine, priceDict } = await primeDicts({
    price: PRICES.concat([
      // 补 import 五金(测试只关心几项)
      { code: 'slide_import', name: '进口滑轨', price: 120, category: 'hardware', unit: '副', brand_type: 'import' },
      { code: 'hanging_rail_import', name: '进口衣通', price: 1.1, category: 'hardware', unit: '米', brand_type: 'import' },
      { code: 'minifix_import', name: '进口三合一', price: 0.8, category: 'hardware', unit: '套', brand_type: 'import' },
      { code: 'countersunk_screw_import', name: '进口沉头', price: 0.1, category: 'hardware', unit: '颗', brand_type: 'import' },
      { code: 'wood_dowel_import', name: '进口木销', price: 0.1, category: 'hardware', unit: '根', brand_type: 'import' },
      { code: 'push_latch_import', name: '进口反弹器', price: 22, category: 'hardware', unit: '个', brand_type: 'import' },
      { code: 'self_tapping_screw_16_import', name: '', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'import' },
      { code: 'self_tapping_screw_30_import', name: '', price: 0.01, category: 'hardware', unit: '颗', brand_type: 'import' },
      { code: 'support_arm_import', name: '', price: 97, category: 'hardware', unit: '支', brand_type: 'import' },
      { code: 'plinth_import', name: '', price: 9.95, category: 'hardware', unit: '只', brand_type: 'import' },
      { code: 'nylon_pre_inserted_nut_import', name: '', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'import' },
      { code: 'dust_strip_import', name: '', price: 0.5, category: 'hardware', unit: '米', brand_type: 'import' },
      { code: 'liquid_nails_import', name: '', price: 15.9, category: 'hardware', unit: '支', brand_type: 'import' },
      { code: 'access_panel_handle_import', name: '', price: 7.76, category: 'hardware', unit: '个', brand_type: 'import' },
      { code: 'cable_channel_import', name: '', price: 2, category: 'hardware', unit: '米', brand_type: 'import' },
    ]),
    panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 100, h: 230, label: '100A' }],
      materials: {
        panel: 'panel_e2_domestic', doorPanel: 'door_material_piano_lacquer',
        doorCraft: 'door_craft_none', hardware: 'import', lighting: 'led_import',
      },
      wall: null,
    });
    const m = cost.modules[0];
    // panel: 6.9799 * 70 + 2.227 * (200 + 0) = 488.593 + 445.4 = 933.99
    assert.equal(m.panelCost, _round2(6.9799 * 70 + 2.227 * 200));
    // LED import: 2.2*40 + 1*200 + 1*49.39 = 88 + 200 + 49.39 = 337.39
    // hinge_import 8*27 = 216
    // 断言 hardwareCost > 216 (含 LED + 五金)
    assert.ok(m.hardwareCost > 216, 'hardwareCost 应 > 铰链单项');
  } finally { delete global.wx; }
});

test('case 3: 侧边非标 30cm + 基础 50A: 每块板按公式重算, 五金取 50A 原值', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'nonstandard', code: 'e1', w: 30, h: 230, label: '非标30' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    // 板件按公式重算:
    //   side_left/right: length=H-6=224, width=58, area=1.2992 (不变, 因和宽无关)
    //   top/bottom: length=58, width=W-3.6=26.4, area=0.153
    //   back: length=H-9.6=220.4, width=W-3.6=26.4, area=0.5819
    //   kick: length=W=30, width=5.5, area=0.0165
    //   shelf 01/02: length=56.2, width=W-3.6=26.4, area=0.1484 each
    // 汇总:1.2992 + 1.2992 + 0.153 + 0.153 + 0.5819 + 0.0165 + 0.1484 + 0.1484 = 3.7996
    // 五金总数量维持 50A 值
    assert.ok(m.totalBodyArea < 4.7, '非标 30cm total_body_area < 50A 原值 4.7');
    assert.ok(m.totalBodyArea > 3.5 && m.totalBodyArea < 4.0, '在预期范围 [3.5, 4.0]');
    // hardware_list 未动:hinge 仍 4 → 24.8
    const hinge = m.detail.hardware.find((h) => h.code === 'hinge_domestic');
    assert.equal(hinge.qty, 4);
    assert.equal(hinge.total, _round2(4 * 6.2));
  } finally { delete global.wx; }
});

test('case 4: 加高 60cm 高 + 基础 100G1: 侧板长度按公式重算 = H-6', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'raise', code: 'g', w: 100, h: 60, label: '加高60' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    // side_left/right length=H-6=54, width=58, area=0.3132 each
    // 相比 100G1 原始 H=70 (length=64), 变短了
    assert.ok(m.totalBodyArea > 0, '有面积');
    // 五金按 100G1:hinge 4
    const hinge = m.detail.hardware.find((h) => h.code === 'hinge_domestic');
    assert.equal(hinge.qty, 4);
  } finally { delete global.wx; }
});

test('case 5: 缺 hinge_domestic 价格 → 该项按 0 计, 其他项照常', async () => {
  const pricesNoHinge = PRICES.filter((p) => p.code !== 'hinge_domestic');
  const { costEngine } = await primeDicts({
    price: pricesNoHinge, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 50, h: 230, label: 'A柜' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    // hinge 应不出现在 detail 或 total=0
    const hinge = (m.detail.hardware || []).find((h) => h.code === 'hinge_domestic');
    // 允许两种实现:(a)不显示,(b)显示但 total=0
    if (hinge) assert.equal(hinge.total, 0);
    // 其他五金正常
    assert.ok(m.hardwareCost > 0);
  } finally { delete global.wx; }
});

test('case 6: wall={w:400,h:280} → SK 面积 = (2*280 + 2*280 + 396*2) / 10000', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 50, h: 230, label: 'A' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_piano_lacquer',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: { w: 400, h: 280 },
    });
    assert.ok(cost.sk, 'SK 存在');
    const expectArea = (2 * 280 + 2 * 280 + 396 * 2) / 10000;
    assert.equal(cost.sk.area, Math.round(expectArea * 10000) / 10000);
    // SK 单价 = panel_egger(195) + door_material_piano_lacquer(200) + door_craft_none(0) = 395
    assert.equal(cost.sk.unit, 395);
  } finally { delete global.wx; }
});

test('case 7: 单柜 glb metadata miss → module.missing="meta"', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A],   // 100B 未提供
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'b', w: 100, h: 230, label: '100B' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    assert.equal(m.missing, 'meta');
    assert.equal(m.glbFile, '100B.glb');
  } finally { delete global.wx; }
});

test('case 8: kind=sk/spacer 直接跳过', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [
        { kind: 'sk', code: 'SK', w: 2, h: 260 },
        { kind: 'spacer', w: 30, h: 230 },
        { kind: 'standard', code: 'a', w: 50, h: 230, label: 'A' },
      ],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    // sk/spacer 不产生 module, 只有 A 柜 1 个
    assert.equal(cost.modules.length, 1);
    assert.equal(cost.modules[0].code, 'a');
  } finally { delete global.wx; }
});

test('case 9: 明细 panel 名称从 panelDict 查中文, miss fallback 到 node_name', async () => {
  const panelsMissTop = PANELS.filter((p) => p.panel_code !== 'top_panel_18');
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: panelsMissTop,
    model_panel_hardware: [META_50A],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 50, h: 230, label: 'A' }],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    const m = cost.modules[0];
    const top = m.detail.panels.find((p) => p.name === 'top_panel_18' || p.name === '顶板');
    assert.equal(top.name, 'top_panel_18');   // panelDict miss, fallback
    const sideL = m.detail.panels.find((p) => p.name === '左侧板');
    assert.ok(sideL, '侧板中文命中');
  } finally { delete global.wx; }
});

test('case 10: 转角柜 code=y → glb=Y-110-230.glb;加高转角 yg → YG-110-230G1.glb', async () => {
  const meta_Y = Object.assign({}, META_50A, { glb_file_name: 'Y-110-230.glb', overall_size: { total_width: 110, total_height: 230, total_depth: 111 } });
  const meta_YG = Object.assign({}, META_100G1, { glb_file_name: 'YG-110-230G1.glb' });
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [meta_Y, meta_YG, META_50A, META_100A, META_100G1],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [
        { kind: 'corner', code: 'y', w: 110, h: 230, label: '右转角' },
        { kind: 'raise', code: 'yg', w: 110, h: 70, label: '右转角加高' },
      ],
      materials: {
        panel: 'panel_egger', doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none',
      },
      wall: null,
    });
    assert.equal(cost.modules.length, 2);
    assert.equal(cost.modules[0].glbFile, 'Y-110-230.glb');
    assert.equal(cost.modules[1].glbFile, 'YG-110-230G1.glb');
  } finally { delete global.wx; }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/cost-engine.test.js`
Expected: FAIL 全部 10 用例(旧 cost-engine 无这些函数、无字典依赖)。

- [ ] **Step 3: 重写 `cost-engine.js`**

Replace entire content of `miniprogram/utils/cost-engine.js`:

```js
// 成本引擎 v2 — 完全数据驱动。
// 依赖:
//   utils/price-dict.js         价格 code → {price, name, unit, brand_type, category}
//   utils/panel-dict.js         panel_code → {display_name, category}
//   utils/model-meta-cache.js   glb_file_name → 元数据文档 (peekMeta 同步读)
//   utils/panel-formulas.js     非标/加高的严格板件公式
//
// 前置:调用前需保证 bootstrap.ensureCostDataReady 至少跑过一次 (app.onLaunch 里编排)。
// 字典 miss 只影响相关明细项;单价 miss → 该项按 0 + warn。
//
// 与旧版差异:
//   - 移除所有硬编码 PANEL_PRICE / DOOR_PANEL_DELTA / HINGE_TABLE / … 常量
//   - 标柜/转角直接读 glb 元数据的 board_list + hardware_list
//   - 非标(e1/e2)/加高(g/yg/zg) 用基础柜的 board_list 结构 + panel-formulas 重算尺寸
//   - 五金 code = `${key}_${brand_type}`;lighting=none 时 LED 三项 qty=0

const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMeta = require('./model-meta-cache.js');
const { PANEL_FORMULAS } = require('./panel-formulas.js');

const LED_KEYS = ['led_light_strip', 'led_light_power', 'led_light_switch'];

// —— 单柜 → glb_file_name 分派 —— //
function resolveGlbFile(cabinet) {
  if (!cabinet) return null;
  switch (cabinet.kind) {
    case 'standard':
      return `${cabinet.w}${(cabinet.code || '').toUpperCase()}.glb`;
    case 'corner':
      return `${(cabinet.code || '').toUpperCase()}-110-230.glb`;
    case 'nonstandard':
      return cabinet.w <= 60 ? '50A.glb' : '100A.glb';
    case 'raise':
      if (cabinet.code === 'yg') return 'YG-110-230G1.glb';
      if (cabinet.code === 'zg') return 'ZG-110-230G1.glb';
      return '100G1.glb';
    case 'sk':
    case 'spacer':
    default:
      return null;
  }
}

// —— 非标/加高:按公式重算 board_list 尺寸, 五金 hardware_list 保留 —— //
function rescaleMetadata(baseMeta, W, H) {
  const newBoards = (baseMeta.board_list || []).map((b) => {
    const f = PANEL_FORMULAS[b.node_name];
    if (!f) {
      console.warn('[cost-engine] panel-formula miss', b.node_name);
      return b;   // fallback 原尺寸
    }
    const dims = f(W, H);
    return {
      node_name: b.node_name,
      length: dims.length,
      width: dims.width,
      thickness: dims.thickness,
      area: round4(dims.length * dims.width / 10000),
    };
  });
  let bodyArea = 0, doorArea = 0;
  newBoards.forEach((b) => {
    const dictEntry = panelDict.get(b.node_name);
    const cat = dictEntry ? dictEntry.category : 'cabinet_frame';
    if (cat === 'hanging_component') return;   // 挂衣杆不计板件面积
    if (cat === 'door_panel') doorArea += b.area;
    else bodyArea += b.area;
  });
  bodyArea = round4(bodyArea);
  doorArea = round4(doorArea);
  return {
    ...baseMeta,
    overall_size: {
      total_width: W,
      total_height: H,
      total_depth: (baseMeta.overall_size && baseMeta.overall_size.total_depth) || 60,
    },
    board_list: newBoards,
    total_body_area: bodyArea,
    total_door_area: doorArea,
    total_raw_board_area: round4(bodyArea + doorArea),
    // hardware_list 保持基础柜原值
  };
}

// —— 板材明细:每块板一条 —— //
function buildPanelDetail(boardList, panelUnit, doorMatUnit, doorCraftUnit) {
  const doorUnit = panelUnit + doorMatUnit + doorCraftUnit;
  const out = [];
  (boardList || []).forEach((b) => {
    const dictEntry = panelDict.get(b.node_name);
    const cat = dictEntry ? dictEntry.category : 'cabinet_frame';
    if (cat === 'hanging_component') return;   // 挂衣杆走五金明细
    const name = dictEntry ? dictEntry.display_name : b.node_name;
    const unit = cat === 'door_panel' ? doorUnit : panelUnit;
    out.push({
      name,
      code: b.node_name,
      size: `${b.length}×${b.width}×${b.thickness}`,
      qty: 1,
      area: round4(b.area),
      unit,
      total: round2(b.area * unit),
    });
  });
  return out;
}

// —— 单柜成本 —— //
function calcModule(cabinet, cfg) {
  const glbFile = resolveGlbFile(cabinet);
  if (!glbFile) return null;

  const baseMeta = modelMeta.peekMeta(glbFile);
  if (!baseMeta) {
    return { missing: 'meta', label: cabinet.label || '', code: cabinet.code, w: cabinet.w, h: cabinet.h, glbFile };
  }

  const isFormulaPath = cabinet.kind === 'nonstandard' || cabinet.kind === 'raise';
  const meta = isFormulaPath ? rescaleMetadata(baseMeta, cabinet.w, cabinet.h) : baseMeta;

  const panelPriceEntry = priceDict.get(cfg.panel);
  const doorMatEntry = priceDict.get(cfg.doorPanel);
  const doorCraftEntry = priceDict.get(cfg.doorCraft);
  const panelUnit = panelPriceEntry ? panelPriceEntry.price : 0;
  const doorMatUnit = doorMatEntry ? doorMatEntry.price : 0;
  const doorCraftUnit = doorCraftEntry ? doorCraftEntry.price : 0;
  if (!panelPriceEntry) console.warn('[cost-engine] price miss', cfg.panel);
  if (!doorMatEntry) console.warn('[cost-engine] price miss', cfg.doorPanel);
  if (!doorCraftEntry) console.warn('[cost-engine] price miss', cfg.doorCraft);

  const bodyCost = meta.total_body_area * panelUnit;
  const doorCost = meta.total_door_area * (doorMatUnit + doorCraftUnit);

  const brand = cfg.hardware;          // 'domestic' | 'import'
  const lighting = cfg.lighting;       // 'none' | 'led_domestic' | 'led_import'
  const ledBrand = lighting === 'led_import' ? 'import' : 'domestic';

  let hardwareCost = 0;
  const hardwareDetail = [];
  Object.entries(meta.hardware_list || {}).forEach(([key, qty]) => {
    let priceCode;
    let effectiveQty = qty;
    if (LED_KEYS.indexOf(key) >= 0) {
      if (lighting === 'none') effectiveQty = 0;
      priceCode = `${key}_${ledBrand}`;
    } else {
      priceCode = `${key}_${brand}`;
    }
    const p = priceDict.get(priceCode);
    if (!p) {
      console.warn('[cost-engine] price miss', priceCode);
      return;
    }
    const total = effectiveQty * p.price;
    hardwareCost += total;
    hardwareDetail.push({
      code: priceCode, name: p.name || key, spec: p.unit || '',
      qty: effectiveQty, unit: p.price, total: round2(total),
    });
  });

  return {
    label: cabinet.label || '',
    code: cabinet.code, w: cabinet.w, h: cabinet.h, glbFile,
    totalBodyArea: round4(meta.total_body_area),
    totalDoorArea: round4(meta.total_door_area),
    totalRawBoardArea: round4(meta.total_raw_board_area),
    // 命名兼容旧 UI:'板材合计' 含门板成本
    panelCost: round2(bodyCost + doorCost),
    hardwareCost: round2(hardwareCost),
    detail: {
      panels: buildPanelDetail(meta.board_list, panelUnit, doorMatUnit, doorCraftUnit),
      hardware: hardwareDetail,
    },
  };
}

// —— 方案汇总 —— //
function calc({ cabinets, materials, wall }) {
  const cfg = {
    panel: (materials && materials.panel) || 'panel_e2_domestic',
    doorPanel: (materials && materials.doorPanel) || 'door_material_same_as_cabinet',
    doorCraft: (materials && materials.doorCraft) || 'door_craft_none',
    hardware: (materials && materials.hardware) || 'domestic',
    lighting: (materials && materials.lighting) || 'none',
  };

  const modules = (cabinets || []).map((c) => calcModule(c, cfg)).filter(Boolean);

  const transportEntry = priceDict.get('transport_fee');
  const installEntry = priceDict.get('install_fee');
  const transportUnit = transportEntry ? transportEntry.price : 0;
  const installUnit = installEntry ? installEntry.price : 0;

  const sumPanel = modules.reduce((s, m) => s + (m.panelCost || 0), 0);
  const sumHw = modules.reduce((s, m) => s + (m.hardwareCost || 0), 0);
  const sumArea = modules.reduce((s, m) => s + (m.totalRawBoardArea || 0), 0);
  const transport = round2(sumArea * transportUnit);
  const install = round2(sumArea * installUnit);

  // 每 module 补摊 transport / install 到卡片显示
  modules.forEach((m) => {
    if (m.missing) { m.transport = 0; m.install = 0; m.total = 0; return; }
    m.transport = round2(m.totalRawBoardArea * transportUnit);
    m.install = round2(m.totalRawBoardArea * installUnit);
    m.total = round2(m.panelCost + m.hardwareCost + m.transport + m.install);
  });

  // 收口条:面积公式沿用旧版, 单价 = panel + doorMat + doorCraft
  let sk = null;
  if (wall && wall.w && wall.h) {
    const p = priceDict.get(cfg.panel);
    const dm = priceDict.get(cfg.doorPanel);
    const dc = priceDict.get(cfg.doorCraft);
    const skUnit = (p ? p.price : 0) + (dm ? dm.price : 0) + (dc ? dc.price : 0);
    const skArea = round4((2 * wall.h + 2 * wall.h + (wall.w - 4) * 2) / 10000);
    sk = { label: '收口条', area: skArea, unit: skUnit, total: round2(skUnit * skArea) };
  }

  const grandTotal = round2(sumPanel + sumHw + transport + install + (sk ? sk.total : 0));
  return {
    modules,
    sk,
    transport, install,
    panelTotal: round2(sumPanel),
    hardwareTotal: round2(sumHw),
    grandTotal,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

module.exports = { calc, calcModule, resolveGlbFile, rescaleMetadata };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/cost-engine.test.js`
Expected: PASS 全部 10 用例。

如果某用例失败, 检查:
- 断言里的期望值是否要按四舍五入前后调整
- fixture 数据是否与 spec 表格一致
- price code 拼接是否遗漏了某个 brand

- [ ] **Step 5: 跑全量测试确认没打断已有测试**

Run: `node --test tests/*.test.js`
Expected: 全部 test files 通过(不含 legacy `run.js` — 那个跑旧 cost-engine 的算例会因为公式换成数据驱动 100% 不通过, 下一步处理)。

- [ ] **Step 6: 处理 legacy `run.js` 里的旧 cost 测试**

`tests/run.js` 里有对旧 `cost-engine.js` 的引用/断言吗?查一下:

Run: `grep -n "cost" tests/run.js | head -30`

如果有断言(比如 `eq(cost.calc(...).grandTotal, ...)`), 因为公式已从"内部硬编码"改为"数据驱动 + 3 张字典", 老测试的期望值已不成立。做法:把 `tests/run.js` 里的 cost 相关块整段删除或注释掉, 并在删除位置加注释指向 `tests/cost-engine.test.js`。

如果只是 `require('cost-engine')` 但没有断言, 可以保留 require 不删。

- [ ] **Step 7: Commit**

```bash
git add miniprogram/utils/cost-engine.js tests/cost-engine.test.js tests/run.js
git commit -m "feat(cost-engine): 数据驱动完全重写

- 移除全部硬编码 PANEL_PRICE / HINGE_TABLE / … 常量表
- 标柜/转角走 glb 元数据 (peekMeta)
- 非标(50A/100A) / 加高(100G1/YG-110-230G1/ZG-110-230G1) 走公式重算板件, 五金取基础柜
- 五金 code = <key>_<brand>, lighting=none 时 LED 三项 qty=0
- 单价 miss + panel_code miss + panel-formula miss 各自 warn + 兜底
- SK 面积公式沿用旧版, 单价改为 panel+doorMat+doorCraft 三 code 相加
- 10 个端到端算例覆盖 spec §9 全部 case + 转角 + spacer/sk 跳过
- tests/run.js 移除对旧 cost 常量的断言 (期望值已随字典化改变)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `materials/index.js` — 选项 id 全部换 code

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.js`

- [ ] **Step 1: 修改 `PANEL_OPTIONS` 等常量为 code-based**

在 `miniprogram/cabinet/pages/materials/index.js` 顶部, 把 5 组常量整体替换:

Find:
```js
const PANEL_OPTIONS = [
  { id: 'E2国产板', name: 'E2 国产板', desc: '性价比之选' },
  { id: '兔宝宝', name: '兔宝宝', desc: '国产环保板材' },
  { id: '克诺斯帮', name: '克诺斯帮', desc: '中国制造，欧洲品牌' },
  { id: '德国克诺斯帮', name: '德国克诺斯帮', desc: '德国原装进口' },
  { id: '爱格', name: '爱格', desc: '奥地利顶级板材' },
];

const DOOR_PANEL_OPTIONS = [
  { id: '柜体相同', name: '与柜体相同', desc: '不加价' },
  { id: '钢琴烤漆', name: '钢琴烤漆', desc: '光泽细腻' },
  { id: '肤感烤漆', name: '肤感烤漆', desc: '柔和触感' },
  { id: '铝框AG玻璃', name: '铝框 AG 玻璃', desc: '通透显大' },
  { id: '实木贴皮', name: '实木贴皮', desc: '木纹纹理' },
  { id: '橡胶实木', name: '橡胶实木', desc: '中等档次' },
  { id: '白蜡实木', name: '白蜡实木', desc: '高端实木' },
];

const DOOR_CRAFT_OPTIONS = [
  { id: '无', name: '无' },
  { id: '骨格线', name: '骨格线' },
  { id: '欧式', name: '欧式' },
  { id: '格栅门', name: '格栅门' },
];

const HARDWARE_OPTIONS = [
  { id: '中国品牌', name: '中国品牌', desc: '默认 DTC' },
  { id: '海外品牌', name: '海外品牌', desc: '百隆 + 海福乐' },
];

const LIGHTING_OPTIONS = [
  { id: '无', name: '无' },
  { id: '国产', name: '国产灯带', desc: '10mm × 10mm 超薄' },
  { id: '进口', name: '海福乐灯带', desc: '柔光均匀' },
];

const DEFAULT_MATERIALS = {
  panel: 'E2国产板',
  doorPanel: '柜体相同',
  doorCraft: '无',
  hardware: '中国品牌',
  lighting: '无',
};
```

Replace with:
```js
// 选项 id 直接用 price / brand code, 保存到 plan.materials 后由 cost-engine 用 code 查价字典。
// name / desc 仅用于 UI 显示 —— 见 spec §4。

const PANEL_OPTIONS = [
  { id: 'panel_e2_domestic', name: 'E2 国产板', desc: '性价比之选' },
  { id: 'panel_tu_baby_domestic', name: '兔宝宝', desc: '国产环保板材' },
  { id: 'panel_kronospan_domestic', name: '国产克诺斯帮', desc: '中国制造，欧洲品牌' },
  { id: 'panel_kronospan_germany', name: '德国克诺斯帮', desc: '德国原装进口' },
  { id: 'panel_egger', name: '爱格', desc: '奥地利顶级板材' },
];

const DOOR_PANEL_OPTIONS = [
  { id: 'door_material_same_as_cabinet', name: '与柜体相同', desc: '不加价' },
  { id: 'door_material_piano_lacquer', name: '钢琴烤漆', desc: '光泽细腻' },
  { id: 'door_material_skin_feel_lacquer', name: '肤感烤漆', desc: '柔和触感' },
  { id: 'door_material_aluminum_frame_ag_glass', name: '铝框 AG 玻璃', desc: '通透显大' },
  { id: 'door_material_wood_veneer', name: '实木贴皮', desc: '木纹纹理' },
  { id: 'door_material_rubber_solid_wood', name: '橡胶实木', desc: '中等档次' },
  { id: 'door_material_ash_solid_wood', name: '白蜡实木', desc: '高端实木' },
];

const DOOR_CRAFT_OPTIONS = [
  { id: 'door_craft_none', name: '无' },
  { id: 'door_craft_skeleton_line_shallow', name: '骨格线' },
  { id: 'door_craft_european_deep', name: '欧式' },
  { id: 'door_craft_grille_door', name: '格栅门' },
];

// hardware 存的是 brand_type 本身 (domestic / import), 与 price code 的后缀对齐
const HARDWARE_OPTIONS = [
  { id: 'domestic', name: '中国品牌', desc: '默认 DTC' },
  { id: 'import', name: '海外品牌', desc: '百隆 + 海福乐' },
];

// lighting 是分流:none / led_domestic / led_import, 与 hardware 独立
const LIGHTING_OPTIONS = [
  { id: 'none', name: '无' },
  { id: 'led_domestic', name: '国产灯带', desc: '10mm × 10mm 超薄' },
  { id: 'led_import', name: '海福乐灯带', desc: '柔光均匀' },
];

const DEFAULT_MATERIALS = {
  panel: 'panel_e2_domestic',
  doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none',
  hardware: 'domestic',
  lighting: 'none',
};
```

其余代码(Page 定义、pickPanel/pickDoorPanel 等)不用改, 因为它们通过 `data-id` 与 `materials[key] === item.id` 比较, 只是内容换了。

- [ ] **Step 2: 验证 wxml 不需要改**

Read: `miniprogram/cabinet/pages/materials/index.wxml`

确认 wxml 里 `wx:for="{{panelOpts}}"` 循环用 `item.id` 作为 `data-id`, 以及用 `materials.panel === item.id ? 'active'` 作为选中判定 — 因为 id 换了, 但结构和绑定完全不变, 所以 wxml 无需修改。

- [ ] **Step 3: 手工 sanity check (若能起小程序开发工具)**

进入 materials 页, 点选每个大类的第一项和最后一项, 观察不报错、样式选中态正常。如果不方便手动跑, 跳过此步。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/cabinet/pages/materials/index.js
git commit -m "feat(materials): 选项 id 从中文改为 price code

- 5 组常量 (panel/doorPanel/doorCraft/hardware/lighting) id 全部换 code
- hardware 存 brand_type (domestic/import), lighting 独立 (none/led_domestic/led_import)
- DEFAULT_MATERIALS 同步更新
- wxml 不改 (只是 id 值换了, 绑定语义不变)
- 存量老方案 plan.materials 仍是中文 id, 会走 cost-engine 的 price miss 降级 (spec §10)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `app.js onLaunch` — 编排 bootstrap

**Files:**
- Modify: `miniprogram/app.js`

- [ ] **Step 1: 在 onLaunch 追加 bootstrap 调用**

Find (in `miniprogram/app.js`, inside `onLaunch: function () { ... }`, near the `model-sync` block around line 71-79):

```js
    // 柜体 GLB 模型云存储同步：不 await，后台跑
    try {
      var modelSync = require('./utils/model-sync.js');
      modelSync.syncOnLaunch().catch(function (err) {
        console.warn('[model-sync] launch sync failed:', err);
      });
    } catch (e) {
      console.warn('[model-sync] init failed:', e);
    }
```

After this block, add:

```js
    // 成本模块 3 字典 (价格/板件中英/glb元数据) 启动预拉:不 await, 后台跑;
    // 成本页会再校验字典状态, 缺则 toast + "——" 降级 (见 cost-engine.test.js case 5/7)。
    try {
      var bootstrap = require('./utils/bootstrap.js');
      bootstrap.ensureCostDataReady().catch(function (err) {
        console.warn('[bootstrap] ensureCostDataReady failed:', err);
      });
    } catch (e) {
      console.warn('[bootstrap] init failed:', e);
    }
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/app.js
git commit -m "feat(app): onLaunch 触发 bootstrap.ensureCostDataReady

- 后台并行拉 price / panel_name_dict / model_panel_hardware 三字典入 storage
- 不 await, 失败仅 warn, 不阻塞其他 onLaunch 流程

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `cost/index.js` — 字典状态检查 + `——` 降级

**Files:**
- Modify: `miniprogram/cabinet/pages/cost/index.js`
- Modify: `miniprogram/cabinet/pages/cost/index.wxml`

- [ ] **Step 1: 修改 `cost/index.js` 的 onLoad 与相关方法**

Find (line 1-4 of `miniprogram/cabinet/pages/cost/index.js`):

```js
const costEngine = require('../../../utils/cost-engine.js');
const cloud = require('../../../utils/cloud.js');
const wireframeLabels = require('../../utils/wireframe-labels.js');
const imgCache = require('../../../utils/img-cache.js');
```

After that, add:

```js
const bootstrap = require('../../../utils/bootstrap.js');
```

Find (line ~22 `data:` block, add fields):

```js
  data: {
    plan: null,
    from: 'design',
    cost: { modules: [], grandTotal: 0 },
    bottomRow: [],
    topRow: [],
    labelPositions: [],
    wireframeReady: false,
    detailOpen: false,
    currentDetail: null,
    downloadOpen: false,
    downloadInfo: { link: '', code: '' },
    floatToast: '',
  },
```

Replace the `data:` block to add data-ready flag:

```js
  data: {
    plan: null,
    from: 'design',
    cost: { modules: [], grandTotal: 0 },
    bottomRow: [],
    topRow: [],
    labelPositions: [],
    wireframeReady: false,
    detailOpen: false,
    currentDetail: null,
    downloadOpen: false,
    downloadInfo: { link: '', code: '' },
    floatToast: '',
    dataReady: true,           // 三字典就绪;false 时金额全显 "——"
    dataNotice: '',            // 顶部提示条 (空则不显示)
  },
```

Find `onLoad(query) { ... }` (line ~22-57).

Replace it entirely with:

```js
  onLoad(query) {
    const from = query.from || 'design';
    const id = query.id;
    const app = getApp();
    let plan = app.globalData.currentPlan;
    if ((!plan || plan.id !== id) && id) {
      plan = app.getDesignById(id) || plan;
    }
    if (!plan) {
      wx.navigateBack();
      return;
    }
    this._plan = plan;
    this._from = from;
    // 先渲染骨架 (线框等), 再异步保证字典就绪, 最后算成本
    const cabinets = plan.cabinets || [];
    const bottomRow = cabinets.filter((c) => c.kind !== 'raise');
    const topRow = cabinets.filter((c) => c.kind === 'raise');
    const wireframeReady = !!(plan.wireframeHasLabels
      && plan.wireframeLabelsVersion === wireframeLabels.WIREFRAME_LABELS_VERSION);
    this.setData({
      plan, from, bottomRow, topRow,
      labelPositions: wireframeLabels.computeLabelPositions(plan),
      wireframeReady,
    });
    this._maybeBakeWireframe();
    this._computeCost();
  },

  async _computeCost() {
    await bootstrap.ensureCostDataReady();
    const ready = bootstrap.isAllReady();
    const plan = this._plan;
    if (!ready) {
      this.setData({
        dataReady: false,
        dataNotice: '价格数据未就绪,请重试',
        cost: { modules: [], grandTotal: '——' },
      });
      return;
    }
    const cost = costEngine.calc({
      cabinets: plan.cabinets || [],
      materials: plan.materials || {},
      wall: plan.wall,
    });
    this.setData({ dataReady: true, dataNotice: '', cost });
  },

  onRetryDataFetch() {
    this.setData({ dataNotice: '正在重试…' });
    bootstrap.ensureCostDataReady({ force: true }).then(() => this._computeCost());
  },
```

Note: **删除原 onLoad 的最后几行**: `const cost = costEngine.calc(...)` 和 `this.setData(... cost, ...)` 这段计算逻辑已迁到 `_computeCost`。

- [ ] **Step 2: 在 `cost/index.wxml` 顶部加一条数据提示条 + 修改五金明细规格列**

Find (line 4-5 area, after `<image class="bg-image">`):

```wxml
  <image class="bg-image bg-image-light" src="{{assets.bg('T3')}}" mode="aspectFill" lazy-load />

  <view class="section wireframe">
```

Insert between them:

```wxml
  <image class="bg-image bg-image-light" src="{{assets.bg('T3')}}" mode="aspectFill" lazy-load />

  <view class="data-notice" wx:if="{{dataNotice}}">
    <text>{{dataNotice}}</text>
    <view class="retry" bindtap="onRetryDataFetch">重试</view>
  </view>

  <view class="section wireframe">
```

Find (五金明细行, line ~102-108):

```wxml
        <view class="tbl-row" wx:for="{{currentDetail.detail.hardware}}" wx:key="name">
          <view class="c1">{{item.name}}</view>
          <view class="c2">数量</view>
          <view class="c3">{{item.qty}}</view>
          <view class="c4">¥{{item.unit}}</view>
          <view class="c5">¥{{item.total}}</view>
        </view>
```

Replace with:

```wxml
        <view class="tbl-row" wx:for="{{currentDetail.detail.hardware}}" wx:key="name">
          <view class="c1">{{item.name}}</view>
          <view class="c2">{{item.spec}}</view>
          <view class="c3">{{item.qty}}</view>
          <view class="c4">¥{{item.unit}}</view>
          <view class="c5">¥{{item.total}}</view>
        </view>
```

- [ ] **Step 3: 追加 wxss 样式**

Find `miniprogram/cabinet/pages/cost/index.wxss` — 在文件末尾追加:

```css
.data-notice {
  background: #fff5e6;
  color: #8a5a00;
  padding: 16rpx 24rpx;
  margin: 16rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 26rpx;
}
.data-notice .retry {
  color: #FC9700;
  padding: 6rpx 20rpx;
  border: 2rpx solid #FC9700;
  border-radius: 24rpx;
  font-size: 24rpx;
}
```

- [ ] **Step 4: 手工 sanity(若能起开发工具)**

- 进入 cost 页, 观察金额显示与旧版一致
- 五金明细"规格"列显示 "㎡"/"个"/"米" (来自 price.unit)
- 断网/清空 price 集合的场景, 顶部出现橙色提示条与"重试"按钮

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/pages/cost/index.js miniprogram/cabinet/pages/cost/index.wxml miniprogram/cabinet/pages/cost/index.wxss
git commit -m "feat(cost-page): 字典状态检查 + 数据未就绪降级 + 五金规格列

- onLoad 先渲染骨架, 再 await bootstrap.ensureCostDataReady() 再算成本
- price/panel 字典 miss 时顶部橙条提示 + 金额 '——', 支持点击重试
- 五金明细'规格'列改为绑 item.spec (来自 price.unit '㎡/个/米')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 端到端回归 + 提交清理

**Files:** 无新增, 只跑测试与最终提交清单

- [ ] **Step 1: 跑全量新测试**

Run:
```
node --test tests/price-dict.test.js tests/panel-dict.test.js tests/panel-formulas.test.js tests/bootstrap.test.js tests/model-meta-cache.test.js tests/cost-engine.test.js
```

Expected: 全部 PASS。

- [ ] **Step 2: 跑 legacy `run.js` 确认没打断其他模块**

Run: `node tests/run.js`
Expected: 除了(如已删除的)旧 cost 用例外, layout / rules / model-sync-diff / cabinet-model 等全部 PASS(pass 数与失败数 = 0)。

- [ ] **Step 3: 最终 git 状态检查**

Run: `git status && git log --oneline -12`
Expected:
- working tree clean
- 最近 8+ 次提交对应本 plan 的 Task 1..9
- 若 tests/run.js 有未 commit 的 cost 相关删除, 补一次 commit

- [ ] **Step 4: 触发 `finishing-a-development-branch` skill**

调用: `Skill superpowers:finishing-a-development-branch` — 由 skill 决定 merge / PR / 保留 branch 的下一步。

---

## Self-Review 备忘

已核对(spec ↔ plan):

- ✅ §2 (三张云表) → Task 1/2/3 各自 preloadAll + 分页
- ✅ §3 (文件影响清单) → 与本 plan 文件影响清单一致
- ✅ §4 (materials 选项 code) → Task 7 五组常量完整替换
- ✅ §5 (bootstrap + 读老+后台刷新缓存策略) → Task 5 ensureCostDataReady + Task 1/2 各自的后台 _refreshInBackground + Task 3 model-meta 每次覆盖 + Task 8 app.onLaunch 接入
- ✅ §6.1 (resolveGlbFile) → Task 6 内实现, 转角/加高分派完整
- ✅ §6.2 (calcModule) → Task 6 单价 miss + LED 分流全覆盖
- ✅ §6.3 (rescaleMetadata + PANEL_FORMULAS) → Task 4 公式表 + Task 6 rescaleMetadata
- ✅ §6.4 (calc 汇总 + SK) → Task 6 calc + case 6 断言
- ✅ §7 (明细页 spec 列) → Task 9 wxml 改绑 item.spec
- ✅ §8 (错误处理) → Task 9 顶部提示条 + 重试, Task 6 单价/panel_code/panel-formula 三类 miss 分别 warn
- ✅ §9 (测试 6 case) → Task 6 test file 10 case 全覆盖 + 转角/spacer 补充
- ✅ §10 (旧数据不兼容) → Task 7 commit message 里注明存量方案走降级

**No placeholders. All code inline. All commands + expected output specified.**
