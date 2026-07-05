// 柜体 GLB 云存储 → 本地缓存镜像同步器。
// - onLaunch 时调用 syncOnLaunch()：不阻塞启动，后台跑 diff + 下载/删除
// - 3D 页调用 await onManifestReady()：有本地 manifest 立即 resolve；无则等首次全量下完
// - picker 用 listModels() 拿已缓存柜型；renderer 用 getLocalPath() 拿本地文件路径
// - renderer 首次拿不到 path 时用兜底 Box，并订阅 onModelReady(subdir, name, cb) 做 hot-replace
//
// 单例：模块 top-level 状态；wx 环境安全（require 立即返回，懒初始化）；Node 环境无副作用。

const diff = require('./model-sync-diff.js');
const cloud = require('./cloud.js');

const ROOT_DIRNAME = 'cabinet-model';
const MANIFEST_NAME = 'manifest.json';
const SUBDIRS = ['50cm', '100cm', 'zj'];
const MAX_CONCURRENT_DOWNLOADS = 3;

// ---- 单例状态 ----
let _manifest = null;                   // { version, syncedAt, models: [...] }
let _manifestReady = false;             // 是否有过至少一份可用 manifest
let _manifestReadyPromise = null;       // onManifestReady 等待队列
let _manifestReadyResolve = null;
let _manifestReadyReject = null;
let _manifestReadyError = null;         // sticky failure: reject later subscribers
let _syncPromise = null;                // syncOnLaunch 去重
let _downloadPromises = {};             // fileID -> Promise，同 fileID 并发下载去重
let _listeners = {};                    // key -> [cb, cb, ...]

// ---- 平台适配 ----
function isWx() {
  return typeof wx !== 'undefined' && wx.getFileSystemManager;
}
function rootDir() {
  return wx.env.USER_DATA_PATH + '/' + ROOT_DIRNAME;
}
function subdirPath(subdir) {
  return rootDir() + '/' + subdir;
}
function localFilePath(entry) {
  return subdirPath(entry.subdir) + '/' + entry.name;
}
function manifestPath() {
  return rootDir() + '/' + MANIFEST_NAME;
}
function key(entry) {
  return entry.subdir + '/' + entry.name;
}

// ---- IO：目录 / 清单读写 ----
function ensureDirsSync() {
  if (!isWx()) return;
  const fs = wx.getFileSystemManager();
  // 微信 USER_DATA_PATH (http://usr) 本身已存在——不需要 recursive；
  // 且 recursive:true 尝试创建 http://usr 时会抛无 errMsg 的错，触发误报警。
  // 顺序建：rootDir 的父 = USER_DATA_PATH（已存在）；subdirs 的父 = rootDir（上一步建）。
  const mk = (p) => {
    try { fs.accessSync(p); return; } catch (e) { /* 不存在，继续建 */ }
    try {
      fs.mkdirSync(p);
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || String(e);
      if (/exist|already/i.test(msg)) return;
      console.warn('[model-sync] mkdir fail', p, msg);
    }
  };
  mk(rootDir());
  SUBDIRS.forEach((s) => mk(subdirPath(s)));
}

function readManifestSync() {
  if (!isWx()) return null;
  const fs = wx.getFileSystemManager();
  try {
    const buf = fs.readFileSync(manifestPath(), 'utf8');
    return JSON.parse(buf);
  } catch (e) {
    return null;
  }
}

function writeManifestSync(m) {
  if (!isWx()) return;
  const fs = wx.getFileSystemManager();
  try {
    fs.writeFileSync(manifestPath(), JSON.stringify(m), 'utf8');
  } catch (e) {
    console.warn('[model-sync] write manifest fail', e && e.errMsg);
  }
}

function deleteFileSync(p) {
  if (!isWx()) return;
  const fs = wx.getFileSystemManager();
  try { fs.unlinkSync(p); } catch (e) { /* 不存在即已完成 */ }
}

// ---- 云 → HTTPS 临时 URL ----
function _resolveHttpsURL(fileID) {
  return new Promise((resolve, reject) => {
    if (!isWx() || !wx.cloud || !wx.cloud.getTempFileURL) {
      reject(new Error('temp_url_fail'));
      return;
    }
    wx.cloud.getTempFileURL({ fileList: [fileID] }).then((res) => {
      const item = res && res.fileList && res.fileList[0];
      const url = item && item.tempFileURL;
      if (!url) {
        console.warn('[model-sync] getTempFileURL empty', fileID, item && item.errMsg);
        reject(new Error('temp_url_empty'));
        return;
      }
      resolve(url);
    }).catch((err) => {
      console.warn('[model-sync] getTempFileURL fail', fileID, err && err.errMsg);
      reject(new Error('temp_url_fail'));
    });
  });
}

