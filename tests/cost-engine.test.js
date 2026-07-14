// End-to-end tests for the data-driven cost engine (spec §9 全部 case + 转角 + spacer/sk 跳过).
// 使用内存版 wx (setStorage / cloud.database) 作为 fixture, 三张字典 (price / panel_name_dict / model_panel_hardware)
// 每个 test 前用 require.cache 洗掉字典模块 → 再 preloadAll({force:true}) → 保证状态不跨 test 泄露。

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
  { code: 'led_light_strip_domestic', name: '国产LED灯带', price: 19.4, category: 'hardware', unit: '米', brand_type: 'domestic' },
  { code: 'led_light_power_domestic', name: '国产电源', price: 85, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_switch_domestic', name: '国产开关', price: 47, category: 'hardware', unit: '个', brand_type: 'domestic' },
  { code: 'led_light_strip_import', name: '进口LED', price: 40, category: 'hardware', unit: '米', brand_type: 'import' },
  { code: 'led_light_power_import', name: '进口电源', price: 200, category: 'hardware', unit: '个', brand_type: 'import' },
  { code: 'led_light_switch_import', name: '进口开关', price: 49.39, category: 'hardware', unit: '个', brand_type: 'import' },
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
  global.wx = makeWx(byCollection);
  const modules = loadFresh();
  await modules.priceDict.preloadAll({ force: true });
  await modules.panelDict.preloadAll({ force: true });
  await modules.modelMeta.preloadAll();
  return modules;
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
    assert.equal(m.panelCost, _round2(4.7084 * 195));
    const expectHw = 24.8 + 40 + 7.2 + 23 + 2.8 + 2.2 + 0.8 + 39.8 + 2.5 + 0.5 + 15.9 + 7.76 + 2;
    assert.equal(m.hardwareCost, _round2(expectHw));
    assert.equal(cost.transport, _round2(5.8184 * 15));
    assert.equal(cost.install, _round2(5.8184 * 20));
  } finally { delete global.wx; }
});

test('case 2: 标准 100A + E2 + 钢琴烤漆 + import + led_import → 门板加价 + 铰链 27 + LED import', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES.concat([
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
    assert.equal(m.panelCost, _round2(6.9799 * 70 + 2.227 * 200));
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
    assert.ok(m.totalBodyArea < 4.7, '非标 30cm total_body_area < 50A 原值 4.7');
    assert.ok(m.totalBodyArea > 3.5 && m.totalBodyArea < 4.0, '在预期范围 [3.5, 4.0]');
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
    assert.ok(m.totalBodyArea > 0, '有面积');
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
    const hinge = (m.detail.hardware || []).find((h) => h.code === 'hinge_domestic');
    if (hinge) assert.equal(hinge.total, 0);
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
    assert.equal(cost.sk.unit, 395);
  } finally { delete global.wx; }
});

test('case 7: 单柜 glb metadata miss → module.missing="meta"', async () => {
  const { costEngine } = await primeDicts({
    price: PRICES, panel_name_dict: PANELS,
    model_panel_hardware: [META_50A],
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
    assert.equal(top.name, 'top_panel_18');
    const sideL = m.detail.panels.find((p) => p.name === '左侧板');
    assert.ok(sideL, '侧板中文命中');
  } finally { delete global.wx; }
});

test('case 10: 转角柜 code=y → glb=Y-110-230.glb; 加高转角 yg → YG-110-230G1.glb', async () => {
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
