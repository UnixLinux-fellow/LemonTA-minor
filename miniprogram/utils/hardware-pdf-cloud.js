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
  throw new Error('not implemented');
}

module.exports = { fetchHardwarePdf };
