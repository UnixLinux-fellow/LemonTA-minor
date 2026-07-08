// utils/img-cache.js
// fileID ↔ 本地文件路径三层缓存
//
// 结构：
//   wx.storage.IMG_CACHE = {
//     "cloud://.../designs/xxx.png": { path, size, lastUsed }
//   }
//   USER_DATA_PATH/img-cache/{hash}.{ext}
//
// 命中就返回本地路径；未命中会 getTempFileURL + downloadFile 落盘后再返回。
// 淘汰策略：LRU 100 条 / 30MB，超限从最老的开始摘。

var STORAGE_KEY = 'IMG_CACHE';
var MAX_ITEMS = 100;
var MAX_BYTES = 30 * 1024 * 1024;

var _fm = null;
function _getFM() {
  if (!_fm) _fm = wx.getFileSystemManager();
  return _fm;
}

function _cacheDir() {
  return wx.env.USER_DATA_PATH + '/img-cache';
}

function _ensureDir() {
  var dir = _cacheDir();
  try {
    _getFM().accessSync(dir);
  } catch (e) {
    try {
      _getFM().mkdirSync(dir, true);
    } catch (e2) {
      console.warn('[img-cache] mkdir failed:', e2 && e2.errMsg);
    }
  }
}

// 双 FNV-1a 生成 16 hex-char key（比裸 32 位 FNV 减少碰撞）；fileID 不会离开当前用户空间，够用。
function _hash(str) {
  var h1 = 2166136261 >>> 0;
  var h2 = 16777619 >>> 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 ^= c;
    h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
    h2 ^= (c * 31 + i) >>> 0;
    h2 = (h2 + ((h2 << 1) + (h2 << 4) + (h2 << 7) + (h2 << 8) + (h2 << 24))) >>> 0;
  }
  var p1 = ('00000000' + h1.toString(16)).slice(-8);
  var p2 = ('00000000' + h2.toString(16)).slice(-8);
  return p1 + p2;
}

function _extOf(fileID) {
  var m = fileID.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return m ? m[1].toLowerCase() : 'png';
}

function _readMap() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || {};
  } catch (e) {
    return {};
  }
}

function _writeMap(m) {
  try {
    wx.setStorageSync(STORAGE_KEY, m);
  } catch (e) {
    console.warn('[img-cache] write storage failed:', e && e.errMsg);
  }
}

// 淘汰：从 lastUsed 最早开始删，直到条数和总字节都低于阈值
function _evictIfNeeded(mapIn) {
  var map = mapIn || _readMap();
  var keys = Object.keys(map);
  if (!keys.length) return;
  var totalBytes = 0;
  for (var i = 0; i < keys.length; i++) totalBytes += (map[keys[i]].size || 0);
  if (keys.length <= MAX_ITEMS && totalBytes <= MAX_BYTES) return;
  var entries = keys
    .map(function (k) { return { key: k, ent: map[k] }; })
    .sort(function (a, b) { return (a.ent.lastUsed || 0) - (b.ent.lastUsed || 0); });
  while (entries.length && (Object.keys(map).length > MAX_ITEMS || totalBytes > MAX_BYTES)) {
    var oldest = entries.shift();
    var entry = map[oldest.key];
    if (entry) {
      if (entry.path) {
        try { _getFM().unlinkSync(entry.path); } catch (e) { /* ignore */ }
      }
      totalBytes -= entry.size || 0;
      delete map[oldest.key];
    }
  }
  _writeMap(map);
}

/**
 * 登记一张已存在于本地的图片到缓存
 * @param {string} fileID 云存储 fileID，作为 key
 * @param {string} srcPath 当前本地路径（wxfile:// 或 USER_DATA_PATH/... 都可）
 * @param {number} [size] 可选大小；不填会尝试 statSync 读取
 */
function register(fileID, srcPath, size) {
  if (!fileID || !srcPath) return;
  _ensureDir();
  var dst = _cacheDir() + '/' + _hash(fileID) + '.' + _extOf(fileID);
  // 已经在目标位置就跳过 copy
  if (srcPath !== dst) {
    try {
      _getFM().copyFileSync(srcPath, dst);
    } catch (e) {
      console.warn('[img-cache] copyFile failed:', e && e.errMsg);
      return;
    }
  }
  var actualSize = size || 0;
  if (!actualSize) {
    try {
      actualSize = _getFM().statSync(dst).size || 0;
    } catch (e) { /* ignore */ }
  }
  var map = _readMap();
  map[fileID] = { path: dst, size: actualSize, lastUsed: Date.now() };
  _writeMap(map);
  _evictIfNeeded(map);
}

/**
 * 拿本地路径。命中即返回；未命中走云端下载后再返回。
 * @param {string} fileID
 * @returns {Promise<string>} 本地路径；空 fileID → resolve('')
 */
function resolve(fileID) {
  if (!fileID) return Promise.resolve('');
  var map = _readMap();
  var entry = map[fileID];
  if (entry && entry.path) {
    try {
      _getFM().accessSync(entry.path);
      entry.lastUsed = Date.now();
      map[fileID] = entry;
      _writeMap(map);
      return Promise.resolve(entry.path);
    } catch (e) {
      // 文件被清了，摘掉这条 index 继续走云端下载
      delete map[fileID];
      _writeMap(map);
    }
  }
  return _download(fileID);
}

function _download(fileID) {
  if (!wx.cloud) return Promise.reject(new Error('wx.cloud unavailable'));
  return wx.cloud
    .getTempFileURL({ fileList: [fileID] })
    .then(function (res) {
      var item = res.fileList && res.fileList[0];
      if (!item || !item.tempFileURL) throw new Error('no tempFileURL');
      return new Promise(function (rs, rj) {
        wx.downloadFile({
          url: item.tempFileURL,
          success: function (dl) {
            if (dl.statusCode >= 200 && dl.statusCode < 300 && dl.tempFilePath) {
              rs(dl.tempFilePath);
            } else {
              rj(new Error('downloadFile status=' + dl.statusCode));
            }
          },
          fail: rj,
        });
      });
    })
    .then(function (tempPath) {
      register(fileID, tempPath);
      var map = _readMap();
      var entry = map[fileID];
      // 若 register 因 copy 失败没落库，退回 downloadFile 的 temp 路径（本次可用，下次仍会重下）
      return (entry && entry.path) || tempPath;
    });
}

/**
 * 同步判断某 fileID 是否有可用的本地缓存文件。
 * 只查 storage index + accessSync，不做任何异步 IO，可安全在 tap 前用来决定是否显示 loading。
 * @param {string} fileID
 * @returns {boolean}
 */
function hasReady(fileID) {
  if (!fileID) return false;
  var map = _readMap();
  var entry = map[fileID];
  if (!entry || !entry.path) return false;
  try {
    _getFM().accessSync(entry.path);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 摘掉一条缓存（同时删本地文件）
 * @param {string} fileID
 */
function remove(fileID) {
  if (!fileID) return;
  var map = _readMap();
  var entry = map[fileID];
  if (entry && entry.path) {
    try { _getFM().unlinkSync(entry.path); } catch (e) { /* ignore */ }
  }
  if (map[fileID]) {
    delete map[fileID];
    _writeMap(map);
  }
}

module.exports = { resolve: resolve, register: register, remove: remove, hasReady: hasReady };
