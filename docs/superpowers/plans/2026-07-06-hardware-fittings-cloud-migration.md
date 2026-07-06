# 拆单规范 PDF 迁移到 GLB 存储桶 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"导出拆单规范"按钮的下载源从旧 COS 直链切换到与 GLB 模型共用的存储桶，用云函数 + md5 对比取代 manifest.json。

**Architecture:** 云函数新增 `listHardwareFittings` 分支，对齐 `listCabinetModels` 的结构；客户端 `hardware-pdf-cloud.js` 改造为"调云函数 → 找目标文件 → md5 对比 → 走 `wx.cloud.getTempFileURL` + `wx.downloadFile`"两步下载。缓存策略与降级路径保持不变。

**Tech Stack:** 微信小程序云开发 (wx-server-sdk + @cloudbase/manager-node)，微信 JS SDK (wx.cloud.getTempFileURL / wx.downloadFile / wx.getFileSystemManager)。

**Spec reference:** `docs/superpowers/specs/2026-07-06-hardware-fittings-cloud-migration-design.md`

**Testing note:** 小程序侧无 Jest 覆盖 `hardware-pdf-cloud.js`，本改造不加自动化测试；使用 Task 4 的手动验证清单代替。云函数侧同样无覆盖。

---

## 文件结构

**改动 3 个文件**：

- `cloudfunctions/quickstartFunctions/index.js` — 新增 `listHardwareFittings` 函数 + switch case
- `miniprogram/utils/cloud.js` — 新增一行 `listHardwareFittings` 封装
- `miniprogram/utils/hardware-pdf-cloud.js` — 全文重写核心逻辑

---

## Task 1：云函数新增 `listHardwareFittings` 分支

**Files:**
- Modify: `cloudfunctions/quickstartFunctions/index.js`（在 `listCabinetModels` 函数下方新增函数；在 `exports.main` switch 里新增 case）

- [ ] **Step 1: 打开 `cloudfunctions/quickstartFunctions/index.js`，定位到 `listCabinetModels` 函数末尾（行 214，`};` 之后）**

参照 `listCabinetModels`（行 178-214）的写法，在其正下方插入 `listHardwareFittings`。

- [ ] **Step 2: 插入 `listHardwareFittings` 函数**

在 `const listCabinetModels = async () => { ... };`（行 214 收尾）之后、`exports.main = ...`（行 216）之前插入：

```js
// 列 hardware-fittings/ 下的 PDF 文件，供小程序拆单规范下载做本地缓存对账
// 目前实际只有一份 split-order-spec.pdf，但仍返回数组以对齐 listCabinetModels 的结构
const listHardwareFittings = async () => {
  const envId = cloud.getWXContext().ENV;
  const app = CloudBase.init({ envId });
  let files = [];
  try {
    files = await app.storage.listDirectoryFiles("hardware-fittings/");
  } catch (e) {
    console.warn("[listHardwareFittings] list fail", e && e.message);
    return { success: false, errMsg: e && e.message, files: [], serverTime: Date.now() };
  }
  const items = [];
  files.forEach((f) => {
    const key = f.Key || "";
    if (!/\.pdf$/i.test(key)) return;
    const name = key.split("/").pop();
    items.push({
      name,
      fileID: app.storage.cloudPathToFileId(key),
      md5: String(f.ETag || "").replace(/^"|"$/g, ""),
      size: Number(f.Size) || 0,
    });
  });
  return { success: true, files: items, serverTime: Date.now() };
};
```

- [ ] **Step 3: 在 `exports.main` switch 里新增 case**

定位到 `case "listCabinetModels":`（原行 242-243），在其下方新增：

```js
    case "listHardwareFittings":
      return await listHardwareFittings();
```

- [ ] **Step 4: 语法自检**

运行：
```bash
node --check cloudfunctions/quickstartFunctions/index.js
```

Expected: 无输出（表示语法正确）；若有 SyntaxError，按报错信息修复。

- [ ] **Step 5: 部署云函数**

云函数变更需要**用户在微信开发者工具里手动上传并部署 `quickstartFunctions`**。这一步在开发者工具里操作：右键 `cloudfunctions/quickstartFunctions` → "上传并部署：云端安装依赖"（约 30-60 秒）。

在实施日志里记录："云函数已上传部署" 后方可进入后续任务。

- [ ] **Step 6: Commit**

```bash
git add cloudfunctions/quickstartFunctions/index.js
git commit -m "feat(cloud): 新增 listHardwareFittings 云函数分支，列 hardware-fittings/ 下 PDF"
```

