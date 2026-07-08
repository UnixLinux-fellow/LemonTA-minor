# 柜体 GLB 模型云存储化 与 本地缓存同步 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 21 个 GLB 柜体模型从主包移到微信云存储 `cabinet-model/{50cm,100cm,zj}/`，小程序启动时对账并镜像同步到 USER_DATA_PATH 本地缓存，picker/renderer 从云端动态发现柜型，新增/删除/内容变更全部支持 hot-replace。

**Architecture:** 三层职责隔离：云函数 `listCabinetModels`（列目录 + md5）→ `model-sync.js`（唯一 diff/下载/缓存入口）→ picker 与 renderer（委托 model-sync 查路径）。纯 diff 逻辑抽到 `model-sync-diff.js` 走 Node TDD；wx 专属 IO 部分靠手动验证清单核对。

**Tech Stack:** 微信小程序 · wx.cloud + `@cloudbase/manager-node`（云函数侧）· threejs-miniprogram · Node 自制断言 runner（`tests/run.js`）

**Spec:** `docs/superpowers/specs/2026-07-05-cabinet-model-cloud-sync-design.md`

---

## 上线前置条件（在开始前完成，或在 Task 2 完成后立即完成）

1. **云存储上传**：将现有 `miniprogram/cabinet/utils/cabinet-model/` 下 21 个 glb 按下表上传到微信云存储 `cabinet-model/{50cm|100cm|zj}/`：

   | 子目录 | 文件 |
   |--------|------|
   | 50cm/ | 50A.glb, 50B.glb, 50C.glb, 50D.glb, 50G1.glb, 50G2.glb |
   | 100cm/ | 100A.glb, 100B.glb, 100C.glb, 100D.glb, 100G1.glb, 100G2.glb, 100H.glb, 100K.glb, 100L.glb |
   | zj/ | Y-110-230.glb, Z-110-230.glb, YG-110-230G1.glb, YG-110-230G2.glb, ZG-110-230G1.glb, ZG-110-230G2.glb |

2. **验证云存储可访问**：在微信开发者工具的云开发控制台 → 存储 → 手动确认三个目录内文件齐全

---

## 文件结构

**新建：**
- `miniprogram/cabinet/utils/model-sync-diff.js` — 纯 diff 函数（Node 可测）
- `miniprogram/cabinet/utils/model-sync.js` — 单例同步器（wx IO）

**修改：**
- `cloudfunctions/quickstartFunctions/index.js` — 新增 `listCabinetModels` case
- `cloudfunctions/quickstartFunctions/package.json` — 新增 `@cloudbase/manager-node` 依赖
- `miniprogram/utils/cloud.js` — 导出 `listCabinetModels`
- `miniprogram/cabinet/utils/cabinet-model.js` — `localModels` 委托 model-sync，删除 fileExists/LOCAL_MODEL_DIR/localPath
- `miniprogram/cabinet/utils/three-renderer.js` — `_resolveModelPath` 委托 sync；`_readGlb` 兼容 wxfile；`_loadItemMesh`/`renderSingle` 兜底 Box + hot-replace
- `miniprogram/app.js` — onLaunch 里 kick off `syncOnLaunch`
- `miniprogram/cabinet/pages/design/index.js` — onLoad 里 `await onManifestReady`
- `tests/run.js` — 修改 cabinet-model 测试；新增 model-sync-diff 用例

**删除：**
- `miniprogram/cabinet/utils/cabinet-model/*.glb`（21 个文件）
- `miniprogram/cabinet/utils/cabinet-model/`（空目录）

---

## Task 1: 纯 diff 逻辑与测试

**Files:**
- Create: `miniprogram/cabinet/utils/model-sync-diff.js`
- Modify: `tests/run.js` — 添加 diff 用例

**说明**：把 sync 的核心业务规则（对账 local vs remote 生成 added/updated/removed/kept，构造下一份 manifest）抽成纯函数，避免依赖 wx API。剩下的 IO 部分（downloadFile、saveFile、readFile 等）在下一个 task 用它。

- [ ] **Step 1.1: 添加 diff 用例到 tests/run.js（先失败）**

在 `tests/run.js` 顶部 `require` 段追加：

```js
const modelSyncDiff = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/model-sync-diff.js'));
```

在 `// ---- model ----` 组之前插入新组：

