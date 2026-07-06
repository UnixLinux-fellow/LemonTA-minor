// 拆单规范 PDF：与 GLB 模型共用存储桶，路径 hardware-fittings/*.pdf（约定该目录下只放一份 PDF）。
// 通过云函数 listHardwareFittings 拿远端 md5，客户端本地缓存 + md5 对比避免重复下载。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

const cloud = require('./cloud.js');

const CACHE_FILE_NAME = 'hardware-pdf.pdf';
const CACHE_MD5_KEY = 'hardwarePdfCachedMd5';
const LEGACY_VERSION_KEY = 'hardwarePdfCachedVersion';

let _pendingPromise = null;
let _legacyCleaned = false;

function fetchHardwarePdf(options) {
  if (_pendingPromise) return _pendingPromise;
  const onProgress = options && options.onProgress;
  _pendingPromise = _run(onProgress).finally(() => { _pendingPromise = null; });
  return _pendingPromise;
}

async function _run(onProgress) {
  _cleanupLegacyKey();

  let spec;
  try {
    spec = await _fetchRemoteSpec();
  } catch (err) {
    if (_isCachedFileExists()) {
      console.warn('[hardware-pdf-cloud] remote spec unavailable, using cache', err && err.message);
      return _cachedPdfPath();
    }
    throw err;
  }

  const cachedMd5 = _getCachedMd5();
  if (spec.md5 === cachedMd5 && _isCachedFileExists()) {
    return _cachedPdfPath();
  }

  try {
    const tempPath = await _downloadToTemp(spec.fileID, onProgress);
    const dest = await _persistToCache(tempPath);
    _setCachedMd5(spec.md5);
    return dest;
  } catch (err) {
    if (_isCachedFileExists()) {
      wx.showToast({ title: '更新失败，已打开本地版本', icon: 'none', duration: 2000 });
      return _cachedPdfPath();
    }
    throw err;
  }
}

// 旧 storage key 一次性清理（当前 key 已迁移到 CACHE_MD5_KEY）
function _cleanupLegacyKey() {
  if (_legacyCleaned) return;
  _legacyCleaned = true;
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) {
      wx.removeStorageSync(LEGACY_VERSION_KEY);
    }
  } catch (e) { /* ignore */ }
}

// 调云函数拿 hardware-fittings/ 下第一份 PDF 的 { md5, fileID }
// （目录约定只放一份拆单规范 PDF；不硬编码文件名，云函数已 filter 到 .pdf）
function _fetchRemoteSpec() {
  return cloud.listHardwareFittings().then((resp) => {
    if (!resp || !resp.ok || !resp.data || !resp.data.success) {
      throw new Error('list_fittings_fail');
    }
    const list = resp.data.files || [];
    const item = list.find((x) => x && x.fileID && x.md5);
    if (!item) {
      throw new Error('spec_not_found');
    }
    return { md5: item.md5, fileID: item.fileID };
  });
}

// cloud:// fileID → https 临时 URL（对齐 model-sync.js:_resolveHttpsURL）
function _resolveHttpsURL(fileID) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.getTempFileURL) {
      reject(new Error('temp_url_fail'));
      return;
    }
    wx.cloud.getTempFileURL({ fileList: [fileID] }).then((res) => {
      const item = res && res.fileList && res.fileList[0];
      const url = item && item.tempFileURL;
      if (!url) {
        console.warn('[hardware-pdf-cloud] getTempFileURL empty', fileID, item && item.errMsg);
        reject(new Error('temp_url_empty'));
        return;
      }
      resolve(url);
    }).catch((err) => {
      console.warn('[hardware-pdf-cloud] getTempFileURL fail', fileID, err && err.errMsg);
      reject(new Error('temp_url_fail'));
    });
  });
}

// 下载 PDF 到临时文件；onProgress(percent 0-100)。
function _downloadToTemp(fileID, onProgress) {
  return _resolveHttpsURL(fileID).then((url) => new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('download bad status: ' + res.statusCode));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail: (err) => reject(new Error('download failed: ' + (err && err.errMsg))),
    });
    if (task && task.onProgressUpdate && typeof onProgress === 'function') {
      task.onProgressUpdate((p) => onProgress(p.progress));
    }
  }));
}

function _cachedPdfPath() {
  return wx.env.USER_DATA_PATH + '/' + CACHE_FILE_NAME;
}

function _isCachedFileExists() {
  try {
    wx.getFileSystemManager().accessSync(_cachedPdfPath());
    return true;
  } catch (e) {
    return false;
  }
}

function _getCachedMd5() {
  try {
    return wx.getStorageSync(CACHE_MD5_KEY) || '';
  } catch (e) {
    return '';
  }
}

function _setCachedMd5(md5) {
  try { wx.setStorageSync(CACHE_MD5_KEY, md5); } catch (e) { /* ignore */ }
}

// 把临时文件复制到 USER_DATA_PATH 下的固定路径，返回目标路径。
function _persistToCache(tempPath) {
  return new Promise((resolve, reject) => {
    const dest = _cachedPdfPath();
    const fs = wx.getFileSystemManager();
    try { fs.unlinkSync(dest); } catch (e) { /* ignore */ }
    fs.copyFile({
      srcPath: tempPath,
      destPath: dest,
      success: () => resolve(dest),
      fail: (err) => reject(new Error('copyFile failed: ' + (err && err.errMsg))),
    });
  });
}

module.exports = { fetchHardwarePdf };