---

## Task 2：客户端 `cloud.js` 新增封装

**Files:**
- Modify: `miniprogram/utils/cloud.js`（在 `listCabinetModels` 那一行下方追加一行）

- [ ] **Step 1: 打开 `miniprogram/utils/cloud.js`，定位到 `listCabinetModels` 行（当前行 31）**

当前 module.exports 长这样：

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

- [ ] **Step 2: 在 `listCabinetModels` 那一行下方新增一行**

改成：

```js
module.exports = {
  getOpenId: () => call('getOpenId'),
  getModelInfo: (localList) => call('getModelInfo', { localList }),
  savePlan: (plan) => call('savePlan', { plan }),
  saveMaterials: (planId, materials) => call('saveMaterials', { planId, materials }),
  listPlans: () => call('listPlans'),
  requestDownload: (planId) => call('requestDownload', { planId }),
  listCabinetModels: () => call('listCabinetModels'),
  listHardwareFittings: () => call('listHardwareFittings'),
};
```

- [ ] **Step 3: 语法自检**

运行：
```bash
node --check miniprogram/utils/cloud.js
```

Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/cloud.js
git commit -m "feat(cloud-wrap): 新增 listHardwareFittings 客户端封装"
```

---

## Task 3：改造 `hardware-pdf-cloud.js`

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-cloud.js`（全文重写核心逻辑）

- [ ] **Step 1: 全文替换 `miniprogram/utils/hardware-pdf-cloud.js` 为新版本**

用以下内容整体替换现有文件（现有文件共 125 行，改造后约 145 行）：

```js
// 拆单规范 PDF：与 GLB 模型共用存储桶，路径 hardware-fittings/split-order-spec.pdf。
// 通过云函数 listHardwareFittings 拿远端 md5，客户端本地缓存 + md5 对比避免重复下载。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

const cloud = require('./cloud.js');

const SPEC_FILE_NAME = 'split-order-spec.pdf';
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

// 调云函数拿 hardware-fittings/ 下 SPEC_FILE_NAME 的 { md5, fileID }
function _fetchRemoteSpec() {
  return cloud.listHardwareFittings().then((resp) => {
    if (!resp || !resp.ok || !resp.data || !resp.data.success) {
      throw new Error('list_fittings_fail');
    }
    const list = resp.data.files || [];
    const item = list.find((x) => x && x.name === SPEC_FILE_NAME);
    if (!item || !item.fileID || !item.md5) {
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
        reject(new Error('temp_url_empty'));
        return;
      }
      resolve(url);
    }).catch(() => reject(new Error('temp_url_fail')));
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
```

- [ ] **Step 2: 语法自检**

运行：
```bash
node --check miniprogram/utils/hardware-pdf-cloud.js
```

Expected: 无输出。

- [ ] **Step 3: 双向搜索确认没有遗留引用**

运行：
```bash
grep -rn "hardwarePdfCachedVersion" miniprogram/ cloudfunctions/quickstartFunctions/index.js
grep -rn "MANIFEST_URL\|_fetchManifest\|hardware-pdf/manifest.json" miniprogram/
```

