# 板材五金选择页 · 成本预览缓存 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** materials 页 ↔ cost 页往返时命中缓存, 避免对同一 `plan + materials` 组合的重复 `costEngine.calc()`; materials 重新选择配置时正常重算并覆盖缓存。

**Architecture:** 新增内存 Map 缓存模块 `materials-cost-cache.js`, key=`plan.id`, value=`{ signature, cost }`。signature 由 materials 五项 + cabinets 关键字段 + wall 尺寸拼装 (JSON.stringify)。materials/cost 页 `onLoad`/`_computeCost` 命中读缓存, 计算成功后写缓存; `bootstrap.ensureCostDataReady({force:true})` 触发 `clearAll`。

**Tech Stack:** 微信小程序 (纯 JS), `node --test` + `node:assert/strict` 测试。

**Spec:** `docs/superpowers/specs/2026-07-18-materials-cost-cache-design.md`

---

## 文件结构

- **新增:** `miniprogram/utils/materials-cost-cache.js` — 缓存模块; 导出 `get / set / clearAll / computeSignature`
- **新增:** `tests/materials-cost-cache.test.js` — 单元测试
- **修改:** `miniprogram/utils/bootstrap.js` — `ensureCostDataReady` 里 `force===true` 时调 `clearAll`
- **修改:** `miniprogram/cabinet/pages/materials/index.js` — `onLoad` 里读缓存; `_computeCost` 里写缓存
- **修改:** `miniprogram/cabinet/pages/cost/index.js` — `_computeCost` 里读/写缓存

---

## Task 1: 缓存模块 — 骨架 (常量清单 + 空导出)

**Files:**
- Create: `miniprogram/utils/materials-cost-cache.js`

先落骨架, 之后一步一步补 `computeSignature / get / set / clearAll`。这样 Task 2/3 的失败测试指向确切的"缺功能"而不是"缺文件"。

- [ ] **Step 1: 写骨架**

```js
// miniprogram/utils/materials-cost-cache.js
//
// 内存缓存 (进程内, 不落 storage): key = plan.id, value = { signature, cost }。
// materials 页 ↔ cost 页往返时命中缓存, 避免对同一 plan + materials 组合的重复
// costEngine.calc()。签名相同 ⇒ 输入面等价 ⇒ 重算必然得同样 cost。
//
// 失效触发:
//  - materials 五项 / plan.cabinets 关键字段 / plan.wall 变化 → signature 变 → miss
//  - bootstrap.ensureCostDataReady({force:true}) → clearAll() (价格字典要重拉)
//
// 输入面清单 = cost-engine.js 里 calcModule / resolveGlbFile / calc 实际读到的
// cabinet.* 和 wall.* 字段。改动 cost-engine 输入面时须同步更新此清单。
const COST_INPUT_FIELDS_CABINET = ['kind', 'w', 'h', 'code'];
const COST_INPUT_FIELDS_WALL = ['w', 'h'];
const MATERIALS_FIELDS = ['panel', 'doorPanel', 'doorCraft', 'hardware', 'lighting'];

const store = new Map(); // planId -> { signature, cost }

function computeSignature(/* plan, materials */) {
  // 下一步填充
  throw new Error('computeSignature not implemented');
}

function get(/* plan, materials */) {
  return null;
}

function set(/* plan, materials, cost */) {
  // no-op
}

function clearAll() {
  store.clear();
}

module.exports = { computeSignature, get, set, clearAll };
```

- [ ] **Step 2: 确认文件已写入**

Run: `node -e "console.log(Object.keys(require('./miniprogram/utils/materials-cost-cache.js')))"`
Expected: `[ 'computeSignature', 'get', 'set', 'clearAll' ]`

- [ ] **Step 3: Commit**

```bash
git add miniprogram/utils/materials-cost-cache.js
git commit -m "feat(materials-cost-cache): skeleton module"
```

---

## Task 2: `computeSignature` — 纯函数 + 测试

**Files:**
- Modify: `miniprogram/utils/materials-cost-cache.js`
- Test: `tests/materials-cost-cache.test.js`

先写测试, 再改函数。

- [ ] **Step 1: 写失败测试**

