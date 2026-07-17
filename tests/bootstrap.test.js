const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFreshBootstrap() {
  const modulesToClear = [
    '../miniprogram/utils/bootstrap.js',
    '../miniprogram/utils/price-dict.js',
    '../miniprogram/utils/panel-dict.js',
    '../miniprogram/utils/model-meta-cache.js',
    '../miniprogram/utils/text-desc-dict.js',
    '../miniprogram/utils/materials-cost-cache.js',
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
    textDesc: require(path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js')),
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

test('ensureUiDescReady: 拉 text_desc 后 text-desc-dict.isReady=true', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, {
    cloud: makeCloudMock({
      text_desc: [{ desc_code: 'WZJ', desc_name: '无转角', desc_type: 'text_desc' }],
    }),
  });
  try {
    const { bootstrap, textDesc } = loadFreshBootstrap();
    assert.equal(textDesc.isReady(), false);
    await bootstrap.ensureUiDescReady();
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
    const { bootstrap, textDesc } = loadFreshBootstrap();
    await bootstrap.ensureUiDescReady();  // 不抛
    assert.equal(textDesc.isReady(), false);
  } finally { delete global.wx; }
});

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
