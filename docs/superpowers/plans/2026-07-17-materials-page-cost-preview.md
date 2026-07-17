# 板材五金选择页 · 费用预览改造 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在板材五金选择页加入实时费用预览：顶部吸顶显示总成本 + 4 项分项费用；每组分类右上角显示该分类费用与占总价比例；点选任一选项即时刷新。

**Architecture:** `cost-engine.calc()` 追加 `categoryCost` 字段（不 break 现有下游）；`materials/index` 页在 `_pick` 后同步调用 `costEngine.calc` 重算并 `setData` 到吸顶预览区与每组右上角费用条。所有金额与占比数据源单一，均来自 `cost-engine.calc()` 一次调用。

**Tech Stack:** 微信小程序（WXML/WXSS/JS）；`node:test`（node 内建）+ `node:assert/strict` 做单元测试；无新依赖。

**Spec:** `docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|---|---|---|
| `miniprogram/utils/cost-engine.js` | 修改 | `calc()` 追加 `categoryCost` 5 键返回 |
| `miniprogram/cabinet/pages/materials/index.js` | 修改 | 新增 `_computeCost` / `onRetryDataFetch`；`data.cost/dataReady/dataNotice`；`_pick` 后触发重算 |
| `miniprogram/cabinet/pages/materials/index.wxml` | 修改 | 新增 `.cost-preview` 吸顶块；每组 `.section` 头改成 `.section-head` flex，右侧塞 `.cat-cost` |
| `miniprogram/cabinet/pages/materials/index.wxss` | 修改 | 新增预览/占位/头部 flex 样式 |
| `tests/cost-engine.category-cost.test.js` | 新增 | 验证 `categoryCost` 定义与恒等性质 |

---

## Task 1: 给 `cost-engine.calc()` 加 `categoryCost` 字段（TDD）

**Files:**
- Test: `tests/cost-engine.category-cost.test.js` (create)
- Modify: `miniprogram/utils/cost-engine.js:225-274`

---

- [ ] **Step 1.1: 写失败测试 · category-cost 基本结构 + case A（最低配）**

创建 `tests/cost-engine.category-cost.test.js`：

```js
// 验证 cost-engine.calc() 追加的 categoryCost 字段。
// 复用与 cost-engine.test.js 相同的 fixture 装配 (require.cache 清 + preloadAll force)。
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
  modules.forEach((rel) => { delete require.cache[path.resolve(__dirname, rel)]; });
  return {
    costEngine: require(path.resolve(__dirname, '../miniprogram/utils/cost-engine.js')),
    priceDict: require(path.resolve(__dirname, '../miniprogram/utils/price-dict.js')),
    panelDict: require(path.resolve(__dirname, '../miniprogram/utils/panel-dict.js')),
    modelMeta: require(path.resolve(__dirname, '../miniprogram/utils/model-meta-cache.js')),
  };
}

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