```js
// ---- model-sync-diff ----
group('model-sync-diff.diff 首次同步（local 为空）', () => {
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
    { subdir: 'zj',   name: 'Y-110-230.glb', fileID: 'cloud://y', md5: 'yy', size: 200 },
  ];
  const r = modelSyncDiff.diff([], remote);
  eq(r.added.map((m) => m.name), ['50A.glb', 'Y-110-230.glb'], 'added 全部');
  eq(r.updated.length, 0, 'updated 空');
  eq(r.removed.length, 0, 'removed 空');
  eq(r.kept.length, 0, 'kept 空');
});

group('model-sync-diff.diff md5 未变 → kept', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.kept.length, 1, 'kept 1');
  eq(r.kept[0].downloaded, true, 'kept 保留 downloaded 字段');
  eq(r.added.length, 0, 'added 空');
  eq(r.updated.length, 0, 'updated 空');
  eq(r.removed.length, 0, 'removed 空');
});

group('model-sync-diff.diff md5 变更 → updated 带 pending', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a2', md5: 'bb', size: 110 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.updated.length, 1, 'updated 1');
  eq(r.updated[0].md5, 'aa', '旧 md5 保留');
  eq(r.updated[0].pending.md5, 'bb', 'pending 保留新 md5');
  eq(r.updated[0].pending.fileID, 'cloud://a2', 'pending 保留新 fileID');
  eq(r.updated[0].downloaded, true, '旧文件仍可用');
});

group('model-sync-diff.diff 云上删除 → removed', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
    { subdir: '50cm', name: '50B.glb', fileID: 'cloud://b', md5: 'bb', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.removed.map((m) => m.name), ['50B.glb'], 'removed = [50B]');
  eq(r.kept.map((m) => m.name), ['50A.glb'], 'kept = [50A]');
});

group('model-sync-diff.buildManifest 首次全 added', () => {
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const diff = modelSyncDiff.diff([], remote);
  const m = modelSyncDiff.buildManifest(diff, 1720000000000);
  eq(m.version, 1, 'version=1');
  eq(m.syncedAt, 1720000000000, 'syncedAt 写入');
  eq(m.models.length, 1, 'models 1');
  eq(m.models[0].downloaded, false, 'added 未下载');
  eq(m.models[0].pending, null, 'added 无 pending');
});

group('model-sync-diff.buildManifest updated 保留旧值 + pending', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a2', md5: 'bb', size: 110 },
  ];
  const diff = modelSyncDiff.diff(local, remote);
  const m = modelSyncDiff.buildManifest(diff, 2);
  eq(m.models[0].md5, 'aa', '主字段仍是旧 md5');
  eq(m.models[0].fileID, 'cloud://a1', '主字段仍是旧 fileID');
  eq(m.models[0].downloaded, true, '主字段 downloaded=true');
  eq(m.models[0].pending.md5, 'bb', 'pending 新 md5');
  eq(m.models[0].pending.fileID, 'cloud://a2', 'pending 新 fileID');
});
```

- [ ] **Step 1.2: 运行测试验证失败**

Run: `node tests/run.js`
Expected: `Cannot find module '.../model-sync-diff.js'`（模块尚未创建）

- [ ] **Step 1.3: 创建 model-sync-diff.js 最小实现**

Create `miniprogram/cabinet/utils/model-sync-diff.js`：

```js
// 纯 diff 函数：对比 local 与 remote manifest 数组，产出 added/updated/removed/kept，
// 以及基于 diff 与当前时间戳构造下一版 manifest。不依赖任何 wx / node fs API。
// 供 Node 单测与 wx 运行时共用。

// 唯一 key = `${subdir}/${name}`
function key(entry) {
  return entry.subdir + '/' + entry.name;
}

// 输入：
//   local  - 上一次持久化到 manifest.json 的 models 数组（可能带 downloaded/downloadedAt/pending）
//   remote - 云函数 listCabinetModels 返回的清单（只含 subdir/name/fileID/md5/size）
// 输出：{ added, updated, removed, kept }
//   added   - remote 有本地无：新柜型
//   updated - remote 与 local 同 key 但 md5 不同：内容变更；条目保留旧 md5/fileID/downloaded/downloadedAt
//             并挂 pending: { md5, fileID }
//   removed - local 有 remote 无：需要删除本地文件与 manifest 条目
//   kept    - md5 相同：完全保留旧条目
function diff(local, remote) {
  const localMap = {};
  local.forEach((m) => { localMap[key(m)] = m; });
  const remoteMap = {};
  remote.forEach((m) => { remoteMap[key(m)] = m; });

  const added = [];
  const updated = [];
  const kept = [];
  const removed = [];

  remote.forEach((r) => {
    const l = localMap[key(r)];
    if (!l) {
      added.push({
        subdir: r.subdir,
        name: r.name,
        fileID: r.fileID,
        md5: r.md5,
        size: r.size,
        downloaded: false,
        downloadedAt: 0,
        pending: null,
      });
    } else if (l.md5 !== r.md5) {
      updated.push({
        subdir: l.subdir,
        name: l.name,
        fileID: l.fileID,
        md5: l.md5,
        size: l.size,
        downloaded: !!l.downloaded,
        downloadedAt: l.downloadedAt || 0,
        pending: { md5: r.md5, fileID: r.fileID, size: r.size },
      });
    } else {
      kept.push({
        subdir: l.subdir,
        name: l.name,
        fileID: l.fileID,
        md5: l.md5,
        size: l.size,
        downloaded: !!l.downloaded,
        downloadedAt: l.downloadedAt || 0,
        pending: l.pending || null,
      });
    }
  });

  local.forEach((l) => {
    if (!remoteMap[key(l)]) removed.push(l);
  });

  return { added, updated, kept, removed };
}

// 基于 diff 结果构造新 manifest（不含 removed 条目）。added/updated/kept 全量合并写入。
function buildManifest(diffResult, nowMs) {
  return {
    version: 1,
    syncedAt: nowMs,
    models: [].concat(diffResult.kept, diffResult.added, diffResult.updated),
  };
}

module.exports = { diff, buildManifest, key };
```

- [ ] **Step 1.4: 运行测试验证通过**

Run: `node tests/run.js`
Expected: 所有 `model-sync-diff.*` 组通过；总统计 passed 数增加、failed=0

- [ ] **Step 1.5: 提交**

```bash
git add miniprogram/cabinet/utils/model-sync-diff.js tests/run.js
git commit -m "feat(model-sync): pure diff logic with tests"
```

