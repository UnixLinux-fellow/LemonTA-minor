// 板件中英映射字典:云表 panel_name_dict, 丢弃 enable===false 的条目 (undefined 视为启用)。
// 数据形状: { panel_code, display_name, category, enable, match_type? }
//   match_type 缺失 或 "exact": panel_code 精确匹配 (Map)
//   match_type = "regex":       panel_code 是 JS 正则源, display_name 是模板($1/$2 引用捕获组)
// 匹配优先级: 精确 Map 先, miss 后按 _ingest 遍历顺序试模式行, 第一条命中胜出。
// 缓存策略与 price-dict 一致:读老 + 后台悄悄刷新, 云失败保留旧数据。

const STORAGE_KEY = 'cost_data_v1_panel';
const COLLECTION = 'panel_name_dict';
const PAGE_SIZE = 20;

let _byCode = null;    // Map<panel_code, entry>
let _patterns = [];    // [{re, entry}]  编译好的模式行
let _all = [];         // entry[]  (已过滤 enable=false)
let _ready = false;

function _ingest(rows) {
  _all = (rows || []).filter((r) => r && r.enable !== false);
  _byCode = new Map();
  _patterns = [];
  _all.forEach((r) => {
    if (!r.panel_code) return;
    if (r.match_type === 'regex') {
      try {
        _patterns.push({ re: new RegExp(r.panel_code), entry: r });
      } catch (e) {
        console.warn('[panel-dict] bad regex', r.panel_code, e && e.message);
      }
    } else {
      _byCode.set(r.panel_code, r);
    }
  });
  _ready = true;
}

// 展开 display_name 模板: $1, $2 → 对应捕获组值; $$ → $
function _expandTemplate(template, match) {
  return String(template == null ? '' : template).replace(/\$(\$|\d+)/g, (_, k) => {
    if (k === '$') return '$';
    const idx = +k;
    return idx < match.length && match[idx] != null ? match[idx] : '';
  });
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
  catch (e) { console.warn('[panel-dict] setStorage fail', e && e.errMsg); }
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
    console.warn('[panel-dict] fetch fail', e && e.errMsg);
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
    _patterns = [];
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

function get(code) {
  if (!_byCode) return undefined;
  const exact = _byCode.get(code);
  if (exact) return exact;
  for (let i = 0; i < _patterns.length; i++) {
    const p = _patterns[i];
    const m = p.re.exec(code);
    if (m) {
      return {
        panel_code: code,
        display_name: _expandTemplate(p.entry.display_name, m),
        category: p.entry.category,
        enable: true,
      };
    }
  }
  return undefined;
}
function all() { return _all.slice(); }
function isReady() { return _ready; }

module.exports = { preloadAll, get, all, isReady, _STORAGE_KEY: STORAGE_KEY };