// —— fixture 与 cost-engine.test.js 保持一致的最小子集 —— //
const PRICES = [
  { code: 'panel_egger', name: '爱格', price: 195, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'panel_e2_domestic', name: 'E2', price: 70, category: 'panel', unit: '㎡', brand_type: null },
  { code: 'door_material_same_as_cabinet', name: '同柜体', price: 0, category: 'door_material', unit: '㎡', brand_type: null },
  { code: 'door_material_piano_lacquer', name: '钢琴烤漆', price: 200, category: 'door_material', unit: '㎡', brand_type: null },
  { code: 'door_craft_none', name: '无', price: 0, category: 'door_craft', unit: '㎡', brand_type: null },
  { code: 'door_craft_european_deep', name: '欧式', price: 80, category: 'door_craft', unit: '㎡', brand_type: null },
  { code: 'transport_fee', name: '运费', price: 15, category: 'transport', unit: '㎡', brand_type: null },
  { code: 'install_fee', name: '安装费', price: 20, category: 'install', unit: '㎡', brand_type: null },
  { code: 'hinge_domestic', name: 'DTC铰链', price: 6.2, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'hinge_import', name: '百隆铰链', price: 27, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'hanging_rail_domestic', name: '衣通', price: 40, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'hanging_rail_import', name: '衣通', price: 60, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'minifix_domestic', name: '三合一', price: 0.2, category: 'hardware', unit: '套', brand_type: 'domestic' },
  { code: 'minifix_import', name: '三合一', price: 0.8, category: 'hardware', unit: '套', brand_type: 'import' },
  { code: 'countersunk_screw_domestic', name: '沉头', price: 0.5, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'countersunk_screw_import', name: '沉头', price: 0.6, category: 'hardware', unit: '颗', brand_type: 'import' },
  { code: 'wood_dowel_domestic', name: '木销', price: 0.1, category: 'hardware', unit: '根', brand_type: 'domestic' },
  { code: 'wood_dowel_import', name: '木销', price: 0.1, category: 'hardware', unit: '根', brand_type: 'import' },
  { code: 'push_latch_domestic', name: '反弹器', price: 2.2, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'push_latch_import', name: '反弹器', price: 22, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'self_tapping_screw_16_domestic', name: 'M4x16', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'self_tapping_screw_16_import', name: 'M4x16', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'import' },
  { code: 'plinth_domestic', name: '基座', price: 9.95, category: 'hardware', unit: '只', brand_type: 'domestic' },
  { code: 'plinth_import', name: '基座', price: 9.95, category: 'hardware', unit: '只', brand_type: 'import' },
  { code: 'nylon_pre_inserted_nut_domestic', name: '尼龙螺丝', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'domestic' },
  { code: 'nylon_pre_inserted_nut_import', name: '尼龙螺丝', price: 0.05, category: 'hardware', unit: '颗', brand_type: 'import' },
  { code: 'dust_strip_domestic', name: '防尘条', price: 0.5, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'dust_strip_import', name: '防尘条', price: 0.5, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'liquid_nails_domestic', name: '免钉胶', price: 15.9, category: 'hardware', unit: '支', brand_type: 'domestic' },
  { code: 'liquid_nails_import', name: '免钉胶', price: 15.9, category: 'hardware', unit: '支', brand_type: 'import' },
  { code: 'access_panel_handle_domestic', name: '拉手', price: 7.76, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'access_panel_handle_import', name: '拉手', price: 7.76, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'cable_channel_domestic', name: '线槽', price: 2, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'cable_channel_import', name: '线槽', price: 2, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'led_light_strip_domestic', name: '国产LED', price: 19.4, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'led_light_power_domestic', name: '国产电源', price: 85, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_switch_domestic', name: '国产开关', price: 47, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_strip_import', name: '进口LED', price: 40, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'led_light_power_import', name: '进口电源', price: 200, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'led_light_switch_import', name: '进口开关', price: 49.39, category: 'hardware', unit: '个', brand_type: 'import' },
];

const PANELS = [
  { panel_code: 'side_left_panel_18', display_name: '左侧板', category: 'cabinet_frame', enable: true },
  { panel_code: 'side_right_panel_18', display_name: '右侧板', category: 'cabinet_frame', enable: true },
  { panel_code: 'top_panel_18', display_name: '顶板', category: 'cabinet_frame', enable: true },
  { panel_code: 'bottom_panel_18', display_name: '底板', category: 'cabinet_frame', enable: true },
  { panel_code: 'back_panel_18', display_name: '背板', category: 'cabinet_frame', enable: true },
  { panel_code: 'kick_front_18', display_name: '踢脚', category: 'kick_component', enable: true },
  { panel_code: 'door_single_18', display_name: '门板', category: 'door_panel', enable: true },
  { panel_code: 'door_left_18', display_name: '左门板', category: 'door_panel', enable: true },
  { panel_code: 'door_right_18', display_name: '右门板', category: 'door_panel', enable: true },
];

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
  ],
  door_list: [
    { node_name: 'door_left_18', length: 223.6, width: 49.7, thickness: 1.8, area: 1.1135 },
    { node_name: 'door_right_18', length: 223.6, width: 49.7, thickness: 1.8, area: 1.1135 },
  ],
  total_body_area: 5.8963,
  total_door_area: 2.227,
  total_raw_board_area: 8.1233,
  hardware_list: {
    hinge: 8, hanging_rail: 1, minifix: 12,
    countersunk_screw: 40, wood_dowel: 20, push_latch: 2,
    self_tapping_screw_16: 24,
    plinth: 4, nylon_pre_inserted_nut: 30,
    dust_strip: 1, liquid_nails: 1, access_panel_handle: 2,
    cable_channel: 1, led_light_strip: 2.2, led_light_power: 1, led_light_switch: 1,
  },
};

async function primeDicts(byCollection) {
  global.wx = makeWx(byCollection);
  const modules = loadFresh();
  await modules.priceDict.preloadAll({ force: true });
  await modules.panelDict.preloadAll({ force: true });
  await modules.modelMeta.preloadAll();
  return modules;
}

function _round2(v) { return Math.round(v * 100) / 100; }

