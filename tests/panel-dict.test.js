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