---

## Task 2: 云函数 listCabinetModels

**Files:**
- Modify: `cloudfunctions/quickstartFunctions/index.js`
- Modify: `cloudfunctions/quickstartFunctions/package.json`

**说明**：新增一条 case，用 `@cloudbase/manager-node` 列三个子目录返回文件清单。云函数改动不在 Node runner 内可测；此 task 通过部署后手动调用验证。

- [ ] **Step 2.1: 在 package.json 添加依赖**

Modify `cloudfunctions/quickstartFunctions/package.json` 的 `dependencies`：

```json
{
  "name": "quickstartFunctions",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "wx-server-sdk": "~2.4.0",
    "@cloudbase/manager-node": "^4.0.0"
  }
}
```

- [ ] **Step 2.2: 在 index.js 顶部 require CloudBase 与新增 handler**

Modify `cloudfunctions/quickstartFunctions/index.js`：

在 `const cloud = require("wx-server-sdk");` 下一行插入：

```js
const CloudBase = require("@cloudbase/manager-node");
```

在 `const requestDownload = async (event) => { ... }` 后追加新 handler：

```js
// 列 cabinet-model/{50cm,100cm,zj}/ 下全部 glb，供小程序做本地缓存对账
const listCabinetModels = async () => {
  const envId = cloud.DYNAMIC_CURRENT_ENV;
  const app = CloudBase.init({ envId });
  const subdirs = ["50cm", "100cm", "zj"];
  const models = [];
  for (const subdir of subdirs) {
    let files = [];
    try {
      files = await app.storage.listDirectoryFiles(`cabinet-model/${subdir}/`);
    } catch (e) {
      console.warn("[listCabinetModels] list fail", subdir, e && e.message);
      continue;
    }
    files.forEach((f) => {
      const key = f.Key || "";
      if (!/\.glb$/i.test(key)) return;
      const name = key.split("/").pop();
      models.push({
        subdir,
        name,
        fileID: `cloud://${envId}/${key}`,
        md5: String(f.ETag || "").replace(/^"|"$/g, ""),
        size: Number(f.Size) || 0,
      });
    });
  }
  return { success: true, models, serverTime: Date.now() };
};
```

在 `exports.main` 的 `switch` 中，`case "requestDownload":` 后追加：

```js
    case "listCabinetModels":
      return await listCabinetModels();
```

- [ ] **Step 2.3: 本地 install 依赖 + 上传部署**

在开发者工具中：右键 `cloudfunctions/quickstartFunctions` → "在外部终端打开" → 运行 `npm install` → 回到开发者工具右键该目录 → "上传并部署：云端安装依赖（不上传 node_modules）"

Expected: 云函数控制台看到 quickstartFunctions 版本号更新

- [ ] **Step 2.4: 手动测试云函数**

在开发者工具的"云开发 → 云函数 → quickstartFunctions → 云端调用"面板，输入：

```json
{ "type": "listCabinetModels" }
```

Expected: 返回 `{ success: true, models: [...], serverTime: <timestamp> }`，`models` 数组长度 = 21（21 个 glb），每条含 `subdir`, `name`, `fileID`, `md5`, `size`

如果返回 0 或部分：核对上线前置条件（云存储三个目录都有文件）

- [ ] **Step 2.5: 提交**

```bash
git add cloudfunctions/quickstartFunctions/index.js cloudfunctions/quickstartFunctions/package.json
git commit -m "feat(cf): listCabinetModels enumerates cabinet-model/{50cm,100cm,zj}"
```

---

## Task 3: cloud.js 增加 listCabinetModels 导出

**Files:**
- Modify: `miniprogram/utils/cloud.js`

- [ ] **Step 3.1: 在 module.exports 加一行**

Modify `miniprogram/utils/cloud.js` 的 `module.exports`：

```js
module.exports = {
  getOpenId: () => call('getOpenId'),
  getModelInfo: (localList) => call('getModelInfo', { localList }),
  savePlan: (plan) => call('savePlan', { plan }),
  saveMaterials: (planId, materials) => call('saveMaterials', { planId, materials }),
  listPlans: () => call('listPlans'),
  requestDownload: (planId) => call('requestDownload', { planId }),
  listCabinetModels: () => call('listCabinetModels'),
};
```

- [ ] **Step 3.2: 提交**

```bash
git add miniprogram/utils/cloud.js
git commit -m "feat(cloud): expose listCabinetModels binding"
```

---

## Task 4: model-sync.js 主模块

**Files:**
- Create: `miniprogram/cabinet/utils/model-sync.js`

**说明**：单例。所有 wx IO 集中在这里。全模块设计为：`require` 立即返回，第一次调用 `syncOnLaunch` 触发懒初始化。Node 测试环境 `require` 后不调用任何方法即可安全 import。

- [ ] **Step 4.1: 创建 model-sync.js**

Create `miniprogram/cabinet/utils/model-sync.js`：

```js
// 柜体 GLB 云存储 → 本地缓存镜像同步器。
// - onLaunch 时调用 syncOnLaunch()：不阻塞启动，后台跑 diff + 下载/删除
// - 3D 页调用 await onManifestReady()：有本地 manifest 立即 resolve；无则等首次全量下完
// - picker 用 listModels() 拿已缓存柜型；renderer 用 getLocalPath() 拿本地文件路径
// - renderer 首次拿不到 path 时用兜底 Box，并订阅 onModelReady(subdir, name, cb) 做 hot-replace
//
// 单例：模块 top-level 状态；wx 环境安全（require 立即返回，懒初始化）；Node 环境无副作用。