test('categoryCost 存在且键完整（最低配 → 3 项为 0）', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS, model_panel_hardware: [META_100A],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [{ kind: 'standard', code: 'a', w: 100, h: 230, label: '100A' }],
      materials: {
        panel: 'panel_e2_domestic',
        doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none',
        hardware: 'domestic',
        lighting: 'none',
      },
      wall: null,
    });
    assert.ok(cost.categoryCost, 'categoryCost 字段存在');
    const keys = Object.keys(cost.categoryCost).sort();
    assert.deepEqual(keys, ['doorCraft', 'doorPanel', 'hardware', 'lighting', 'panel']);
    // 最低配 3 项恰好为 0
    assert.equal(cost.categoryCost.doorPanel, 0, '门板材质=同柜体 → 0');
    assert.equal(cost.categoryCost.doorCraft, 0, '门板工艺=无 → 0');
    assert.equal(cost.categoryCost.lighting, 0, '照明=无 → 0');
    // 板材 + 五金 > 0
    assert.ok(cost.categoryCost.panel > 0, 'panel > 0');
    assert.ok(cost.categoryCost.hardware > 0, 'hardware > 0');
  } finally { delete global.wx; }
});
```

- [ ] **Step 1.2: 运行测试确认失败**

Run: `npx --yes node --test tests/cost-engine.category-cost.test.js`
Expected: FAIL — `cost.categoryCost` 字段不存在（`assert.ok(cost.categoryCost, ...)` 抛错）

- [ ] **Step 1.3: 修改 `cost-engine.js` 追加 `categoryCost` 字段**

Modify `miniprogram/utils/cost-engine.js`：

在文件顶部 `LED_KEYS` 常量下方（约第 22 行下）加一行导出（复用即可，无需新增）。

替换 `calc({ cabinets, materials, wall })` 函数（当前第 226-274 行）为：

```js
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

  modules.forEach((m) => {
    if (m.missing) { m.transport = 0; m.install = 0; m.total = 0; return; }
    m.transport = round2(m.totalRawBoardArea * transportUnit);
    m.install = round2(m.totalRawBoardArea * installUnit);
    m.total = round2(m.panelCost + m.hardwareCost + m.transport + m.install);
  });

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

  // —— categoryCost: 按 5 组材料选项归属 —— //
  // 定义见 docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §3.1
  //  panel     = Σ (bodyArea + doorArea) × panelUnit           (含柜身板 + 门板基材)
  //  doorPanel = Σ doorArea × doorMatUnit                      (门板材质加价)
  //  doorCraft = Σ doorArea × doorCraftUnit                    (门板工艺加价)
  //  hardware  = Σ 非 LED 五金 total                            (直接从 detail 求和)
  //  lighting  = Σ LED 三项 total                               (lighting=none → 0)
  // sk 不计入任一 category (口径见 spec §3.1)。
  const panelEntry = priceDict.get(cfg.panel);
  const doorMatEntry = priceDict.get(cfg.doorPanel);
  const doorCraftEntry = priceDict.get(cfg.doorCraft);
  const panelUnit = panelEntry ? panelEntry.price : 0;
  const doorMatUnit = doorMatEntry ? doorMatEntry.price : 0;
  const doorCraftUnit = doorCraftEntry ? doorCraftEntry.price : 0;

  const sumBodyArea = modules.reduce((s, m) => s + (m.totalBodyArea || 0), 0);
  const sumDoorArea = modules.reduce((s, m) => s + (m.totalDoorArea || 0), 0);
  let hwCatSum = 0;
  let ledCatSum = 0;
  modules.forEach((m) => {
    const hw = (m.detail && m.detail.hardware) || [];
    hw.forEach((row) => {
      // row.code 形如 `${key}_${brand_type}`; 取前缀判断是否 LED 三项
      const isLed = LED_KEYS.some((k) => row.code === `${k}_domestic` || row.code === `${k}_import`);
      if (isLed) ledCatSum += row.total || 0;
      else hwCatSum += row.total || 0;
    });
  });

  const categoryCost = {
    panel: round2((sumBodyArea + sumDoorArea) * panelUnit),
    doorPanel: round2(sumDoorArea * doorMatUnit),
    doorCraft: round2(sumDoorArea * doorCraftUnit),
    hardware: round2(hwCatSum),
    lighting: round2(ledCatSum),
  };

  return {
    modules,
    sk,
    transport, install,
    panelTotal: round2(sumPanel),
    hardwareTotal: round2(sumHw),
    grandTotal,
    categoryCost,
  };
}
```

- [ ] **Step 1.4: 运行测试确认通过**

Run: `npx --yes node --test tests/cost-engine.category-cost.test.js`
Expected: PASS (1 test)

- [ ] **Step 1.5: 加恒等性质测试（case C）**

在 `tests/cost-engine.category-cost.test.js` 追加：

```js
test('恒等: panel+doorPanel+doorCraft ≈ Σ panelCost;  hardware+lighting ≈ Σ hardwareCost（全高配）', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS, model_panel_hardware: [META_100A],
  });
  try {
    const cost = costEngine.calc({
      cabinets: [
        { kind: 'standard', code: 'a', w: 100, h: 230, label: '100A' },
        { kind: 'standard', code: 'a', w: 100, h: 230, label: '100A' },
      ],
      materials: {
        panel: 'panel_egger',
        doorPanel: 'door_material_piano_lacquer',
        doorCraft: 'door_craft_european_deep',
        hardware: 'import',
        lighting: 'led_import',
      },
      wall: null,
    });
    const sumPanelCost = cost.modules.reduce((s, m) => s + (m.panelCost || 0), 0);
    const sumHwCost = cost.modules.reduce((s, m) => s + (m.hardwareCost || 0), 0);
    const catSumPanels = cost.categoryCost.panel + cost.categoryCost.doorPanel + cost.categoryCost.doorCraft;
    const catSumHw = cost.categoryCost.hardware + cost.categoryCost.lighting;

    assert.ok(Math.abs(catSumPanels - sumPanelCost) < 1,
      `板材类合计 ${catSumPanels} 应 ≈ Σ panelCost ${sumPanelCost}`);
    assert.ok(Math.abs(catSumHw - sumHwCost) < 1,
      `五金类合计 ${catSumHw} 应 ≈ Σ hardwareCost ${sumHwCost}`);
    // 全高配下 5 项都 > 0
    assert.ok(cost.categoryCost.panel > 0);
    assert.ok(cost.categoryCost.doorPanel > 0);
    assert.ok(cost.categoryCost.doorCraft > 0);
    assert.ok(cost.categoryCost.hardware > 0);
    assert.ok(cost.categoryCost.lighting > 0);
  } finally { delete global.wx; }
});
```

- [ ] **Step 1.6: 运行测试确认通过**

Run: `npx --yes node --test tests/cost-engine.category-cost.test.js`
Expected: PASS (2 tests)

- [ ] **Step 1.7: 加 case D · hardware 品牌切换**

追加到同一测试文件：

```js
test('hardware=import 时 categoryCost.hardware 严格大于 domestic 版本', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS, model_panel_hardware: [META_100A],
  });
  try {
    const base = {
      cabinets: [{ kind: 'standard', code: 'a', w: 100, h: 230, label: '100A' }],
      materials: {
        panel: 'panel_e2_domestic',
        doorPanel: 'door_material_same_as_cabinet',
        doorCraft: 'door_craft_none',
        hardware: 'domestic',
        lighting: 'none',
      },
      wall: null,
    };
    const dom = costEngine.calc(base);
    const imp = costEngine.calc({ ...base, materials: { ...base.materials, hardware: 'import' } });
    assert.ok(imp.categoryCost.hardware > dom.categoryCost.hardware,
      `import ${imp.categoryCost.hardware} 应 > domestic ${dom.categoryCost.hardware}`);
  } finally { delete global.wx; }
});
```

- [ ] **Step 1.8: 运行全测试文件确认通过**

Run: `npx --yes node --test tests/cost-engine.category-cost.test.js`
Expected: PASS (3 tests)

- [ ] **Step 1.9: 回归 · 跑现有 cost-engine 测试**

Run: `npx --yes node --test tests/cost-engine.test.js`
Expected: 现有全部 PASS（追加字段不 break 现有断言）

- [ ] **Step 1.10: 提交**

```bash
git add tests/cost-engine.category-cost.test.js miniprogram/utils/cost-engine.js
git commit -m "feat(cost-engine): calc() 追加 categoryCost 5 键返回

