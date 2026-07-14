// 价格字典:小程序启动时预拉云表 `price` 到本地 storage;
// 后续 get(code) / all() / getByCategory(cat) 同步读内存映射, 不再触网。
// 数据形状: { code, name, price, category, unit, brand_type }

const STORAGE_KEY = 'cost_data_v1_price';
const COLLECTION = 'price';
const PAGE_SIZE = 20;   // 微信小程序 db 单次上限

let _byCode = null;    // Map<code, entry>
let _all = [];         // entry[]
let _ready = false;

function _ingest(rows) {
  _all = rows || [];
  _byCode = new Map();
  _all.forEach((r) => { if (r && r.code) _byCode.set(r.code, r); });
  _ready = true;
}

function _readStorage() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch (e) { return null; }
}

function _writeStorage(rows) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return;
  try { wx.setStorageSync(STORAGE_KEY, rows); }
  catch (e) { console.warn('[price-dict] setStorage fail', e && e.errMsg); }
}

async function _fetchAll() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION);
    const { total } = await col.count();
    const out = [];
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await col.skip(skip).limit(PAGE_SIZE).get();
      out.push(...(res.data || []));
    }
    return out;
  } catch (e) {
    console.warn('[price-dict] fetch fail', e && e.errMsg);
    return null;
  }
}

// preloadAll: 读老 + 后台悄悄刷新
//   force=true:  阻塞拉云 → 覆盖 storage/内存
//   force=false: 本地有 → 立即 ingest, fire-and-forget 后台再拉一次静默覆盖;本地无 → 阻塞拉云
async function preloadAll(opts) {
  const force = !!(opts && opts.force);
  if (!force) {
    const local = _readStorage();
    if (local) {
      _ingest(local);
      _refreshInBackground();   // 不 await, 悄悄刷新
      return;
    }
  }
  const remote = await _fetchAll();
  if (remote) { _ingest(remote); _writeStorage(remote); return; }
  // 云拉取失败。如果从未成功加载过, 初始化空状态并标记未就绪;
  // 如果已有旧数据, 保持原样不动 (旧数据仍可用, isReady 不误翻转)。
  if (_byCode === null) {
    _byCode = new Map();
    _all = [];
    _ready = false;
  }
}

// 后台静默刷新:成功覆写内存 + storage;失败保留老缓存
function _refreshInBackground() {
  _fetchAll().then((remote) => {
    if (remote && Array.isArray(remote) && remote.length > 0) {
      _ingest(remote);
      _writeStorage(remote);
    }
    // remote===null 时 _fetchAll 已 warn 过, 不再重复
    // remote===[] 时(后端空表)保留老缓存不覆盖 — 这是设计意图
  });
  // 不加 .catch: _fetchAll 内部已捕获, 走到这里说明 promise 已 resolve
}

function get(code) { return _byCode ? _byCode.get(code) : undefined; }
function all() { return _all.slice(); }
function getByCategory(cat) { return _all.filter((r) => r && r.category === cat); }
function isReady() { return _ready; }

module.exports = { preloadAll, get, all, getByCategory, isReady, _STORAGE_KEY: STORAGE_KEY };