const diff = require('./model-sync-diff.js');
const cloud = require('../../utils/cloud.js');

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
let _syncPromise = null;                // syncOnLaunch 去重
let _downloadPromises = {};             // key -> Promise，同 fileID 并发下载去重
let _listeners = {};                    // key -> [cb, cb, ...]
let _initialized = false;

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
  const mk = (p) => {
    try { fs.mkdirSync(p, true); } catch (e) {
      if (!/exist/i.test(e && e.errMsg || '')) console.warn('[model-sync] mkdir', p, e && e.errMsg);
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

function fileExistsSync(p) {
  if (!isWx()) return false;
  const fs = wx.getFileSystemManager();
  try { fs.accessSync(p); return true; } catch (e) { return false; }
}

// ---- 下载单文件 ----
function downloadOne(entry) {
  const target = localFilePath(entry);
  const tempName = target + '.download';
  const dlKey = entry.fileID;
  if (_downloadPromises[dlKey]) return _downloadPromises[dlKey];
  const promise = new Promise((resolve) => {
    wx.cloud.downloadFile({ fileID: entry.fileID }).then((res) => {
      const src = res.tempFilePath;
      if (!src) { resolve({ ok: false, err: 'no_temp_path' }); return; }
      const fs = wx.getFileSystemManager();
      fs.saveFile({
        tempFilePath: src,
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
          resolve({ ok: false, err: err && err.errMsg });
        },
      });
    }).catch((err) => {
      console.warn('[model-sync] downloadFile fail', entry.fileID, err && err.errMsg);
      resolve({ ok: false, err: err && err.errMsg });
    });
  });
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
      // 有本地 manifest → 立即标记 ready（后台继续跑）
      if (local && Array.isArray(local.models) && local.models.length > 0) {
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
  if (_manifestReadyReject) { _manifestReadyReject(err); _manifestReadyResolve = null; _manifestReadyReject = null; }
}

function onManifestReady() {
  if (_manifestReady) return Promise.resolve();
  if (_manifestReadyPromise) return _manifestReadyPromise;
  _manifestReadyPromise = new Promise((resolve, reject) => {
    _manifestReadyResolve = resolve;
    _manifestReadyReject = reject;
  });
  return _manifestReadyPromise;
}

// ---- 对外查询 ----
// 复用 cabinet-model.parse 做柜型解析。为避免循环依赖，这里内联一个最小解析：
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
  // 测试/调试用（可选）
  _getManifest: () => _manifest,
};
```

- [ ] **Step 4.2: 提交**

```bash
git add miniprogram/cabinet/utils/model-sync.js
git commit -m "feat(model-sync): singleton sync module with wx cloud + local cache"
```

---

## Task 5: cabinet-model.js 委托 model-sync

**Files:**
- Modify: `miniprogram/cabinet/utils/cabinet-model.js`
- Modify: `tests/run.js` — 更新 cabinet-model 测试组

**说明**：`localModels` 改为查 model-sync；`fileExists` / `LOCAL_MODEL_DIR` / `localPath` / `makeModel` 删除。测试环境 model-sync 无 wx 时 listModels 返回空 → 测试改为 stub 直接注入。

- [ ] **Step 5.1: 先改 tests/run.js 里的 cabinet-model 组（预备 stub）**

Modify `tests/run.js` 里 `// ---- model ----` 组，替换为：

```js
// ---- model ----
group('cabinet-model.parse', () => {
  eq(model.parse('50A.glb'), { w: 50, h: 230, d: 600, code: 'a' }, '50A.glb 短命名');
  eq(model.parse('100G1.glb'), { w: 100, h: 300, d: 600, code: 'g1' }, '100G1.glb 加高短命名');
  eq(model.parse('50-230-600-a'), { w: 50, h: 230, d: 600, code: 'a' }, '完整命名解析');
});

group('cabinet-model.categorize 按 subdir 归类', () => {
  const all = [
    { subdir: '50cm', name: '50A.glb', w: 50, code: 'a', kind: 'standard' },
    { subdir: '100cm', name: '100A.glb', w: 100, code: 'a', kind: 'standard' },
    { subdir: '100cm', name: '100G1.glb', w: 100, code: 'g1', kind: 'raise' },
    { subdir: 'zj', name: 'Y-110-230.glb', w: 110, code: 'y', kind: 'corner' },
  ];
  const g = model.categorize(all);
  eq(g.s50.length, 1, 's50=1');
  eq(g.s100.length, 1, 's100=1');
  eq(g.raise.length, 1, 'raise=1');
  eq(g.corner.length, 1, 'corner=1');
});
```

- [ ] **Step 5.2: 运行测试验证失败**

Run: `node tests/run.js`
Expected: 新用例失败——`categorize` 需要按 subdir，但目前按 code 判断

- [ ] **Step 5.3: 修改 cabinet-model.js**

Modify `miniprogram/cabinet/utils/cabinet-model.js`：

替换整个文件为：

```js
// 衣柜模型命名解析与分类：{宽}{编码大写}.glb 短命名，或 {宽}-{高}-{深}-{编码}。
// 云存储上线后，模型清单来自 model-sync.listModels()（该模块懒 require 避免循环依赖）。
// 转角柜 Y/Z/YG/ZG 归入 zj 子目录，picker 侧按 subdir 分组。

const CODE_MAP = {
  a: '上下短衣区柜子',
  b: '上中长衣下开放格柜子',
  c: '上中长衣下抽屉柜子',
  d: '上短衣区中抽屉下抽拉层板柜子',
  e: '非标模块',
  f: '上短衣区下抽屉柜子',
  h: '上层板均分下抽屉柜子',
  i: '上中长衣左下抽屉右下层板柜子',
  j: '上短衣区下层板均分',
  k: '上层板均分下短衣区',
  l: '均为长衣区',
  g: '加高模块',
  SK: '收口条',
  y: '右侧转角柜',
  yg: '右侧转角柜加高模块',
  z: '左侧转角柜',
  zg: '左侧转角柜加高模块',
};

function defaultHeightForCode(code) {
  const lc = code.toLowerCase();
  if (lc.indexOf('g') === 0 || lc === 'yg' || lc === 'zg') return 300;
  if (lc === 'sk') return 230;
  return 230;
}

function parse(name) {
  const base = name.replace(/\.glb$/i, '');
  const shortMatch = base.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/);
  if (shortMatch) {
    const w = parseInt(shortMatch[1], 10);
    const codeRaw = shortMatch[2];
    return { w, h: defaultHeightForCode(codeRaw), d: 600, code: codeRaw.toLowerCase() };
  }
  const parts = base.split('-');
  if (parts.length >= 4) {
    return {
      w: parseInt(parts[0], 10),
      h: parseInt(parts[1], 10),
      d: parseInt(parts[2], 10),
      code: parts.slice(3).join('-'),
    };
  }
  return null;
}

function format({ w, h, d, code }) {
  return `${w}-${h}-${d}-${code}`;
}

function shortName({ w, code }) {
  return `${w}${code.toUpperCase()}.glb`;
}

// 已缓存到本地的柜型清单：委托给 model-sync。
// model-sync 在无 wx 环境（Node 测试）时返回空数组 → 测试直接构造数据传给 categorize。
function localModels() {
  const modelSync = require('./model-sync.js');
  return modelSync.listModels();
}

// 按 subdir 归类：50cm → s50，100cm → s100，zj → corner；code 以 g 开头的走 raise。
function categorize(models) {
  const out = { s50: [], s100: [], raise: [], corner: [], sk: [], other: [] };
  models.forEach((m) => {
    if (m.subdir === 'zj') {
      out.corner.push(m);
    } else if (m.subdir === '50cm') {
      if (/^g/.test(m.code || '')) out.raise.push(m);
      else out.s50.push(m);
    } else if (m.subdir === '100cm') {
      if (/^g/.test(m.code || '')) out.raise.push(m);
      else out.s100.push(m);
    } else if (m.code === 'SK' || m.code === 'sk') {
      out.sk.push(m);
    } else {
      out.other.push(m);
    }
  });
  return out;
}

module.exports = {
  CODE_MAP,
  parse,
  format,
  shortName,
  localModels,
  categorize,
};
```

- [ ] **Step 5.4: 运行测试验证通过**

Run: `node tests/run.js`
Expected: cabinet-model 与 model-sync-diff 组全部通过

- [ ] **Step 5.5: 提交**

```bash
git add miniprogram/cabinet/utils/cabinet-model.js tests/run.js
git commit -m "refactor(cabinet-model): delegate localModels to model-sync, categorize by subdir"
```

---

## Task 6: three-renderer.js — _resolveModelPath 委托 sync

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js:1080-1102`（`_resolveModelPath` 函数体）

- [ ] **Step 6.1: 替换 `_resolveModelPath` 与新增 `_resolveTarget`**

Modify `miniprogram/cabinet/utils/three-renderer.js`：

找到当前 `_resolveModelPath(it)` 函数体（第 1080 行开始），整段替换为：

```js
  // 把 it 归一化到 { subdir, name } —— hot-replace 订阅与 getLocalPath 都用它
  _resolveTarget(it) {
    const code = (it.code || '').toLowerCase();
    if (it.kind === 'standard' || it.kind === 'nonstandard') {
      const w = it.w >= 75 ? 100 : 50;
      let realCode = code;
      if (code === 'e1' || code === 'e2') realCode = 'a';
      const letter = realCode.charAt(0);
      return { subdir: w === 50 ? '50cm' : '100cm', name: `${w}${letter.toUpperCase()}.glb` };
    }
    if (it.kind === 'corner') {
      if (code === 'y') return { subdir: 'zj', name: 'Y-110-230.glb' };
      if (code === 'z') return { subdir: 'zj', name: 'Z-110-230.glb' };
      return null;
    }
    if (code === 'yg') return { subdir: 'zj', name: 'YG-110-230G1.glb' };
    if (code === 'zg') return { subdir: 'zj', name: 'ZG-110-230G1.glb' };
    if (code === 'g' || code === 'g1' || code === 'g2') {
      const w = it.w >= 75 ? 100 : 50;
      const variant = code === 'g2' ? 'G2' : 'G1';
      return { subdir: w === 50 ? '50cm' : '100cm', name: `${w}${variant}.glb` };
    }
    return null;
  }

  _resolveModelPath(it) {
    const target = this._resolveTarget(it);
    if (!target) return null;
    const modelSync = require('./model-sync.js');
    return modelSync.getLocalPath(target);
  }
```

- [ ] **Step 6.2: 提交**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "refactor(three-renderer): resolveModelPath queries model-sync"
```

---

## Task 7: three-renderer.js — _readGlb 兼容 wxfile 路径

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js:1167-1196`（`_readGlb` 函数体）

- [ ] **Step 7.1: 修改 `_readGlb`**

Modify `miniprogram/cabinet/utils/three-renderer.js` 的 `_readGlb`：

替换整段为：

```js
  // 优先用 wx.getFileSystemManager().readFile 读文件；
  // - 包内路径（不以 wxfile:// 或 USER_DATA_PATH 开头）失败时降级去掉前导 /
  // - USER_DATA_PATH / wxfile:// 路径不做降级
  // 模块级 buffer 缓存：同 path 跨 renderer 只读一次 disk。
  _readGlb(path) {
    if (GLB_BUFFER_CACHE[path]) {
      return Promise.resolve(GLB_BUFFER_CACHE[path]);
    }
    if (GLB_BUFFER_PROMISES[path]) {
      return GLB_BUFFER_PROMISES[path];
    }
    const userDataPrefix = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || '';
    const isUserData = (userDataPrefix && path.indexOf(userDataPrefix) === 0)
                    || path.indexOf('wxfile://') === 0;
    const promise = new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath: path,
        success: (res) => resolve(res.data),
        fail: (err) => {
          if (isUserData) {
            console.warn('[3D] readFile fail (userdata)', path, err && err.errMsg);
            return reject(err);
          }
          console.warn('[3D] readFile fail, try without leading slash', path, err && err.errMsg);
          fs.readFile({
            filePath: path.replace(/^\//, ''),
            success: (res) => resolve(res.data),
            fail: (err2) => reject(err2),
          });
        },
      });
    });
    GLB_BUFFER_PROMISES[path] = promise;
    promise.then(
      (buf) => { GLB_BUFFER_CACHE[path] = buf; delete GLB_BUFFER_PROMISES[path]; },
      () => { delete GLB_BUFFER_PROMISES[path]; }
    );
    return promise;
  }