- panel/doorPanel/doorCraft/hardware/lighting 分别对应 5 组材料选项
- 定义: panel 含柜身板+门板基材两处 panelUnit
- 恒等: category 板材类 ≈ Σ modules.panelCost, 五金类 ≈ Σ hardwareCost
- 新增 3 个 case; 现有 cost-engine.test.js 无回归

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §3.1"
```

---

## Task 2: `materials` 页面加实时费用计算逻辑

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.js`

---

- [ ] **Step 2.1: `data` 追加 3 个字段**

Modify `miniprogram/cabinet/pages/materials/index.js` 第 12-24 行的 `data`：

```js
Page({
  data: {
    plan: null,
    from: 'design', // design | list
    materials: Object.assign({}, DEFAULT_MATERIALS),
    panelOpts: PANEL_OPTIONS,
    doorPanelOpts: DOOR_PANEL_OPTIONS,
    doorCraftOpts: DOOR_CRAFT_OPTIONS,
    hardwareOpts: HARDWARE_OPTIONS,
    lightingOpts: LIGHTING_OPTIONS,
    cabinetCount: 0,
    bottomRow: [],
    topRow: [],
    // —— 费用预览 —— //
    cost: null,           // { grandTotal, panelTotal, hardwareTotal, transport, install, categoryCost }
    dataReady: true,      // 价格字典是否就绪
    dataNotice: '',       // 未就绪时的提示文案
  },
```

