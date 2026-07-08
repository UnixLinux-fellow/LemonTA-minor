// 拆单规范 PDF：与 GLB 模型共用存储桶，路径 hardware-fittings/*.pdf（约定该目录下只放一份 PDF，
// 文件名英文中文均可，客户端按 .pdf 后缀判断）。本地缓存文件名与云端保持一致，方便 openDocument
// 打开后标题栏显示正确的中文/业务名。
// 通过云函数 listHardwareFittings 拿远端 md5，客户端本地缓存 + md5 对比避免重复下载。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

const cloud = require('./cloud.js');

const CACHE_MD5_KEY = 'hardwarePdfCachedMd5';
const CACHE_NAME_KEY = 'hardwarePdfCachedName';
const LEGACY_VERSION_KEY = 'hardwarePdfCachedVersion';
const LEGACY_FILE_NAME = 'hardware-pdf.pdf';

let _pendingPromise = null;
let _legacyCleaned = false;

function fetchHardwarePdf(options) {
  if (_pendingPromise) return _pendingPromise;
  const onProgress = options && options.onProgress;
  _pendingPromise = _run(onProgress).finally(() => { _pendingPromise = null; });
  return _pendingPromise;
}

async function _run(onProgress) {
  _cleanupLegacy();

  let spec;
  try {
    spec = await _fetchRemoteSpec();
  } catch (err) {
    const cachedPath = _cachedPdfPathIfExists();
    if (cachedPath) {
      console.warn('[hardware-pdf-cloud] remote spec unavailable, using cache', err && err.message);
      return cachedPath;
    }
    throw err;
  }

  const cachedMd5 = _getCachedMd5();
  const cachedName = _getCachedName();
  if (spec.md5 === cachedMd5 && spec.name === cachedName) {
    const cachedPath = _cachedPdfPathIfExists();
    if (cachedPath) return cachedPath;
  }

  try {
    const tempPath = await _downloadToTemp(spec.fileID, onProgress);
    _removePrevCacheFile(cachedName, spec.name);
    const dest = await _persistToCache(tempPath, spec.name);
    _setCachedMd5(spec.md5);
    _setCachedName(spec.name);
    return dest;
  } catch (err) {
    const cachedPath = _cachedPdfPathIfExists();
    if (cachedPath) {
      wx.showToast({ title: '更新失败，已打开本地版本', icon: 'none', duration: 2000 });
      return cachedPath;
    }
    throw err;
  }
}

// 一次性清理：旧 storage key + 旧固定文件名 hardware-pdf.pdf
function _cleanupLegacy() {
  if (_legacyCleaned) return;
  _legacyCleaned = true;
  if (typeof wx === 'undefined') return;
  try { wx.removeStorageSync(LEGACY_VERSION_KEY); } catch (e) { /* ignore */ }
  try {
    const legacyPath = wx.env.USER_DATA_PATH + '/' + LEGACY_FILE_NAME;
    // 只删除历史遗留的固定名文件，不影响 CACHE_NAME_KEY 记录的当前缓存
    if (_getCachedName() !== LEGACY_FILE_NAME) {
      wx.getFileSystemManager().unlinkSync(legacyPath);
    }
  } catch (e) { /* 文件不存在即已完成 */ }
}

// 调云函数拿 hardware-fittings/ 下 PDF 的 { md5, fileID, name }
// 目录约定只放一份拆单规范 PDF；根据文件名（.pdf 结尾）做判断，名称英文或中文均可
function _fetchRemoteSpec() {
  return cloud.listHardwareFittings().then((resp) => {
    if (!resp || !resp.ok || !resp.data || !resp.data.success) {
      throw new Error('list_fittings_fail');
    }
    const list = resp.data.files || [];
    const item = list.find((x) => x && x.name && /\.pdf$/i.test(x.name) && x.fileID && x.md5);
    if (!item) {
      throw new Error('spec_not_found');
    }
    return { md5: item.md5, fileID: item.fileID, name: item.name };
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

function _cachedPdfPath(name) {
  return wx.env.USER_DATA_PATH + '/' + name;
}

// 返回当前缓存路径（若不存在则 null）；供命中缓存 / 兜底降级用
function _cachedPdfPathIfExists() {
  const name = _getCachedName();
  if (!name) return null;
  const p = _cachedPdfPath(name);
  try {
    wx.getFileSystemManager().accessSync(p);
    return p;
  } catch (e) {
    return null;
  }
}

// 新一份下载完成后，删除上一份缓存文件（若文件名与新文件不同）
function _removePrevCacheFile(prevName, newName) {
  if (!prevName || prevName === newName) return;
  try {
    wx.getFileSystemManager().unlinkSync(_cachedPdfPath(prevName));
  } catch (e) { /* ignore */ }
}

function _getCachedMd5() {
  try { return wx.getStorageSync(CACHE_MD5_KEY) || ''; } catch (e) { return ''; }
}

function _setCachedMd5(md5) {
  try { wx.setStorageSync(CACHE_MD5_KEY, md5); } catch (e) { /* ignore */ }
}

function _getCachedName() {
  try { return wx.getStorageSync(CACHE_NAME_KEY) || ''; } catch (e) { return ''; }
}

function _setCachedName(name) {
  try { wx.setStorageSync(CACHE_NAME_KEY, name); } catch (e) { /* ignore */ }
}

// 把临时文件复制到 USER_DATA_PATH 下按远端文件名命名，返回目标路径。
function _persistToCache(tempPath, name) {
  return new Promise((resolve, reject) => {
    const dest = _cachedPdfPath(name);
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
