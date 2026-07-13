// 模型元数据本地缓存:上传成功后写 wx.setStorage, 后续设计/成本消费时从这里拿。
// key: 'model_meta_' + fileName (与 picker/renderer 用 fileName 定位一致)
// value: 上传时 glb-metadata.parse 出来的完整 meta 文档
// cache miss 时自动查 model_panel_hardware 集合, 拿到后回填, 下次命中。
//
// 只做"读存 + 查库回填",不改成本计算逻辑。cost-engine 消费改造留给下一 PR。

const STORAGE_PREFIX = 'model_meta_';
const COLLECTION = 'model_panel_hardware';

// key: fileName -> Promise<meta|null>  同一次会话内并发消费同一 fileName 只查一次库
const _pendingFetch = {};

function _storageKey(fileName) {
  return STORAGE_PREFIX + fileName;
}

// 写缓存。上传成功后由 upload-processor 调。
function setMeta(fileName, meta) {
  if (!fileName || !meta) return;
  if (typeof wx === 'undefined' || !wx.setStorageSync) return;
  try {
    wx.setStorageSync(_storageKey(fileName), meta);
  } catch (e) {
    console.warn('[model-meta-cache] setStorage fail', fileName, e && e.errMsg);
  }
}

// 同步读缓存,只读本地。cache miss 返回 null,由调用方决定是否 fetchMeta 走异步查库。
function peekMeta(fileName) {
  if (!fileName) return null;
  if (typeof wx === 'undefined' || !wx.getStorageSync) return null;
  try {
    const v = wx.getStorageSync(_storageKey(fileName));
    return v || null;
  } catch (e) {
    return null;
  }
}

// 异步读:优先本地,miss 时查库并写回缓存。查库失败返回 null。
async function getMeta(fileName) {
  if (!fileName) return null;
  const local = peekMeta(fileName);
  if (local) return local;
  if (_pendingFetch[fileName]) return _pendingFetch[fileName];
  _pendingFetch[fileName] = _fetchFromCloud(fileName);
  try {
    return await _pendingFetch[fileName];
  } finally {
    delete _pendingFetch[fileName];
  }
}

async function _fetchFromCloud(fileName) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  try {
    const db = wx.cloud.database();
    const res = await db.collection(COLLECTION)
      .where({ glb_file_name: fileName, is_online: true })
      .limit(1)
      .get();
    const doc = res && res.data && res.data[0];
    if (!doc) return null;
    setMeta(fileName, doc);
    return doc;
  } catch (e) {
    console.warn('[model-meta-cache] fetch fail', fileName, e && e.errMsg);
    return null;
  }
}

// 清缓存:主要用于测试和手工修复
function removeMeta(fileName) {
  if (!fileName) return;
  if (typeof wx === 'undefined' || !wx.removeStorageSync) return;
  try { wx.removeStorageSync(_storageKey(fileName)); } catch (e) { /* ignore */ }
}

module.exports = {
  setMeta,
  peekMeta,
  getMeta,
  removeMeta,
  _STORAGE_PREFIX: STORAGE_PREFIX,
};