- [ ] **Step 2.2: `require` 顶部追加两个依赖**

Modify `miniprogram/cabinet/pages/materials/index.js` 顶部（第 1-9 行下方追加）：

```js
const {
  PANEL_OPTIONS,
  DOOR_PANEL_OPTIONS,
  DOOR_CRAFT_OPTIONS,
  HARDWARE_OPTIONS,
  LIGHTING_OPTIONS,
  DEFAULT_MATERIALS,
} = require('../../../utils/materials-options.js');
const costEngine = require('../../../utils/cost-engine.js');
const bootstrap = require('../../../utils/bootstrap.js');
```

- [ ] **Step 2.3: `onLoad` 结尾触发首次计算**

Modify `miniprogram/cabinet/pages/materials/index.js` 的 `onLoad`（第 26-51 行），在 `setData({...})` 之后追加一行：

```js
    this.setData({
      plan,
      from,
      materials,
      // 加高模块也算"一个柜子"
      cabinetCount: cabinets.length,
      bottomRow,
      topRow,
    });
    this._computeCost();
  },
```

- [ ] **Step 2.4: `_pick` 内触发重算**

Modify `miniprogram/cabinet/pages/materials/index.js` 的 `_pick` 方法（第 68-71 行）：

```js
  _pick(key, id) {
    const m = Object.assign({}, this.data.materials, { [key]: id });
    this.setData({ materials: m });
    this._computeCost();
  },
```

- [ ] **Step 2.5: 新增 `_computeCost` 与 `onRetryDataFetch`**

Modify `miniprogram/cabinet/pages/materials/index.js`，在 `onCalc` 方法（约第 73 行）之前插入：

```js
  async _computeCost() {
    await bootstrap.ensureCostDataReady();
    const plan = this.data.plan;
    if (!plan) return;
    if (!bootstrap.isAllReady()) {
      this.setData({
        cost: null,
        dataReady: false,
        dataNotice: '价格数据未就绪，请重试',
      });
      return;
    }
    try {
      const cost = costEngine.calc({
        cabinets: plan.cabinets || [],
        materials: this.data.materials,
        wall: plan.wall,
      });
      this.setData({ cost, dataReady: true, dataNotice: '' });
    } catch (err) {
      console.warn('[materials] _computeCost failed:', err);
      this.setData({ cost: null, dataReady: false, dataNotice: '计算失败，请重试' });
    }
  },

  onRetryDataFetch() {
    this.setData({ dataNotice: '正在重试…' });
    bootstrap.ensureCostDataReady({ force: true }).then(() => this._computeCost());
  },
```

- [ ] **Step 2.6: 手动模拟运行 · 语法验证**

Run: `node -e "require('./miniprogram/cabinet/pages/materials/index.js')"`
Expected: `Page is not defined` 报错 —— 这是预期的（Page 是小程序运行时全局），说明语法通过、模块能被解析。若报语法错误则修复。

- [ ] **Step 2.7: 提交**

```bash
git add miniprogram/cabinet/pages/materials/index.js
git commit -m "feat(materials-page): 加实时费用计算逻辑

- data 追加 cost/dataReady/dataNotice
- onLoad 后 + 每次 _pick 触发 _computeCost
- 复用 cost-engine.calc / bootstrap.ensureCostDataReady, 与 cost 页面口径一致
- 字典未就绪显示提示 + 重试

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §3, §6.1"
```

---