```js
// tests/materials-cost-cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshCache() {
  const p = path.resolve(__dirname, '../miniprogram/utils/materials-cost-cache.js');
  delete require.cache[p];
  return require(p);
}

const PLAN_A = {
  id: 'plan-a',
  cabinets: [
    { kind: 'standard', w: 50, h: 230, code: 'a' },
    { kind: 'standard', w: 100, h: 230, code: 'a' },
  ],
  wall: { w: 480, h: 240 },
};
const M1 = { panel: 'panel_e2_domestic', doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none' };

test('computeSignature: 同输入 → 同签名 (稳定)', () => {
  const cache = freshCache();
  const s1 = cache.computeSignature(PLAN_A, M1);
  const s2 = cache.computeSignature(PLAN_A, M1);
  assert.equal(s1, s2);
});

test('computeSignature: materials 任一字段变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  ['panel', 'doorPanel', 'doorCraft', 'hardware', 'lighting'].forEach((k) => {
    const m = Object.assign({}, M1, { [k]: M1[k] + '_x' });
    assert.notEqual(cache.computeSignature(PLAN_A, m), base, k + ' 应改变签名');
  });
});

test('computeSignature: cabinets 关键字段变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const withResizedCabinet = Object.assign({}, PLAN_A, {
    cabinets: [
      Object.assign({}, PLAN_A.cabinets[0], { w: 60 }), // 50 → 60
      PLAN_A.cabinets[1],
    ],
  });
  assert.notEqual(cache.computeSignature(withResizedCabinet, M1), base);
});

test('computeSignature: cabinets 顺序变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const swapped = Object.assign({}, PLAN_A, {
    cabinets: [PLAN_A.cabinets[1], PLAN_A.cabinets[0]],
  });
  assert.notEqual(cache.computeSignature(swapped, M1), base);
});

test('computeSignature: wall 尺寸变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const wallW = Object.assign({}, PLAN_A, { wall: { w: 500, h: 240 } });
  assert.notEqual(cache.computeSignature(wallW, M1), base);
  const wallH = Object.assign({}, PLAN_A, { wall: { w: 480, h: 260 } });
  assert.notEqual(cache.computeSignature(wallH, M1), base);
});

test('computeSignature: cabinets 里非输入面字段变 → 签名不变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const withLabel = Object.assign({}, PLAN_A, {
    cabinets: [
      Object.assign({}, PLAN_A.cabinets[0], { label: '标 A', id: 'c1', extra: 999 }),
      PLAN_A.cabinets[1],
    ],
  });
  assert.equal(cache.computeSignature(withLabel, M1), base);
});

test('computeSignature: 缺 materials/wall 字段应容忍 (给默认空值, 不抛)', () => {
  const cache = freshCache();
  const s = cache.computeSignature({ id: 'x', cabinets: [] }, {});
  assert.equal(typeof s, 'string');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/materials-cost-cache.test.js`
Expected: 全部失败, 首个错误为 `computeSignature not implemented`

- [ ] **Step 3: 实现 `computeSignature`**

替换 `miniprogram/utils/materials-cost-cache.js` 里的 `computeSignature` 桩:

```js
function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj == null ? undefined : obj[f];
  return out;
}

function computeSignature(plan, materials) {
  const M = pick(materials || {}, MATERIALS_FIELDS);
  const C = ((plan && plan.cabinets) || []).map((c) => pick(c || {}, COST_INPUT_FIELDS_CABINET));
  const W = pick((plan && plan.wall) || {}, COST_INPUT_FIELDS_WALL);
  return JSON.stringify({ M, C, W });
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test tests/materials-cost-cache.test.js`
Expected: 7 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/materials-cost-cache.js tests/materials-cost-cache.test.js
git commit -m "feat(materials-cost-cache): computeSignature over cost-engine input surface"
```

---

## Task 3: `get / set / clearAll` — 缓存读写 + 测试

**Files:**
- Modify: `miniprogram/utils/materials-cost-cache.js`
- Modify: `tests/materials-cost-cache.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/materials-cost-cache.test.js` 末尾追加:

```js
const COST_1 = { grandTotal: 1234, modules: [{ label: 'a' }] };
const COST_2 = { grandTotal: 9999, modules: [{ label: 'b' }] };

test('set 后同 plan + 同 materials 的 get 返回原 cost 引用', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  assert.equal(cache.get(PLAN_A, M1), COST_1);
});

test('materials 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const m2 = Object.assign({}, M1, { panel: 'panel_egger' });
  assert.equal(cache.get(PLAN_A, m2), null);
});

