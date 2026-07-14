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

test('preloadAll force=true 云失败但已有旧数据: isReady 仍 true, 保留旧值', async () => {
  const wx = makeStorageMock();
  wx.store['cost_data_v1_price'] = SAMPLE;
  // 先热身一次成功加载
  let firstCall = true;
  const cloud = {
    database() {
      return {
        collection() {
          return {
            _skip: 0, _limit: 20,
            count: async () => firstCall ? { total: SAMPLE.length } : (() => { throw new Error('down'); })(),
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            get: async function () {
              return { data: SAMPLE.slice(this._skip, this._skip + this._limit) };
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
    assert.equal(dict.get('panel_egger').price, 195);
    // 第二次:云表挂
    firstCall = false;
    await dict.preloadAll({ force: true });
    assert.equal(dict.isReady(), true, '旧数据仍可用, isReady 不应因单次失败翻转');
    assert.equal(dict.get('panel_egger').price, 195, '旧数据仍在内存');
  } finally { delete global.wx; }
});