function _downloadHttpsToTemp(url) {
  return new Promise((resolve, reject) => {
    if (!isWx() || !wx.downloadFile) {
      reject(new Error('download_fail'));
      return;
    }
    wx.downloadFile({
      url: url,
      success: (res) => {
        if (res && res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath);
        } else {
          const code = res && res.statusCode;
          console.warn('[model-sync] downloadFile bad status', url, code);
          reject(new Error('http_' + (code || 'unknown')));
        }
      },
      fail: (err) => {
        console.warn('[model-sync] downloadFile fail', url, err && err.errMsg);
        reject(new Error('download_fail'));
      },
    });
  });
}

// ---- 下载单文件（tempFile → .download → 原子 rename → 最终 path）----
function downloadOne(entry) {
  const target = localFilePath(entry);
  const tempName = target + '.download';
  const dlKey = entry.fileID;
  if (_downloadPromises[dlKey]) return _downloadPromises[dlKey];
  const promise = _resolveHttpsURL(entry.fileID)
    .then((url) => _downloadHttpsToTemp(url))
    .then((tempFilePath) => new Promise((resolve) => {
      const fs = wx.getFileSystemManager();
      fs.saveFile({
        tempFilePath: tempFilePath,
        filePath: tempName,
        success: () => {
          try { deleteFileSync(target); } catch (e) { /* ignore */ }
          try {
            fs.renameSync(tempName, target);
            resolve({ ok: true, path: target });
          } catch (e) {
            console.warn('[model-sync] rename fail', tempName, '→', target, e && e.errMsg);
            resolve({ ok: false, err: 'rename_fail' });
          }
        },
        fail: (err) => {
          console.warn('[model-sync] saveFile fail', target, err && err.errMsg);
          resolve({ ok: false, err: (err && err.errMsg) || 'save_fail' });
        },
      });
    }))
    .catch((err) => ({ ok: false, err: (err && err.message) || 'unknown' }));
  _downloadPromises[dlKey] = promise;
  promise.then(() => { delete _downloadPromises[dlKey]; });
  return promise;
}

// ---- 事件订阅 ----
function emitReady(subdir, name) {
  const k = subdir + '/' + name;
  const arr = _listeners[k] || [];
  arr.slice().forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } });
}

function onModelReady(subdir, name, cb) {
  const k = subdir + '/' + name;
  if (!_listeners[k]) _listeners[k] = [];
  _listeners[k].push(cb);
  return function unsubscribe() {
    _listeners[k] = (_listeners[k] || []).filter((f) => f !== cb);
  };
}

// ---- 下载调度：并发受限 ----
function runDownloadQueue(queue) {
  return new Promise((resolveAll) => {
    if (!queue.length) return resolveAll();
    let idx = 0;
    let inFlight = 0;
    let done = 0;
    const total = queue.length;
    const step = () => {
      while (inFlight < MAX_CONCURRENT_DOWNLOADS && idx < total) {
        const entry = queue[idx++];
        inFlight++;
        // 下载 pending 版本时用 pending fileID；否则用当前 fileID
        const targetFileID = entry.pending ? entry.pending.fileID : entry.fileID;
        const targetMd5 = entry.pending ? entry.pending.md5 : entry.md5;
        const targetSize = entry.pending ? entry.pending.size : entry.size;
        const dlEntry = {
          subdir: entry.subdir,
          name: entry.name,
          fileID: targetFileID,
        };
        downloadOne(dlEntry).then((res) => {
          inFlight--;
          done++;
          if (res.ok) {
            // 找 manifest 里同 key 条目，提升 pending → 主字段
            const k = key(entry);
            const arr = (_manifest && _manifest.models) || [];
            for (let i = 0; i < arr.length; i++) {
              if (key(arr[i]) === k) {
                arr[i].md5 = targetMd5;
                arr[i].fileID = targetFileID;
                arr[i].size = targetSize;
                arr[i].downloaded = true;
                arr[i].downloadedAt = Date.now();
                arr[i].pending = null;
                break;
              }
            }
            writeManifestSync(_manifest);
            emitReady(entry.subdir, entry.name);
          }
          if (done === total) resolveAll();
          else step();
        });
      }
    };
    step();
  });
}