```

- [ ] **Step 7.2: 提交**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "fix(three-renderer): readGlb supports USER_DATA_PATH / wxfile://"
```

---

## Task 8: three-renderer.js — hot-replace 兜底 Box 与运行时替换

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js` — `_loadItemMesh`, `renderSingle`, 新增 `_subscribeHotReplace`/`_replaceCabinet`/`_replacePreview`

- [ ] **Step 8.1: 在 `_loadItemMesh` 未命中 path 分支订阅 hot-replace**

Modify `miniprogram/cabinet/utils/three-renderer.js` 的 `_loadItemMesh(it)`：

找到 `const path = this._resolveModelPath(it);` 后紧接的 `if (!path) return Promise.resolve(this._fallbackBox(it));` 一行，替换为：

```js
    const path = this._resolveModelPath(it);
    if (!path) {
      this._subscribeHotReplace(it);
      return Promise.resolve(this._fallbackBox(it));
    }
```

（sk kind 分支不变。）

- [ ] **Step 8.2: 新增 `_subscribeHotReplace` / `_replaceCabinet` / `_replacePreview`**

在 three-renderer.js 里 `_loadItemMesh` 之前追加：

```js
  // 订阅同 target 的 ready 事件：download 完成后触发 hot-replace
  _subscribeHotReplace(it) {
    const target = this._resolveTarget(it);
    if (!target) return;
    const modelSync = require('./model-sync.js');
    let called = false;
    const unsub = modelSync.onModelReady(target.subdir, target.name, () => {
      if (called) return;
      called = true;
      unsub();
      // 清模块级/renderer 级缓存里的旧 buffer/scene，让下次 _loadItemMesh 真正重新 parse
      const stalePath = modelSync.getLocalPath(target);
      if (stalePath) {
        delete GLB_BUFFER_CACHE[stalePath];
        delete GLB_BUFFER_PROMISES[stalePath];
        if (this._loaderCache) delete this._loaderCache[stalePath];
      }
      // preview 与 room 走不同替换路径
      if (this._isPreview) this._replacePreview(it);
      else this._replaceCabinet(it);
    });
  }

  // 找到 room 场景里匹配 it 的柜体 group，重新加载 mesh，保留 group.position/rotation/scale
  _replaceCabinet(it) {
    if (!this._cabinets || !this._roomGroup) return;
    const match = this._cabinets.find((c) => c.item === it
      || (c.item && c.item.code === it.code && c.item.w === it.w
          && c.item.h === it.h && c.item.kind === it.kind));
    if (!match) return;
    const oldGroup = match.mesh;
    this._loadItemMesh(match.item).then((mesh) => {
      if (!mesh) return;
      const THREE = this.THREE;
      const wrap = new THREE.Group();
      wrap.add(mesh);
      // 复制原 group 的空间变换
      wrap.position.copy(oldGroup.position);
      wrap.rotation.copy(oldGroup.rotation);
      wrap.scale.copy(oldGroup.scale);
      // 重跑几何清洗 + 材质 + 边线（按 room 模式对应的 fit-scale 逻辑）
      const CABINET_DEPTH_CM = 60;
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const sx = size.x > 0.001 ? match.item.w / size.x : 1;
      const sy = size.y > 0.001 ? match.item.h / size.y : 1;
      const isCornerLike =
        match.item.kind === 'corner' ||
        (match.item.kind === 'raise' && (match.item.code === 'yg' || match.item.code === 'zg'));
      const targetDepth = isCornerLike ? 110 : CABINET_DEPTH_CM;
      const sz = size.z > 0.001 ? targetDepth / size.z : 1;
      mesh.scale.set(sx, sy, sz);
      const bbox2 = new THREE.Box3().setFromObject(mesh);
      mesh.position.y -= bbox2.min.y;
      mesh.position.x -= (bbox2.min.x + bbox2.max.x) / 2;
      mesh.position.z -= (bbox2.min.z + bbox2.max.z) / 2;
      wrap.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
      this._stripNonGeometryNodes(wrap);
      this._normalizeMaterials(wrap);
      this._applyMaterial(wrap, this._color, match.item);
      this._applyEdges(wrap);
      this._applyDoorVisibility(wrap);
      // 替换
      this._roomGroup.remove(oldGroup);
      this._roomGroup.add(wrap);
      match.mesh = wrap;
    });
  }

  // preview 模式：直接重跑 renderSingle
  _replacePreview(it) {
    if (!this._previewGroup) return;
    const child = this._previewGroup.children.find((g) => g.userData && g.userData._item === it);
    const colorId = this._color;
    // renderSingle 会先 _clearPreviewCabinet 再加载
    this.renderSingle(it, colorId);
  }
