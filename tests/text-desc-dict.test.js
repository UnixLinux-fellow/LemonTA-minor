// tests/text-desc-dict.test.js
// text_desc 字典: preloadAll 拉云表 (where desc_type='text_desc') → storage;
// get(desc_code)/getDesc(desc_code) 同步查缓存。Node 环境注入 mock wx。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadFresh() {
  const p = path.resolve(__dirname, '../miniprogram/utils/text-desc-dict.js');
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

// 支持 where(cond).skip.limit.count/get
function makeCloudMock(rows) {
  return {
    database() {
      return {
        collection(name) {
          assert.equal(name, 'text_desc');
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

const SAMPLE = [
  { desc_code: 'WZJ', desc_name: '无转角适用于矩形墙面', desc_type: 'text_desc' },
  { desc_code: 'ZZJ', desc_name: '左转角柜适用于 L 型左角', desc_type: 'text_desc' },
  { desc_code: 'panel_e2_domestic', desc_name: 'E2 国产板性价比首选', desc_type: 'text_desc' },
  { desc_code: 'unrelated', desc_name: '与此模块无关', desc_type: 'other_type' },
];

test('preloadAll 首次: 拉云表 (只 text_desc 类型) 写 storage; get/getDesc 命中', async () => {
  const wx = makeStorageMock();
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(SAMPLE) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    assert.equal(dict.get('ZZJ').desc_name, '左转角柜适用于 L 型左角');
    assert.equal(dict.getDesc('nonexistent'), '');
    // 只应拿到 desc_type=text_desc 的 3 条 (不含 unrelated)
    assert.equal(wx.store['text_desc_v1'].length, 3);
    // 校验 unrelated 未被写入
    assert.ok(!wx.store['text_desc_v1'].some((r) => r.desc_code === 'unrelated'));
  } finally { delete global.wx; }
});

test('preloadAll 二次: 立即用本地缓存, isReady=true, 后台仍刷新一次', async () => {
  const wx = makeStorageMock();
  wx.store['text_desc_v1'] = SAMPLE.filter((r) => r.desc_type === 'text_desc');
  const FRESH = wx.store['text_desc_v1'].concat([
    { desc_code: 'NEW', desc_name: '新添说明', desc_type: 'text_desc' },
  ]);
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(FRESH) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    // 立即命中本地缓存,还没看到 NEW
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    assert.equal(dict.getDesc('NEW'), '');
    assert.equal(dict.isReady(), true);
    // 等后台 fire-and-forget 结束
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(dict.getDesc('NEW'), '新添说明');
    assert.equal(wx.store['text_desc_v1'].length, 4);
  } finally { delete global.wx; }
});

test('preloadAll force=true 云失败但有旧数据: isReady 仍 true, 保留旧值', async () => {
  const wx = makeStorageMock();
  wx.store['text_desc_v1'] = SAMPLE.filter((r) => r.desc_type === 'text_desc');
  let firstCall = true;
  const cloud = {
    database() {
      return {
        collection() {
          return {
            _cond: null, _skip: 0, _limit: 20,
            where(c) { this._cond = c; return this; },
            skip(n) { this._skip = n; return this; },
            limit(n) { this._limit = n; return this; },
            count: async function () {
              if (!firstCall) throw new Error('down');
              const f = SAMPLE.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]));
              return { total: f.length };
            },
            get: async function () {
              const f = SAMPLE.filter((r) => Object.keys(this._cond).every((k) => r[k] === this._cond[k]));
              return { data: f.slice(this._skip, this._skip + this._limit) };
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
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
    firstCall = false;
    await dict.preloadAll({ force: true });
    // 旧数据仍在,isReady 不因单次失败翻转
    assert.equal(dict.isReady(), true);
    assert.equal(dict.getDesc('WZJ'), '无转角适用于矩形墙面');
  } finally { delete global.wx; }
});

test('无 wx 环境: 所有 API 退化 no-op', async () => {
  delete global.wx;
  const dict = loadFresh();
  await dict.preloadAll();
  assert.equal(dict.getDesc('WZJ'), '');
  assert.equal(dict.get('WZJ'), undefined);
  assert.equal(dict.isReady(), false);
});

test('preloadAll 分页: >20 条要多次 get', async () => {
  const wx = makeStorageMock();
  const many = Array.from({ length: 47 }, (_, i) => ({
    desc_code: 'k' + i, desc_name: '说明' + i, desc_type: 'text_desc',
  }));
  global.wx = Object.assign({}, wx, { cloud: makeCloudMock(many) });
  try {
    const dict = loadFresh();
    await dict.preloadAll();
    assert.equal(dict.getDesc('k0'), '说明0');
    assert.equal(dict.getDesc('k46'), '说明46');
  } finally { delete global.wx; }
});
