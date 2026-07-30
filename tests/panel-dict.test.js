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
  { panel_code: 'no_enable_field', display_name: '无 enable 字段板' , category: 'cabinet_frame' },   // enable 缺失: 应视为启用
  { panel_code: 'deprecated_panel', display_name: '废弃', category: 'cabinet_frame', enable: false },
];

test('preloadAll:enable=false 的条目被过滤', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('side_left_panel_18').display_name, '左侧板');
    assert.equal(dict.get('deprecated_panel'), undefined);
    assert.equal(dict.all().length, 5);
    assert.ok(dict.get('no_enable_field'), 'enable 缺失的行应保留(视为启用)');
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

test('regex 行:模式命中展开 $1', async () => {
  const wx = makeStorageMock();
  const rows = [
    { panel_code: '^door_lower_L_(\\d+)$', display_name: '左柜下门$1', category: 'door_panel', enable: true, match_type: 'regex' },
    { panel_code: '^door_middle_(\\d+)$', display_name: '$1号玻璃门', category: 'door_panel', enable: true, match_type: 'regex' },
    { panel_code: '^drawer_box_left_(\\d+)_18$', display_name: '$1号左抽帮', category: 'drawer_component', enable: true, match_type: 'regex' },
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(rows) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    const a = dict.get('door_lower_L_1');
    assert.equal(a.display_name, '左柜下门1');
    assert.equal(a.category, 'door_panel');
    assert.equal(a.panel_code, 'door_lower_L_1');
    assert.equal(dict.get('door_lower_L_3').display_name, '左柜下门3');
    assert.equal(dict.get('door_middle_2').display_name, '2号玻璃门');
    assert.equal(dict.get('drawer_box_left_01_18').display_name, '01号左抽帮');
  } finally { delete global.wx; }
});

test('regex 行:未命中返 undefined, 边界 anchor 生效', async () => {
  const wx = makeStorageMock();
  const rows = [
    { panel_code: '^door_lower_(\\d+)$', display_name: '下门$1', category: 'door_panel', enable: true, match_type: 'regex' },
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(rows) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('door_lower_L_1'), undefined, 'L_1 不应被 door_lower_(\\d+) 命中');
    assert.equal(dict.get('xdoor_lower_1'), undefined, '前缀多余字符不命中');
    assert.equal(dict.get('door_lower_1_extra'), undefined, '后缀多余字符不命中');
  } finally { delete global.wx; }
});

test('精确行优先于模式行', async () => {
  const wx = makeStorageMock();
  const rows = [
    { panel_code: '^countertop.*$', display_name: '通用台面$1', category: 'cabinet_frame', enable: true, match_type: 'regex' },
    { panel_code: 'countertop', display_name: '台面', category: 'cabinet_frame', enable: true },
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(rows) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('countertop').display_name, '台面', '精确胜出');
    assert.equal(dict.get('countertop_L').display_name, '通用台面', '无精确时走模式');
  } finally { delete global.wx; }
});

test('无效正则被跳过, 不阻断其他行', async () => {
  const wx = makeStorageMock();
  const originalWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a);
  const rows = [
    { panel_code: '^door_(', display_name: '坏', category: 'door_panel', enable: true, match_type: 'regex' },
    { panel_code: '^door_lower_(\\d+)$', display_name: '下门$1', category: 'door_panel', enable: true, match_type: 'regex' },
    { panel_code: 'top_panel_18', display_name: '柜体顶板', category: 'cabinet_frame', enable: true },
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(rows) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('door_lower_1').display_name, '下门1');
    assert.equal(dict.get('top_panel_18').display_name, '柜体顶板');
    assert.ok(warns.some((w) => String(w[0]).includes('bad regex')), '应 warn 一次 bad regex');
  } finally { console.warn = originalWarn; delete global.wx; }
});

test('$$ 转义为字面 $', async () => {
  const wx = makeStorageMock();
  const rows = [
    { panel_code: '^money_(\\d+)$', display_name: '$$$1元', category: 'cabinet_frame', enable: true, match_type: 'regex' },
  ];
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(rows) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.get('money_50').display_name, '$50元');
  } finally { delete global.wx; }
});
