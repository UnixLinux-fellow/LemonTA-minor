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

test('ensureCostDataReady 任一失败: 不抛, isAllReady=false', async () => {
  const wx = makeStorageMock();
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
    await bootstrap.ensureCostDataReady();
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