```

- [ ] **Step 8.3: 在 `renderSingle` 未命中 path 时也订阅 hot-replace**

Modify `miniprogram/cabinet/utils/three-renderer.js` 的 `renderSingle(item, colorId)` 靠前部分：

在 `const mesh = await this._loadItemMesh(item);` 之后加一段（用于识别当前是不是走了兜底 Box——`_loadItemMesh` 内部已经在 !path 时订阅过）。**不需要额外改动**：`_loadItemMesh` 里的 `_subscribeHotReplace(it)` 已经调用了 `this._isPreview` 分支走 `_replacePreview`。这一步保留原有 renderSingle 逻辑。仅确认无需修改。

- [ ] **Step 8.4: 提交**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(three-renderer): fallback Box + hot-replace on model-sync ready"
```

---

## Task 9: app.js 集成 syncOnLaunch

**Files:**
- Modify: `miniprogram/app.js:58-84`（`onLaunch`）

- [ ] **Step 9.1: 在 onLaunch 里 kick off 同步**

Modify `miniprogram/app.js` 的 `onLaunch`：

在现有 `wx.cloud.init(...)` 的 `try/catch` 之后、`var userInfo = wx.getStorageSync('userInfo');` 之前，插入：

```js
    // 柜体 GLB 模型云存储同步：不 await，后台跑
    try {
      var modelSync = require('./cabinet/utils/model-sync.js');
      modelSync.syncOnLaunch().catch(function (err) {
        console.warn('[model-sync] launch sync failed:', err);
      });
    } catch (e) {
      console.warn('[model-sync] init failed:', e);
    }
```