test('plan.cabinets 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const resized = Object.assign({}, PLAN_A, {
    cabinets: [Object.assign({}, PLAN_A.cabinets[0], { w: 60 }), PLAN_A.cabinets[1]],
  });
  assert.equal(cache.get(resized, M1), null);
});

test('plan.wall 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const wallH = Object.assign({}, PLAN_A, { wall: { w: 480, h: 260 } });
  assert.equal(cache.get(wallH, M1), null);
});

test('不同 plan.id 之间不串 (同 signature 也各存各的)', () => {
  const cache = freshCache();
  const planB = Object.assign({}, PLAN_A, { id: 'plan-b' });
  cache.set(PLAN_A, M1, COST_1);
  assert.equal(cache.get(planB, M1), null); // 同 signature 但 id 不同 → miss
  cache.set(planB, M1, COST_2);
  assert.equal(cache.get(PLAN_A, M1), COST_1);
  assert.equal(cache.get(planB, M1), COST_2);
});

test('clearAll 后所有 get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  cache.clearAll();
  assert.equal(cache.get(PLAN_A, M1), null);
});

test('get miss 时顺手删陈旧 entry: 覆盖 set 前无遗留', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const m2 = Object.assign({}, M1, { panel: 'panel_egger' });
  // signature 不匹配 → 应删除 entry
  assert.equal(cache.get(PLAN_A, m2), null);
  // 再用原 M1 查, 也应 miss (刚才那次调用把 entry 删了)
  assert.equal(cache.get(PLAN_A, M1), null);
});

