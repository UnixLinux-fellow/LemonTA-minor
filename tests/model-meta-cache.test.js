// 模型元数据本地缓存测试。
// Node 环境下 wx 不存在, 模块降级为 no-op;这里注入 mock wx 让所有分支可测。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// 每个 test 都重新加载模块以清 _pendingFetch 状态
function loadFreshCache() {
  const modulePath = path.resolve(__dirname, '../miniprogram/utils/model-meta-cache.js');
  delete require.cache[modulePath];
  return require(modulePath);
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

function makeCloudMock(dataByFileName) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'model_panel_hardware');
          return {
            where(cond) {
              this._cond = cond;
              return this;
            },
            limit(n) { this._limit = n; return this; },
            async get() {
              const d = dataByFileName[this._cond.glb_file_name];
              return { data: d ? [d] : [] };
            },
          };
        },
      };
    },
  };
}

test('setMeta + peekMeta: 写后读', () => {
  const wx = makeStorageMock();
  global.wx = wx;
  try {
    const cache = loadFreshCache();
    cache.setMeta('50A.glb', { glb_file_name: '50A.glb', overall_size: { total_width: 50 } });
    const meta = cache.peekMeta('50A.glb');
    assert.equal(meta.glb_file_name, '50A.glb');
    assert.equal(meta.overall_size.total_width, 50);
    assert.ok(wx.store['model_meta_50A.glb']);
  } finally {
    delete global.wx;
  }
});

test('peekMeta: miss 返回 null', () => {
  global.wx = makeStorageMock();
  try {
    const cache = loadFreshCache();
    assert.equal(cache.peekMeta('nonexistent.glb'), null);
  } finally {
    delete global.wx;
  }
});

test('getMeta: 本地命中直接返回', async () => {
  const wx = makeStorageMock();
  global.wx = wx;
  try {
    const cache = loadFreshCache();
    cache.setMeta('100C.glb', { glb_file_name: '100C.glb', tag: 'local' });
    const meta = await cache.getMeta('100C.glb');
    assert.equal(meta.tag, 'local');
  } finally {
    delete global.wx;
  }
});

test('getMeta: 本地 miss 时查库并回填', async () => {
  const wx = makeStorageMock();
  const cloud = makeCloudMock({
    'Y110.glb': { glb_file_name: 'Y110.glb', tag: 'from-cloud', is_online: true },
  });
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const cache = loadFreshCache();
    const meta = await cache.getMeta('Y110.glb');
    assert.equal(meta.tag, 'from-cloud');
    // 回填后再 peek 应命中本地
    const cached = cache.peekMeta('Y110.glb');
    assert.equal(cached.tag, 'from-cloud');
  } finally {
    delete global.wx;
  }
});

test('getMeta: 本地 miss + 云端也无 → 返回 null', async () => {
  const wx = makeStorageMock();
  const cloud = makeCloudMock({});  // 空
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const cache = loadFreshCache();
    const meta = await cache.getMeta('MISSING.glb');
    assert.equal(meta, null);
  } finally {
    delete global.wx;
  }
});

test('getMeta: 并发同一 fileName 只查库一次', async () => {
  const wx = makeStorageMock();
  let fetchCount = 0;
  const cloud = {
    database() {
      return {
        collection() {
          return {
            where() { return this; },
            limit() { return this; },
            async get() {
              fetchCount++;
              // 加点延时模拟异步
              await new Promise((r) => setTimeout(r, 10));
              return { data: [{ glb_file_name: 'concurrent.glb', is_online: true }] };
            },
          };
        },
      };
    },
  };
  global.wx = Object.assign({}, wx, { cloud });
  try {
    const cache = loadFreshCache();
    const [a, b, c] = await Promise.all([
      cache.getMeta('concurrent.glb'),
      cache.getMeta('concurrent.glb'),
      cache.getMeta('concurrent.glb'),
    ]);
    assert.equal(a.glb_file_name, 'concurrent.glb');
    assert.equal(b, a);
    assert.equal(c, a);
    assert.equal(fetchCount, 1);
  } finally {
    delete global.wx;
  }
});

test('removeMeta: 清一条', () => {
  const wx = makeStorageMock();
  global.wx = wx;
  try {
    const cache = loadFreshCache();
    cache.setMeta('50B.glb', { x: 1 });
    assert.ok(cache.peekMeta('50B.glb'));
    cache.removeMeta('50B.glb');
    assert.equal(cache.peekMeta('50B.glb'), null);
  } finally {
    delete global.wx;
  }
});

test('无 wx 环境: 所有 API 退化 no-op', async () => {
  // 确保 global.wx 未定义
  delete global.wx;
  const cache = loadFreshCache();
  cache.setMeta('any.glb', { x: 1 });       // 不抛
  assert.equal(cache.peekMeta('any.glb'), null);
  assert.equal(await cache.getMeta('any.glb'), null);
  cache.removeMeta('any.glb');              // 不抛
});

// ---- preloadAll: 一次性拉 is_online=true 的元数据, 按 glb_file_name 写单条 storage ----

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

test('preloadAll: 拉所有 is_online=true 的 meta 并按 fileName 写单条 storage', async () => {
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

test('preloadAll: 总是覆盖已有 fileName (glb 数据修正常见)', async () => {
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
    // 与字典模块不同: 模型元数据总是覆盖(允许 glb 数据修正)
    assert.equal(cache.peekMeta('50A.glb').total_body_area, 4.7);
  } finally { delete global.wx; }
});

test('preloadAll 云失败: warn 不抛', async () => {
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