- [ ] **Step 9.2: 提交**

```bash
git add miniprogram/app.js
git commit -m "feat(app): kick off model-sync on launch"
```

---

## Task 10: design/index.js 集成 onManifestReady

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js:57-87`（`onLoad`）

- [ ] **Step 10.1: 改造 onLoad 为 async + await manifest**

Modify `miniprogram/cabinet/pages/design/index.js` 的 `onLoad`：

替换整个函数为：

```js
  async onLoad() {
    const plan = getApp().globalData.draftPlan;
    if (!plan) {
      wx.navigateBack();
      return;
    }
    const modelSync = require('../../utils/model-sync.js');
    try {
      await modelSync.onManifestReady();
    } catch (e) {
      console.warn('[design] manifest not ready', e);
      this.setData({ toast: '模型资源加载失败，请检查网络后重试' });
      // 不 return —— 允许 UI 显示错误提示，但下面仍尝试初始化（listModels 会返回空）
    }
    const allModels = cabinetModel.localModels();
    const grouped = cabinetModel.categorize(allModels);
    this._allModels = allModels;
    this._grouped = grouped;

    const state = layoutEngine.init({
      wall: plan.wall,
      cornerType: plan.cornerType,
      hasRaise: plan.hasRaise,
    });
    this._state = state;

    this.setData({
      plan,
      cornerLabel: CORNER_LABEL[plan.cornerType],
      modelList: grouped.s50,
      items: state.items,
      meta: state.meta,
      standardWidth: state.meta.standardWidth,
      standardUsed: state.meta.standardUsed,
      nonStandardWidth: state.meta.nonStandardWidth,
    }, () => {
      this._updateScrollIndicator();
    });
  },
