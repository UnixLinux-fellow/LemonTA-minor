// utils/bg-cache.js
// 背景图 T1 / T2 / T3 的云存储 preload + 磁盘缓存索引。
// 策略与 option-images 完全一致: 委托给 utils/img-cache.js (LRU 100 项 / 30MB 磁盘),
// 只是给外部提供"按 name (T1/T2/T3) 同步取本地路径"的糖 API。
//
// 消费方: components/bg-image (每个页面的背景图组件)。

const imgCache = require('./img-cache.js');

const CDN_BASE = 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/claw-assets/bg';
const NAMES = ['T1', 'T2', 'T3'];

// Map<name, localPath>; preload 完成后填充
const _paths = { T1: '', T2: '', T3: '' };

function fileIdOf(name) {
  return CDN_BASE + '/' + name + '.jpg';
}

// 启动时并行 resolve 三张背景图 → 本地磁盘路径缓存。
// 与 bootstrap.ensureUiDescReady 一样 fire-and-forget, 不阻塞其他启动流程。
function preloadAll() {
  return Promise.all(NAMES.map((name) => {
    return imgCache.resolve(fileIdOf(name))
      .then((path) => { _paths[name] = path || ''; })
      .catch((e) => {
        console.warn('[bg-cache] resolve fail', name, e && (e.errMsg || e.message));
      });
  }));
}

// 同步取: 缓存命中返回本地路径, 未命中返回空串。
function getPath(name) {
  return _paths[name] || '';
}

// 同步取带 fallback: 缓存命中用本地路径, miss 回退到 cloud fileID
// (WeChat <image> 原生支持 cloud:// 协议, 相当于走 WeChat 内建缓存, 保证冷启动不空白)。
function getPathOrCloud(name) {
  return _paths[name] || fileIdOf(name);
}

module.exports = { preloadAll, getPath, getPathOrCloud, fileIdOf };