## Task 3: `materials` 页面 WXML 加吸顶费用预览

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.wxml`

---

- [ ] **Step 3.1: 在 `.space-info` 之后插入 `.cost-preview`**

Modify `miniprogram/cabinet/pages/materials/index.wxml`，第 16 行（`</view>` of `.space-info`）之后、第 18 行（第一个 `.section`）之前插入：

```xml
  <view class="cost-preview">
    <view class="cp-grand">
      <text class="cp-grand-lbl">总成本</text>
      <text class="cp-grand-val">¥ {{dataReady ? cost.grandTotal : '——'}}</text>
    </view>
    <view class="cp-row">
      <view class="cp-item">
        <text class="cp-item-lbl">板材合计</text>
        <text class="cp-item-val">¥ {{dataReady ? cost.panelTotal : '——'}}</text>
      </view>
      <view class="cp-item">
        <text class="cp-item-lbl">运输费用</text>
        <text class="cp-item-val">¥ {{dataReady ? cost.transport : '——'}}</text>
      </view>
    </view>
    <view class="cp-row">
      <view class="cp-item">
        <text class="cp-item-lbl">五金配件</text>
        <text class="cp-item-val">¥ {{dataReady ? cost.hardwareTotal : '——'}}</text>
      </view>
      <view class="cp-item">
        <text class="cp-item-lbl">安装费用</text>
        <text class="cp-item-val">¥ {{dataReady ? cost.install : '——'}}</text>
      </view>
    </view>
    <view class="cp-notice" wx:if="{{dataNotice}}">
      <text>{{dataNotice}}</text>
      <text class="cp-retry" bindtap="onRetryDataFetch">重试</text>
    </view>
  </view>
