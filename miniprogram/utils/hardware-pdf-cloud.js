// 五金/尺寸参考 PDF：从腾讯云 COS 拉取，本地缓存 + 版本对比。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

const MANIFEST_URL = 'https://hardware-fit-1439937513.cos.ap-shanghai.myqcloud.com/hardware-pdf/manifest.json';
const CACHE_FILE_NAME = 'hardware-pdf.pdf';
const CACHE_VERSION_KEY = 'hardwarePdfCachedVersion';

let _pendingPromise = null;

function fetchHardwarePdf() {
  if (_pendingPromise) return _pendingPromise;
  _pendingPromise = _run().finally(() => { _pendingPromise = null; });
  return _pendingPromise;
}

async function _run() {
  let manifest;
  try {
    manifest = await _fetchManifest();
  } catch (err) {
    console.warn('[hardware-pdf-cloud] manifest fetch failed:', err.message);
    if (_isCachedFileExists()) {
      return _cachedPdfPath();
    }
    throw err;
  }

  const cachedVersion = _getCachedVersion();
  if (manifest.version === cachedVersion && _isCachedFileExists()) {
    return _cachedPdfPath();
  }

  // Task 3 实现下载
  throw new Error('download not implemented yet; version=' + manifest.version + ' cached=' + cachedVersion);
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

module.exports = { fetchHardwarePdf };