Expected:
- 第一条：应无输出（旧 storage key 已在 `hardware-pdf-cloud.js` 里作为 `LEGACY_VERSION_KEY` 常量清理，别处不应再出现）——**唯一允许出现的地方是 `hardware-pdf-cloud.js` 里的 `LEGACY_VERSION_KEY = 'hardwarePdfCachedVersion'`**；若出现在别处，说明有遗留引用需要处理
- 第二条：应无输出（旧 manifest URL 与相关函数已删除）

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/hardware-pdf-cloud.js
git commit -m "refactor(hardware-pdf-cloud): 迁移到 GLB 存储桶，用云函数 + md5 替代 manifest"
```

---

## Task 4：手动验证

**Files:**
- 无代码改动，仅在开发者工具里操作

**前置**：确认 Task 1 的云函数已在开发者工具里"上传并部署"，云端存储桶 `hardware-fittings/` 下已存在 `split-order-spec.pdf`。

- [ ] **Step 1: 清缓存首次点击 — 验证下载路径**

在开发者工具菜单："工具 → 清除缓存 → 全部清除"，重启小程序进入方案列表页 → 点"导出拆单规范"。

Expected:
- 有 loading："正在下载文档…" → "正在下载 XX%"
- PDF 打开成功
- 控制台 Console 里能看到 `callFunction` 请求 `listHardwareFittings` 返回 `success: true, files: [{ name: 'split-order-spec.pdf', ... }]`

- [ ] **Step 2: 立即再点 — 验证缓存命中**

在同一次会话里再点一次"导出拆单规范"。

Expected:
- 不出现下载 loading 或一闪而过（走的是 `list` → `md5 相同 → 直接返回缓存`）
- PDF 直接打开

- [ ] **Step 3: 旧 storage key 清理验证**

清缓存后重启小程序，进入方案列表页；在开发者工具 Console 里执行：
```js
wx.setStorageSync('hardwarePdfCachedVersion', 'legacy-test')
```
然后点"导出拆单规范"完成一次下载。再在 Console 里执行：
```js
wx.getStorageSync('hardwarePdfCachedVersion')
```

Expected: 返回空字符串或 undefined（`_cleanupLegacyKey` 已把它清掉）。

同时确认新 key 已设置：
```js
wx.getStorageSync('hardwarePdfCachedMd5')
```
Expected: 一段 32 位十六进制字符串（ETag/MD5）。

- [ ] **Step 4: 云端替换 PDF — 验证 md5 触发重新下载**

在腾讯云控制台把 `hardware-fittings/split-order-spec.pdf` 替换成另一份内容不同的 PDF（哪怕改一个像素后重新导出上传也行）。回到小程序再点"导出拆单规范"。

Expected:
- 触发下载（有 loading）
- 打开的是新版本 PDF
- Console 里 `wx.getStorageSync('hardwarePdfCachedMd5')` 值已更新

- [ ] **Step 5: 飞行模式 — 验证降级**

在开发者工具里开启"模拟无网络"（或手机上开飞行模式），点"导出拆单规范"。

Expected（有缓存）：
- 无 loading，直接打开旧缓存 PDF
- Console 有 `list_fittings_fail` 或云函数调用失败的 warning

清缓存后再试一次（无缓存）：
Expected：
- 弹 "下载失败" modal（`plan-list/index.js:177-181` 的现有 catch 生效）

- [ ] **Step 6: 连点两次 — 验证 `_pendingPromise` 去重**

点"导出拆单规范"后立刻再点一次（下载进行中）。

Expected:
- Network 面板只有一次 `callFunction` + 一次 `downloadFile` 请求
- 两次点击最终都打开同一个 PDF

- [ ] **Step 7: 云端删掉 PDF — 验证 spec_not_found 降级**

腾讯云控制台里临时把 `hardware-fittings/split-order-spec.pdf` 移到其他目录。回到小程序清缓存后点"导出拆单规范"。

Expected:
- 弹 "下载失败" modal
- Console 有 `spec_not_found` 报错

**验证完毕后把 PDF 移回 `hardware-fittings/` 目录。**

- [ ] **Step 8: 验证结果记录**

在实施日志里勾选上述 7 项手动验证均通过；若任何一项未通过，回到对应 Task 修复后重跑。

---

## Self-Review

**Spec coverage check**（对照 `docs/superpowers/specs/2026-07-06-hardware-fittings-cloud-migration-design.md`）：

- ✓ 云函数新增 `listHardwareFittings` → Task 1
- ✓ 客户端 `cloud.js` 封装 → Task 2
- ✓ `hardware-pdf-cloud.js` 改造（删 MANIFEST/version、新增 md5 对比、两步下载、旧 key 清理）→ Task 3
- ✓ `SPEC_FILE_NAME`、`CACHE_MD5_KEY`、`LEGACY_VERSION_KEY` 常量 → Task 3 Step 1
- ✓ 三层兜底策略保留 → Task 3 的 `_run` 实现里三处 `_isCachedFileExists()` 分支
- ✓ `_pendingPromise` 去重保留 → Task 3 Step 1 顶部 `fetchHardwarePdf`
- ✓ 手动验证清单 7 项 → Task 4

**Placeholder scan**：无 TBD / TODO / "适当处理" / 未定义的类型或函数。

**Type consistency**：
- 云函数返回 `{ success, files: [{ name, fileID, md5, size }], serverTime }` — Task 1 定义、Task 3 消费一致
- 客户端 `cloud.listHardwareFittings()` 返回 `{ ok, data: <上述结构> }`（由 `cloud.js` 的 `call` 包装）— Task 3 里 `_fetchRemoteSpec` 检查 `resp.ok && resp.data && resp.data.success` 一致
- 常量名 `SPEC_FILE_NAME`、`CACHE_MD5_KEY`、`LEGACY_VERSION_KEY`、`CACHE_FILE_NAME` 在 Task 3 内部使用一致
