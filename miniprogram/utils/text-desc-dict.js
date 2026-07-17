// utils/text-desc-dict.js
// UI 文案字典: 小程序启动时预拉云表 `text_desc` (仅 desc_type='text_desc') 到 storage;
// 后续 get(desc_code) / getDesc(desc_code) 同步读, 不再触网。
// 消费方: option-scroll-card 组件 (下方图文说明区的文字部分)。
//
// 数据形状: { desc_code, desc_name, desc_type }, 我们只关心 desc_type='text_desc' 的行。

const STORAGE_KEY = 'text_desc_v1';
const COLLECTION  = 'text_desc';
const DESC_TYPE   = 'text_desc';
const PAGE_SIZE   = 20;  // 微信小程序 db 单次上限

let _byCode = null;  // Map<desc_code, entry>
let _all = [];       // entry[]
let _ready = false;

function _ingest(rows) {
  _all = rows || [];
  _byCode = new Map();
  _all.forEach((r) => { if (r && r.desc_code) _byCode.set(r.desc_code, r); });
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
  catch (e) { console.warn('[text-desc-dict] setStorage fail', e && e.errMsg); }
}

async function _fetchAll() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const col = db.collection(COLLECTION).where({ desc_type: DESC_TYPE });
    const { total } = await col.count();
    const out = [];
    for (let skip = 0; skip < total; skip += PAGE_SIZE) {
      const res = await col.skip(skip).limit(PAGE_SIZE).get();
      out.push(...(res.data || []));
    }
    return out;
  } catch (e) {
    console.warn('[text-desc-dict] fetch fail', e && e.errMsg);
    return null;
  }
}

// preloadAll: 读本地 → ingest → 后台悄悄拉云覆盖
//   force=true:  阻塞拉云 → 覆盖 storage/内存
//   force=false: 本地有 → 立即 ingest, 后台再拉一次静默覆盖; 本地无 → 阻塞拉云
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

function get(descCode) { return _byCode ? _byCode.get(descCode) : undefined; }

function getDesc(descCode) {
  const entry = get(descCode);
  return entry ? (entry.desc_name || '') : '';
}

function all() { return _all.slice(); }

function isReady() { return _ready; }

module.exports = { preloadAll, get, getDesc, all, isReady, _STORAGE_KEY: STORAGE_KEY };
