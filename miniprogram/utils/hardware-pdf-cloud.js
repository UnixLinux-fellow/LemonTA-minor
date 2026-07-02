// 五金/尺寸参考 PDF：从腾讯云 COS 拉取，本地缓存 + 版本对比。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

const MANIFEST_URL = 'https://hardware-fit-1439937513.cos.ap-shanghai.myqcloud.com/hardware-pdf/manifest.json';
const CACHE_FILE_NAME = 'hardware-pdf.pdf';
const CACHE_VERSION_KEY = 'hardwarePdfCachedVersion';

let _pendingPromise = null;

function fetchHardwarePdf(options) {
  if (_pendingPromise) return _pendingPromise;
  const onProgress = options && options.onProgress;
  _pendingPromise = _run(onProgress).finally(() => { _pendingPromise = null; });
  return _pendingPromise;
}

async function _run(onProgress) {
  let manifest;
  try {
    manifest = await _fetchManifest();
  } catch (err) {
    if (_isCachedFileExists()) {
      return _cachedPdfPath();
    }
    throw err;
  }

  const cachedVersion = _getCachedVersion();
  if (manifest.version === cachedVersion && _isCachedFileExists()) {
    return _cachedPdfPath();
  }

  try {
    const tempPath = await _downloadToTemp(manifest.url, onProgress);
    const dest = await _persistToCache(tempPath);
    _setCachedVersion(manifest.version);
    return dest;
  } catch (err) {
    if (_isCachedFileExists()) {
      wx.showToast({ title: '更新失败，已打开本地版本', icon: 'none', duration: 2000 });
      return _cachedPdfPath();
    }
    throw err;
  }
}

function _fetchManifest() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: MANIFEST_URL,
      method: 'GET',
      dataType: 'json',
      success: (res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.version || !res.data.url) {
          reject(new Error('manifest invalid: ' + res.statusCode));
          return;
        }
        resolve({ version: String(res.data.version), url: String(res.data.url) });
      },
      fail: (err) => reject(new Error('manifest request failed: ' + (err && err.errMsg))),
    });
  });
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

function _getCachedVersion() {
  try {
    return wx.getStorageSync(CACHE_VERSION_KEY) || '';
  } catch (e) {
    return '';
  }
}

// 下载 PDF 到临时文件；onProgress(percent 0-100)。
function _downloadToTemp(url, onProgress) {
  return new Promise((resolve, reject) => {
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
  });
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

function _setCachedVersion(v) {
  try { wx.setStorageSync(CACHE_VERSION_KEY, v); } catch (e) { /* ignore */ }
}

module.exports = { fetchHardwarePdf };