// ---- syncOnLaunch ----
function syncOnLaunch() {
  if (_syncPromise) return _syncPromise;
  if (!isWx()) {
    // Node/测试环境：no-op resolve
    _manifestReady = true;
    _syncPromise = Promise.resolve({ added: [], updated: [], removed: [], kept: [] });
    return _syncPromise;
  }
  _syncPromise = (async () => {
    try {
      ensureDirsSync();
      const local = readManifestSync();
      _manifest = local || { version: 1, syncedAt: 0, models: [] };
      // 有本地 manifest 且有已下载模型 → 立即标记 ready（后台继续跑）
      if (local && Array.isArray(local.models) && local.models.some((m) => m.downloaded)) {
        markReady();
      }

      let remoteResp = null;
      try {
        const resp = await cloud.listCabinetModels();
        if (resp && resp.ok && resp.data && resp.data.success) {
          remoteResp = resp.data;
        }
      } catch (e) {
        console.warn('[model-sync] cloud call throw', e);
      }
      if (!remoteResp) {
        // 云函数失败：有 local 兜底；无 local 则 reject ready
        if (!_manifestReady) markReadyFail(new Error('no_manifest'));
        return { added: [], updated: [], removed: [], kept: (_manifest.models || []).slice() };
      }

      const d = diff.diff(_manifest.models || [], remoteResp.models || []);
      // 立即写新 manifest（不含 removed；updated 带 pending）
      _manifest = diff.buildManifest(d, Date.now());
      writeManifestSync(_manifest);
      // 删除 removed 文件
      d.removed.forEach((r) => deleteFileSync(localFilePath(r)));

      // 若首次仍未 ready，且此时 kept + updated 中至少有一个已下载 → 也标记 ready
      if (!_manifestReady) {
        const anyDownloaded = _manifest.models.some((m) => m.downloaded);
        if (anyDownloaded) markReady();
      }

      // 并发下载 added + updated
      const queue = [].concat(d.added, d.updated);
      await runDownloadQueue(queue);

      if (!_manifestReady) {
        // 全量下完仍未 ready：如果 manifest 非空则 ready；否则 reject
        const anyDownloaded = _manifest.models.some((m) => m.downloaded);
        if (anyDownloaded) markReady();
        else markReadyFail(new Error('no_models_available'));
      }
      return d;
    } catch (e) {
      console.warn('[model-sync] syncOnLaunch fail', e);
      if (!_manifestReady) markReadyFail(e);
      return { added: [], updated: [], removed: [], kept: [] };
    }
  })();
  return _syncPromise;
}

function markReady() {
  _manifestReady = true;
  if (_manifestReadyResolve) { _manifestReadyResolve(); _manifestReadyResolve = null; _manifestReadyReject = null; }
}
function markReadyFail(err) {
  _manifestReadyError = err || new Error('manifest_unavailable');
  if (_manifestReadyReject) { _manifestReadyReject(_manifestReadyError); _manifestReadyResolve = null; _manifestReadyReject = null; }
}

function onManifestReady() {
  if (_manifestReady) return Promise.resolve();
  if (_manifestReadyError) return Promise.reject(_manifestReadyError);
  if (_manifestReadyPromise) return _manifestReadyPromise;
  _manifestReadyPromise = new Promise((resolve, reject) => {
    _manifestReadyResolve = resolve;
    _manifestReadyReject = reject;
  });
  return _manifestReadyPromise;
}

// ---- 对外查询 ----
// 为避免循环依赖（cabinet-model.js 会 require model-sync.js），这里内联最小柜型解析
function parseName(name) {
  const base = name.replace(/\.glb$/i, '');
  const short = base.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/);
  if (short) {
    const w = parseInt(short[1], 10);
    const codeRaw = short[2].toLowerCase();
    return { w, code: codeRaw };
  }
  // Y-110-230 / YG-110-230G1 / Z-110-230 / ZG-110-230G1
  const parts = base.split('-');
  if (parts.length >= 3) {
    const head = parts[0];
    const code = head.toLowerCase();
    return { w: parseInt(parts[1], 10) || 110, code };
  }
  return null;
}
function inferKind(subdir, code) {
  if (subdir === 'zj') {
    if (code === 'yg' || code === 'zg') return 'corner-raise';
    return 'corner';
  }
  if (/^g/.test(code)) return 'raise';
  return 'standard';
}

function listModels() {
  if (!_manifest) return [];
  const out = [];
  _manifest.models.forEach((m) => {
    if (!m.downloaded) return;
    const p = parseName(m.name);
    if (!p) return;
    out.push({
      subdir: m.subdir,
      name: m.name,
      w: p.w,
      code: p.code,
      kind: inferKind(m.subdir, p.code),
      localPath: localFilePath(m),
    });
  });
  return out;
}

function getLocalPath(target) {
  if (!_manifest) return null;
  for (let i = 0; i < _manifest.models.length; i++) {
    const m = _manifest.models[i];
    if (m.subdir === target.subdir && m.name === target.name && m.downloaded) {
      return localFilePath(m);
    }
  }
  return null;
}

module.exports = {
  syncOnLaunch,
  onManifestReady,
  listModels,
  getLocalPath,
  onModelReady,
  _getManifest: () => _manifest,
  // 内部实现，仅用于测试
  downloadOne,
  _resolveHttpsURL,
  _downloadHttpsToTemp,
};