test('无 plan.id 时 set/get 不抛, 且各自独立不写入', () => {
  const cache = freshCache();
  const noId = Object.assign({}, PLAN_A, { id: undefined });
  cache.set(noId, M1, COST_1); // 不抛
  assert.equal(cache.get(noId, M1), null); // 未持久化 → miss
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/materials-cost-cache.test.js`
Expected: 前 7 通过, 新增 8 失败 (`get` 返回 null, `set` no-op)

- [ ] **Step 3: 实现 `get / set`**

替换 `materials-cost-cache.js` 里 `get / set`:

```js
function get(plan, materials) {
  try {
    const id = plan && plan.id;
    if (!id) return null;
    const entry = store.get(id);
    if (!entry) return null;
    const sig = computeSignature(plan, materials);
    if (entry.signature === sig) return entry.cost;
    // 陈旧: 顺手删, 避免 Map 长期驻留失效项
    store.delete(id);
    return null;
  } catch (e) {
    console.warn('[materials-cost-cache] get failed:', e);
    return null;
  }
}

function set(plan, materials, cost) {
  try {
    const id = plan && plan.id;
    if (!id) return;
    store.set(id, { signature: computeSignature(plan, materials), cost });
  } catch (e) {
    console.warn('[materials-cost-cache] set failed:', e);
  }
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test tests/materials-cost-cache.test.js`
Expected: 15 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/materials-cost-cache.js tests/materials-cost-cache.test.js
git commit -m "feat(materials-cost-cache): get/set/clearAll with signature match"
```

---

## Task 4: bootstrap 集成 — `force` 时 `clearAll`

**Files:**
- Modify: `miniprogram/utils/bootstrap.js`
- Modify: `tests/bootstrap.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/bootstrap.test.js` 末尾追加:

```js
test('ensureCostDataReady({force:true}) 触发 materials-cost-cache.clearAll', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, {
    cloud: makeCloudMock({
      price: [{ code: 'panel_egger', price: 195, category: 'panel' }],
      panel_name_dict: [{ panel_code: 'top_panel_18', display_name: '顶板', category: 'cabinet_frame', enable: true }],
      model_panel_hardware: [{ glb_file_name: '50A.glb', is_online: true, total_body_area: 4.7 }],
    }),
  });
  try {
    // 重要: 让 bootstrap 与 materials-cost-cache 使用同一份 require
    const cachePath = path.resolve(__dirname, '../miniprogram/utils/materials-cost-cache.js');
    delete require.cache[cachePath];
    const { bootstrap } = loadFreshBootstrap();
    const cache = require(cachePath);

    // 先塞一条数据
    const plan = { id: 'p1', cabinets: [{ kind: 'standard', w: 50, h: 230, code: 'a' }], wall: { w: 100, h: 240 } };
    const materials = { panel: 'x', doorPanel: 'x', doorCraft: 'x', hardware: 'x', lighting: 'none' };
    cache.set(plan, materials, { grandTotal: 1 });
    assert.equal(cache.get(plan, materials).grandTotal, 1);

    // force=false: 缓存不清
    await bootstrap.ensureCostDataReady();
    assert.equal(cache.get(plan, materials).grandTotal, 1, 'force=false 不清缓存');

    // force=true: 缓存清空
    await bootstrap.ensureCostDataReady({ force: true });
    assert.equal(cache.get(plan, materials), null, 'force=true 应清缓存');
  } finally { delete global.wx; }
});
```

同时更新 `tests/bootstrap.test.js` 顶部的 `modulesToClear` 里追加 materials-cost-cache 的路径, 保证 `loadFreshBootstrap` 也清它:

```js
const modulesToClear = [
  '../miniprogram/utils/bootstrap.js',
  '../miniprogram/utils/price-dict.js',
  '../miniprogram/utils/panel-dict.js',
  '../miniprogram/utils/model-meta-cache.js',
  '../miniprogram/utils/text-desc-dict.js',
  '../miniprogram/utils/materials-cost-cache.js',   // ← 新增
];
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bootstrap.test.js`
Expected: 新用例失败 (`force=true 应清缓存` 断言错), 其余通过

- [ ] **Step 3: 修改 `bootstrap.js`**

编辑 `miniprogram/utils/bootstrap.js`, 在 `require` 块追加, 在 `ensureCostDataReady` 里插入 clearAll:

```js
const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMetaCache = require('./model-meta-cache.js');
const textDescDict = require('./text-desc-dict.js');
const materialsCostCache = require('./materials-cost-cache.js');   // ← 新增

async function ensureCostDataReady(opts) {
  const force = !!(opts && opts.force);
  if (force) materialsCostCache.clearAll();                        // ← 新增
  await Promise.all([
    priceDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] price fail', e)),
    panelDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] panel fail', e)),
    modelMetaCache.preloadAll().catch((e) => console.warn('[bootstrap] meta fail', e)),
  ]);
}
```

其余不变。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test tests/bootstrap.test.js`
Expected: 全部通过 (原 5 用例 + 新 1 用例)

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/bootstrap.js tests/bootstrap.test.js
git commit -m "feat(bootstrap): clear materials-cost-cache on force refresh"
```

---

## Task 5: materials 页接线 — onLoad 读, `_computeCost` 写

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.js`

页面代码没有独立单测, 靠 Task 4 已保证的缓存模块 + 人工验证覆盖 (§7)。

- [ ] **Step 1: 在文件顶部 require 缓存模块**

编辑 `miniprogram/cabinet/pages/materials/index.js`, 在现有 require 块后追加一行:

```js
const costEngine = require('../../../utils/cost-engine.js');
const bootstrap = require('../../../utils/bootstrap.js');
const materialsCostCache = require('../../../utils/materials-cost-cache.js');   // ← 新增
```

- [ ] **Step 2: `onLoad` 里读缓存, 命中即 return**

在 `onLoad` 里, 定位到已有 `this.setData({ plan, from, materials, ... });` 之后、`this._computeCost();` 之前, 插入命中分支。改成:

```js
    this.setData({
      plan,
      from,
      materials,
      cabinetCount: cabinets.length,
      bottomRow,
      topRow,
    });
    // 若同 plan + 同 materials 已算过, 命中缓存直接展示, 跳过 ensureCostDataReady 的 await
    const cached = materialsCostCache.get(plan, materials);
    if (cached) {
      this.setData({ cost: cached, dataReady: true, dataNotice: '' });
      return;
    }
    this._computeCost();
```

- [ ] **Step 3: `_computeCost` 里成功后写缓存**

在 `_computeCost` 里找到 `costEngine.calc({...})` 成功分支:

```js
    try {
      const cost = costEngine.calc({
        cabinets: plan.cabinets || [],
        materials: this.data.materials,
        wall: plan.wall,
      });
      this.setData({ cost, dataReady: true, dataNotice: '' });
      materialsCostCache.set(plan, this.data.materials, cost);    // ← 新增
    } catch (err) {
      console.warn('[materials] _computeCost failed:', err);
      this.setData({ cost: null, dataReady: false, dataNotice: '计算失败，请重试' });
    }
```

catch 分支不写缓存 (错误路径别缓存"没算出来")。

- [ ] **Step 4: 校验语法**

Run: `node --check miniprogram/cabinet/pages/materials/index.js`
Expected: 无输出 (语法通过)

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/pages/materials/index.js
git commit -m "feat(materials): read cache on onLoad, write on _computeCost success"
```

---

## Task 6: cost 页接线 — `_computeCost` 读, 算完后写

**Files:**
- Modify: `miniprogram/cabinet/pages/cost/index.js`

- [ ] **Step 1: 顶部 require 缓存模块**

在 `miniprogram/cabinet/pages/cost/index.js` 现有 `const bootstrap = require('../../../utils/bootstrap.js');` 之后追加一行:

```js
const materialsCostCache = require('../../../utils/materials-cost-cache.js');
```

- [ ] **Step 2: `_computeCost` 里插入读/写**

在 `_computeCost` 里, 定位到 `if (!bootstrap.isAllReady()) { ... return; }` 之后、`const cost = costEngine.calc(...)` 之前, 插入命中缓存分支; 算完后追加写入:

```js
  async _computeCost() {
    await bootstrap.ensureCostDataReady();
    const plan = this._plan;
    if (!bootstrap.isAllReady()) {
      this.setData({
        dataReady: false,
        dataNotice: '价格数据未就绪, 请重试',
        cost: { modules: [], grandTotal: '——' },
      });
      return;
    }
    // 若 materials 页刚算过 (或本页上次算过), 直接命中缓存
    const cached = materialsCostCache.get(plan, plan.materials || {});
    if (cached) {
      this.setData({ dataReady: true, dataNotice: '', cost: cached });
      return;
    }
    const cost = costEngine.calc({
      cabinets: plan.cabinets || [],
      materials: plan.materials || {},
      wall: plan.wall,
    });
    this.setData({ dataReady: true, dataNotice: '', cost });
    materialsCostCache.set(plan, plan.materials || {}, cost);   // ← 新增: 深链进 cost 页时也落缓存
  },
```

注: cost 页的 catch 语义原来就没有 (cost 页现有 `_computeCost` 直接调用 `costEngine.calc` 而无 try/catch, 与 materials 页不同, 是设计如此 — 见 spec 上一次 §6.2 引用)。这里保持一致, 不加 try/catch。

- [ ] **Step 3: 校验语法**

Run: `node --check miniprogram/cabinet/pages/cost/index.js`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add miniprogram/cabinet/pages/cost/index.js
git commit -m "feat(cost): read cache in _computeCost, write on compute success"
```

---

## Task 7: 全量回归 + 手工验证清单

**Files:** 无改动, 只跑测试和手测。

- [ ] **Step 1: 全部 node --test 跑一遍**

Run: `node --test tests/`
Expected: 全绿。重点关注:
- `tests/materials-cost-cache.test.js` — 新模块
- `tests/bootstrap.test.js` — 新用例 + 原 5 用例
- `tests/cost-engine.test.js` / `cost-engine.category-cost.test.js` — 未破坏原有 cost 计算

- [ ] **Step 2: 微信开发者工具手工验证 (小程序模拟器)**

按顺序验证 spec §8:

1. **materials 命中缓存**: materials 页选一套配置 (随便点几张卡牌) → 点"立即算价"进 cost 页 → 点"更换配置"回到 materials → cost 应**立即**显示 (无 "价格数据未就绪 / 计算中" 抖动)。
2. **重新选择即时重算**: 上一步之后, 在 materials 页再点一张卡牌 → cost 立即变化 → 再往返一次 → 新 cost 命中缓存。
3. **force 清缓存**: 在 cost 页触发"重试" (`onRetryDataFetch`, 调用 `ensureCostDataReady({force:true})`) → 返回 materials 页 → 应重算 (缓存被清)。
4. **深链落缓存**: 直接从方案列表进 cost 页 (`from=list`) → 显示正常 → 点"更换配置"进 materials 页 → 应立即命中缓存 (cost 页写入的那份)。

- [ ] **Step 3: 若手测全部通过, 无需再 commit** (代码已在前几个 commit 里)。

---

## 完成标准

- `node --test tests/materials-cost-cache.test.js` 全绿 (15 用例)
- `node --test tests/bootstrap.test.js` 全绿 (原 5 + 新 1)
- 手工验证清单 4 条全部通过
- 无回归: `node --test tests/` 全绿