```

- [ ] **Step 3.2: 5 组 `.section` 头部改为 flex + 右上角费用条**

WXML 里 5 个 `.section` 各有 `<view class="title">…</view><view class="sub">…</view>` 组合，需把 `.title` 包一层 `.section-head`（flex 布局）并塞入右侧 `.cat-cost`。

**衣柜板材品牌（第 18-30 行）**改为：

```xml
  <view class="section">
    <view class="section-head">
      <view class="title">衣柜板材品牌</view>
      <view class="cat-cost" wx:if="{{dataReady && cost}}">
        <text class="cat-cost-fee">费用 ¥ {{cost.categoryCost.panel}}</text>
        <text class="cat-cost-pct">占 {{cost.grandTotal > 0 ? ((cost.categoryCost.panel / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%</text>
      </view>
    </view>
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
  </view>
```

> **注意** 小程序 WXML 表达式支持 `toFixed`（真机 WXML 表达式引擎支持），若模拟器不支持要用 WXS。见 Step 3.7。

**门板材质（第 32-44 行）**：把 `.title` 一样包成 `.section-head`，`.cat-cost` 里的 key 换成 `doorPanel`。

```xml
  <view class="section">
    <view class="section-head">
      <view class="title">门板材质</view>
      <view class="cat-cost" wx:if="{{dataReady && cost}}">
        <text class="cat-cost-fee">费用 ¥ {{cost.categoryCost.doorPanel}}</text>
        <text class="cat-cost-pct">占 {{cost.grandTotal > 0 ? ((cost.categoryCost.doorPanel / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%</text>
      </view>
    </view>
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
  </view>
```

**门板工艺（第 46-57 行）**：key = `doorCraft`。

```xml
  <view class="section">
    <view class="section-head">
      <view class="title">门板工艺</view>
      <view class="cat-cost" wx:if="{{dataReady && cost}}">
        <text class="cat-cost-fee">费用 ¥ {{cost.categoryCost.doorCraft}}</text>
        <text class="cat-cost-pct">占 {{cost.grandTotal > 0 ? ((cost.categoryCost.doorCraft / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%</text>
      </view>
    </view>
    <view class="sub">门板造型工艺（加价项）</view>
    <view class="opts row-4">
      <view class="opt {{materials.doorCraft === item.id ? 'active' : ''}}"
            wx:for="{{doorCraftOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickDoorCraft">
        <view class="opt-name">{{item.name}}</view>
      </view>
    </view>
  </view>
```

**五金品牌（第 59-71 行）**：key = `hardware`。

```xml
  <view class="section">
    <view class="section-head">
      <view class="title">五金品牌</view>
      <view class="cat-cost" wx:if="{{dataReady && cost}}">
        <text class="cat-cost-fee">费用 ¥ {{cost.categoryCost.hardware}}</text>
        <text class="cat-cost-pct">占 {{cost.grandTotal > 0 ? ((cost.categoryCost.hardware / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%</text>
      </view>
    </view>
    <view class="sub">铰链、滑轨等五金件品牌</view>
    <view class="opts row-2">
      <view class="opt {{materials.hardware === item.id ? 'active' : ''}}"
            wx:for="{{hardwareOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickHardware">
        <view class="opt-name">{{item.name}}</view>
        <view class="opt-desc">{{item.desc}}</view>
      </view>
    </view>
  </view>
```

**照明系统（第 73-85 行）**：key = `lighting`。

```xml
  <view class="section">
    <view class="section-head">
      <view class="title">照明系统</view>
      <view class="cat-cost" wx:if="{{dataReady && cost}}">
        <text class="cat-cost-fee">费用 ¥ {{cost.categoryCost.lighting}}</text>
        <text class="cat-cost-pct">占 {{cost.grandTotal > 0 ? ((cost.categoryCost.lighting / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%</text>
      </view>
    </view>
    <view class="sub">柜体灯光配置</view>
    <view class="opts row-3">
      <view class="opt {{materials.lighting === item.id ? 'active' : ''}}"
            wx:for="{{lightingOpts}}" wx:key="id"
            data-id="{{item.id}}"
            bindtap="pickLighting">
        <view class="opt-name">{{item.name}}</view>
        <view class="opt-desc">{{item.desc}}</view>
      </view>
    </view>
  </view>
```

- [ ] **Step 3.3: 提交**

```bash
git add miniprogram/cabinet/pages/materials/index.wxml
git commit -m "feat(materials-page): WXML 加吸顶费用预览与分类右上角费用条

- .cost-preview 占 3 行 (总成本 / 板材+运输 / 五金+安装)
- 5 组 .section 头部改 .section-head flex, 右上角 .cat-cost 显示费用 + 占比
- dataReady=false 时金额显示 '——', 隐藏分类费用条
- 未就绪显示 dataNotice + 重试

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §4"
```

---

## Task 4: `materials` 页面 WXSS 加吸顶与右上角费用条样式

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.wxss`

---

- [ ] **Step 4.1: `.section` 头部与 `.cost-preview` 样式追加**

Modify `miniprogram/cabinet/pages/materials/index.wxss`，在文件末尾追加：

```css
/* —— 费用预览 (吸顶) —— */
.cost-preview {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(30px);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  padding: 20rpx 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}

.cp-grand {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 12rpx;
  border-bottom: 2rpx solid rgba(0,0,0,0.06);
}

.cp-grand-lbl {
  font-size: 28rpx;
  color: #1f2937;
  font-weight: 600;
}

.cp-grand-val {
  font-size: 40rpx;
  color: #1f2937;
  font-weight: 700;
}

.cp-row {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
  gap: 24rpx;
}

.cp-item {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.cp-item-lbl {
  font-size: 24rpx;
  color: #6b7280;
}

.cp-item-val {
  font-size: 26rpx;
  color: #1f2937;
  font-weight: 500;
}

.cp-notice {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #b45309;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.cp-retry {
  color: #EE822F;
  font-weight: 600;
}

/* —— 分类头部 flex —— */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.cat-cost {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2rpx;
}

.cat-cost-fee {
  font-size: 22rpx;
  color: #1f2937;
  font-weight: 500;
}

.cat-cost-pct {
  font-size: 20rpx;
  color: #6b7280;
}
```

- [ ] **Step 4.2: 提交**

```bash
git add miniprogram/cabinet/pages/materials/index.wxss
git commit -m "feat(materials-page): 加吸顶费用预览与分类费用条样式

- .cost-preview: sticky top, 半透白 + blur, 3 行布局
- .section-head: flex 布局, 支持右上角挂 .cat-cost
- .cat-cost: 竖排 费用 + 占比 靠右

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §4"
```

---

## Task 5: WXML 表达式引擎兼容性 · WXS 兜底（若必要）

WXML `{{}}` 表达式历史上不支持对表达式结果链式调用方法（如 `.toFixed()`），行为随小程序基础库版本变化。为保险，把占比计算下沉到 WXS。

**Files:**
- Modify: `miniprogram/cabinet/pages/materials/index.wxml`
- Create: `miniprogram/cabinet/pages/materials/index.wxs` (或复用现有 `utils/assets.wxs` 旁边加一个)

---

- [ ] **Step 5.1: 新建 `format.wxs`**

Create `miniprogram/cabinet/pages/materials/format.wxs`：

```js
// materials 页格式化辅助. WXML 表达式对 toFixed 支持有历史坑, 下沉到 wxs 里更稳。
function percent(val, total) {
  if (!total || total <= 0) return '0.0';
  var p = (val / total) * 100;
  // toFixed 在 wxs 里可用 (基础库 2.4.0+)
  return p.toFixed(1);
}

module.exports = { percent: percent };
```

- [ ] **Step 5.2: WXML 引入并替换 5 个占比表达式**

Modify `miniprogram/cabinet/pages/materials/index.wxml`，顶部第 1 行下追加：

```xml
<wxs src="./format.wxs" module="fmt" />
```

将 5 处 `占 {{cost.grandTotal > 0 ? ((cost.categoryCost.X / cost.grandTotal * 100).toFixed(1)) : '0.0'}}%` 替换为：

```xml
占 {{fmt.percent(cost.categoryCost.panel, cost.grandTotal)}}%
```

（对应 5 个 key: `panel / doorPanel / doorCraft / hardware / lighting` 各改一处）

- [ ] **Step 5.3: 手动检查 WXML 语法**

Run: `grep -c 'fmt.percent' miniprogram/cabinet/pages/materials/index.wxml`
Expected: `5`

- [ ] **Step 5.4: 提交**

```bash
git add miniprogram/cabinet/pages/materials/format.wxs miniprogram/cabinet/pages/materials/index.wxml
git commit -m "fix(materials-page): 分类占比表达式下沉到 WXS 兜底

- 新增 format.wxs: percent(val, total) 返回 1 位小数字符串
- 5 处 .cat-cost 占比表达式改用 fmt.percent, 避免 WXML {{}} 里 toFixed 的历史坑
- grandTotal<=0 时返回 '0.0', 避免除零

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §6.3"
```

---

## Task 6: 手动验收清单执行

**Files:** N/A — 在微信开发者工具里操作

参考 spec §7.2 手动验收清单。

---

- [ ] **Step 6.1: 走查清单**

打开微信开发者工具，进入板材五金选择页，按 spec §7.2 清单逐项手动验证：

1. [ ] 进入页面看到费用预览，默认最低配置下总成本 = 板材+运输+五金+安装（≈ 4 项之和）
2. [ ] 切换任一组选项：总成本 + 板材合计/五金配件/运输/安装 + 对应分类右上角费用条 都实时刷新
3. [ ] 页面下滑，费用预览吸顶（"空间衣柜布置预览"和空间信息卡随滑动隐藏）
4. [ ] 选照明系统 = 无 → 照明右上角显示 `¥ 0.00 / 0.0%`（值为 0 时不隐藏）
5. [ ] 门板材质选"与柜体相同" → 门板材质右上角显示 `¥ 0.00 / 0.0%`
6. [ ] 强制清空 price-dict 本地缓存（在开发者工具 Storage 面板删掉相关 key）后进入页面：所有金额显示 `——`、提示"价格数据未就绪"、有重试链接；点重试成功后恢复
7. [ ] 点"计算成本"跳转到 cost 页，看到相同的 grandTotal（口径一致性回归）

- [ ] **Step 6.2: 若发现 Bug，修复并补充测试**

对每个未通过项，用 systematic-debugging 流程定位根因，修回上述 Task 中对应文件，追加针对性单元/集成测试。

- [ ] **Step 6.3: 手动验收全部通过后，创建 verification commit**

```bash
git commit --allow-empty -m "chore(materials-page): 手动验收清单全部通过

Ref: docs/superpowers/specs/2026-07-17-materials-page-cost-preview-design.md §7.2"
```

---

## Self-Review

**1. 规格覆盖：**

| 规格章节 | 落地 Task |
|---|---|
| §3 架构与数据流 | Task 2 |
| §3.1 categoryCost 5 键定义 | Task 1 |
| §4.1 吸顶费用预览 | Task 3.1, Task 4.1 |
| §4.2 分类右上角费用条 | Task 3.2, Task 4.1, Task 5 |
| §5 文件改动清单 | 全 5 Task |
| §6.1 首屏字典未就绪 | Task 2.5, Task 3.1 |
| §6.2 就绪后切换选项 | Task 2.4 |
| §6.3 grandTotal=0 | Task 5.1 (`percent` 里判 0) |
| §6.4 lighting=none | Task 1.1 (test case A) |
| §7.1 单元测试 | Task 1 |
| §7.2 手动验收清单 | Task 6 |

**2. 占位符扫描：** 无 TBD/TODO/占位；所有代码块都是可直接粘贴的完整片段。

**3. 类型/命名一致性：**
- `categoryCost` 5 键 `panel / doorPanel / doorCraft / hardware / lighting` — 全 plan 一致
- `cost.grandTotal / cost.panelTotal / cost.transport / cost.hardwareTotal / cost.install / cost.categoryCost` — WXML 绑定 + engine 返回一致
- `dataReady / dataNotice / _computeCost / onRetryDataFetch` — spec 与 plan 一致
- `fmt.percent(val, total)` — 5 处调用签名一致