```

- [ ] **Step 10.2: 提交**

```bash
git add miniprogram/cabinet/pages/design/index.js
git commit -m "feat(design): await model-sync manifest before initial render"
```

---

## Task 11: 删除包内 glb 与遗留代码

**Files:**
- Delete: `miniprogram/cabinet/utils/cabinet-model/*.glb`（21 个文件）
- Delete: `miniprogram/cabinet/utils/cabinet-model/`（空目录）

- [ ] **Step 11.1: 删除 21 个 glb 文件与空目录**

Run:

```bash
cd "D:/工程/柠檬塔/程序/LemonTA-minor"
rm miniprogram/cabinet/utils/cabinet-model/*.glb
rmdir miniprogram/cabinet/utils/cabinet-model
```

Expected: `ls miniprogram/cabinet/utils/cabinet-model 2>/dev/null` 无输出（目录不存在）

- [ ] **Step 11.2: 运行测试确认无遗留引用**

Run: `node tests/run.js`
Expected: 全部通过（cabinet-model 组不再依赖本地 glb；靠 stub 数据；model-sync 在 Node 环境 listModels 返回空，也 ok）

- [ ] **Step 11.3: 提交**

```bash
git add -A miniprogram/cabinet/utils/cabinet-model
git commit -m "chore: remove bundled cabinet-model glb (moved to cloud storage)"
```

---

## Task 12: 手动验证核对表

**说明**：所有代码改动完成后，按 spec 的手动验收清单逐条验证。任一条不通过则回到相应 task 修 bug。

- [ ] **Step 12.1: 云函数已部署**

在开发者工具"云开发 → 云函数"面板确认 `quickstartFunctions` 更新时间为最新一次 Task 2 部署。调用 `{ "type": "listCabinetModels" }` 返回 21 个模型。

- [ ] **Step 12.2: 首次全新安装场景**

清除小程序缓存（"清除模拟器数据 → 全部清除"），重新编译打开小程序：

Expected:
- 启动无阻塞，首页正常
- 进入 3D 页时，如果模型未下完：3D 画布出现空房间，柜体位置显示兜底白 Box，picker loading
- 模型逐个下完后：兜底 Box 被 hot-replace 为真实柜体；picker 逐个填入柜型
- console 有 `[model-sync]` 相关 log，无 error

- [ ] **Step 12.3: 有本地 manifest + 断网场景**

关掉 Task 12.2 后网络（开发者工具 → 网络 → 无网络），重新打开小程序：

Expected:
- 3D 页秒开
- picker 与断网前一致
- console 有 `cloud call throw` warn，但功能不受影响

- [ ] **Step 12.4: 云上上传新柜型 100M.glb（自动发现）**

准备一个测试用 100M.glb，上传到云存储 `cabinet-model/100cm/100M.glb`。重启小程序：

Expected:
- 下次进入 3D 页时 picker 100cm 分组多出 100M
- 选择 100M 后 renderer 正常加载

- [ ] **Step 12.5: 云上删除 100D.glb**

在云存储控制台删除 `cabinet-model/100cm/100D.glb`。重启小程序：

Expected:
- `${USER_DATA_PATH}/cabinet-model/100cm/100D.glb` 被删除（可通过 `wx.getFileSystemManager().accessSync` 在 console 手动确认）
- picker 100cm 分组不再显示 100D
- 已有含 100D 的设计再打开时该柜体位置 fallback Box

- [ ] **Step 12.6: 云上覆盖 100A.glb（md5 变更）**

准备一个内容不同的 100A.glb 覆盖上传到 `cabinet-model/100cm/100A.glb`。重启小程序：

Expected:
- 首次进入 3D 页时先看到旧 100A（因 downloaded=true）
- 后台 sync 完成 pending 下载 → hot-replace 触发 → 3D 场景里的 100A 无缝换成新模型
- 用户当前旋转/缩放角度保留

- [ ] **Step 12.7: 云函数抛异常场景**

暂时把云函数的 `subdirs` 改成 `["nonexistent"]` 后重新部署，重启小程序：

Expected:
- 有本地 manifest → 静默用本地兜底，picker/3D 正常
- 清缓存后再启动 → 3D 页显示 toast "模型资源加载失败..."

验证完恢复云函数为正确 `["50cm", "100cm", "zj"]`。

---

## 自审

**Spec coverage**：

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 云端目录约定 | Task 2（云函数枚举） |
| 同步策略：完全镜像 | Task 1（diff）+ Task 4（syncOnLaunch） |
| 云函数 `listCabinetModels` | Task 2 |
| `model-sync.js` 核心模块 | Task 1 + Task 4 |
| manifest.json 结构与 pending | Task 1（buildManifest）+ Task 4（runDownloadQueue 提升 pending） |
| `three-renderer.js` `_resolveModelPath` | Task 6 |
| `three-renderer.js` `_readGlb` | Task 7 |
| `three-renderer.js` hot-replace | Task 8 |
| `cabinet-model.js` 委托 sync | Task 5 |
| `app.js` onLaunch 集成 | Task 9 |
| 3D 页 onLoad 集成 | Task 10 |
| 测试策略：diff 单测 | Task 1 |
| 测试策略：cabinet-model stub 测试 | Task 5 |
| 手动验证清单 | Task 12 |
| 破坏性变更：删除包内 glb | Task 11 |

**类型一致性**：`_resolveTarget` (Task 6) 与 `_subscribeHotReplace` (Task 8) 都用 `{ subdir, name }`；`getLocalPath`（Task 4 model-sync.js）签名一致；`onModelReady(subdir, name, cb)` 三处签名一致；`listModels` 返回 `{ subdir, name, w, code, kind, localPath }`（Task 4）与 categorize 期望字段一致（Task 5 tests 用相同字段）；manifest 字段 `downloaded/downloadedAt/pending` 三处（Task 1 diff、Task 4 runDownloadQueue、Task 4 getLocalPath）一致。

**占位符扫描**：无 TBD/TODO；每一步的代码为完整块。
