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
    assert.ok(cost.categoryCost.panel > 0, 'panel > 0');
    assert.ok(cost.categoryCost.doorPanel > 0);
    assert.ok(cost.categoryCost.doorCraft > 0);
    assert.ok(cost.categoryCost.hardware > 0);
    assert.ok(cost.categoryCost.lighting > 0);
  } finally { delete global.wx; }
});

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
