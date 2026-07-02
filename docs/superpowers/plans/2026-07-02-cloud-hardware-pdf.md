# 五金/尺寸 PDF 云端下载 + 本地缓存 + 版本对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小程序里 "导出五金/尺寸" 从 canvas + jsPDF 实时生成，改为从腾讯云 COS 下载预制 PDF，本地缓存并做版本对比。

**Architecture:** 新增 `miniprogram/utils/hardware-pdf-cloud.js`，对外仅暴露 `fetchHardwarePdf()`，内部三步：拉 manifest.json → 对比版本 → 命中缓存直接返回本地路径 / 未命中就 `wx.downloadFile` 并覆盖缓存文件。调用方 `plan-list/index.js` 拿到路径后 `wx.openDocument`。

**Tech Stack:** 微信小程序原生 API（`wx.request` / `wx.downloadFile` / `wx.getFileSystemManager` / `wx.getStorageSync` / `wx.openDocument`），无新增依赖；腾讯云 COS 公有读桶。

**Spec:** `docs/superpowers/specs/2026-07-02-cloud-hardware-pdf-design.md`

---

## File Structure

**Create:**
- `miniprogram/utils/hardware-pdf-cloud.js` — 新模块，唯一暴露 `fetchHardwarePdf()`。内部三块职责：manifest 拉取、缓存检查/写入、下载执行。约 150 行以内。

**Modify:**
- `miniprogram/pages/plan-list/index.js` — 替换 `require`，简化按钮回调，删除命名弹窗相关状态和回调。
- `miniprogram/pages/plan-list/index.wxml` — 删除第二个 `<filename-input-modal>`。

**Delete（Task 5 里统一处理）:**
- `miniprogram/utils/hardware-pdf-exporter.js`（整个文件）
- `miniprogram/cabinet/utils/cabinet-hardware/`（下面所有图片，前提是 grep 确认无别处引用）

**Not touched:**
- `miniprogram/vendor/jspdf.min.js`（`utils/pdf-exporter.js` 还在用）
- `miniprogram/utils/pdf-exporter.js`
- `<canvas id="pdf-canvas">` 及 `getPdfCanvas`（导出方案信息还在用）

---

## Task 1: 准备 COS 域名并新建 hardware-pdf-cloud.js 骨架

**Files:**
- Create: `miniprogram/utils/hardware-pdf-cloud.js`

**Prerequisite（由用户提供）：**
- 腾讯云 COS 桶名 + 地区 → 组成 `<bucket>.cos.<region>.myqcloud.com`
- 上传两个文件到 COS：
  - `hardware-pdf/manifest.json`，内容如：
    ```json
    { "version": "2026-07-02-1", "url": "https://<bucket>.cos.<region>.myqcloud.com/hardware-pdf/五金尺寸参考.pdf" }
    ```
  - `hardware-pdf/五金尺寸参考.pdf`
- 存储桶或 `hardware-pdf/` 前缀设为**公有读**
- 微信小程序管理后台把 COS 域名同时加入 **request 合法域名** 和 **downloadFile 合法域名**

- [ ] **Step 1: 从用户拿到 COS 域名，写入模块顶部常量**

Create `miniprogram/utils/hardware-pdf-cloud.js` with:

```js
// 五金/尺寸参考 PDF：从腾讯云 COS 拉取，本地缓存 + 版本对比。
// 对外仅暴露 fetchHardwarePdf()，返回本地 PDF 文件路径的 Promise。

// TODO(填域名)：把 <bucket>.cos.<region>.myqcloud.com 换成实际 COS 域名
const MANIFEST_URL = 'https://<bucket>.cos.<region>.myqcloud.com/hardware-pdf/manifest.json';
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
```

把 `<bucket>.cos.<region>.myqcloud.com` 替换为真实域名后再进入后续 Task。

- [ ] **Step 2: 手动验证：小程序开发者工具里 require 这个模块不报错**

微信开发者工具打开项目，在 `plan-list/index.js` 顶部临时加一行：
```js
const _testCloud = require('../../utils/hardware-pdf-cloud.js');
console.log('cloud module loaded', typeof _testCloud.fetchHardwarePdf);
```
编译无报错、控制台看到 `cloud module loaded function`。测完删掉这两行。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/utils/hardware-pdf-cloud.js
git commit -m "feat(hardware-pdf-cloud): 新建云端 PDF 拉取模块骨架"
```

---

## Task 2: 实现 manifest 拉取 + 缓存命中判定（不含真实下载）

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-cloud.js`

**目标：** 拉 manifest；若云端 version === 本地 cachedVersion 且缓存文件存在，返回本地路径；否则暂时抛"需下载"标记（Task 3 实现下载）。

- [ ] **Step 1: 添加 manifest 拉取 helper**

Append to `miniprogram/utils/hardware-pdf-cloud.js`:

```js
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
```

- [ ] **Step 2: 添加缓存文件路径 helper 和存在性检查**

Append:

```js
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
```

- [ ] **Step 3: 实现 `_run` 的判定分支（下载路径先抛错占位）**

Replace the existing `_run` stub:

```js
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
```

- [ ] **Step 4: 手动验证 manifest 拉取正常**

前提：Task 1 已经上传了 manifest.json 到 COS。

在 `plan-list/index.js` 里临时加：
```js
const _cloud = require('../../utils/hardware-pdf-cloud.js');
_cloud.fetchHardwarePdf()
  .then((p) => console.log('OK:', p))
  .catch((err) => console.warn('EXPECTED FAIL:', err.message));
```
在 `onShow` 或 `onLoad` 里执行一次。控制台应该看到：
- 首次：`EXPECTED FAIL: download not implemented yet; version=2026-07-02-1 cached=`
- 表示 manifest 拉到了、判定分支走对了

测完删除临时代码。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/hardware-pdf-cloud.js
git commit -m "feat(hardware-pdf-cloud): manifest 拉取与缓存命中判定"
```

---

## Task 3: 实现下载 + 写缓存

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-cloud.js`

- [ ] **Step 1: 添加下载 helper**

Append to `miniprogram/utils/hardware-pdf-cloud.js`:

```js
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
    // 覆盖：先删旧文件（不存在时忽略），再复制
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
```

- [ ] **Step 2: 让 `fetchHardwarePdf` 接受进度回调，替换 `_run` 里的占位错误**

Replace the current `fetchHardwarePdf` function and `_run` function:

```js
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

  try {
    const tempPath = await _downloadToTemp(manifest.url, onProgress);
    const dest = await _persistToCache(tempPath);
    _setCachedVersion(manifest.version);
    return dest;
  } catch (err) {
    console.warn('[hardware-pdf-cloud] download failed:', err.message);
    if (_isCachedFileExists()) {
      wx.showToast({ title: '更新失败，已打开本地版本', icon: 'none', duration: 2000 });
      return _cachedPdfPath();
    }
    throw err;
  }
}
```

- [ ] **Step 3: 手动验证首次下载**

前提：微信开发者工具 → 清缓存 → 清 Storage & 清文件缓存。

临时在 `plan-list/index.js` 的 `onLoad` 里加：
```js
const _cloud = require('../../utils/hardware-pdf-cloud.js');
_cloud.fetchHardwarePdf({ onProgress: (p) => console.log('progress:', p) })
  .then((path) => console.log('DONE:', path))
  .catch((err) => console.error('FAIL:', err.message));
```

预期控制台看到：
- 若干条 `progress: NN`
- `DONE: http://usr/hardware-pdf.pdf` 或类似 USER_DATA_PATH

再次进入页面（不清缓存）：不应看到 progress，直接 `DONE:` —— 命中缓存。

测完删除临时代码。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/hardware-pdf-cloud.js
git commit -m "feat(hardware-pdf-cloud): 下载并写入本地缓存"
```

---

## Task 4: 接入 plan-list 页面按钮

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js`
- Modify: `miniprogram/pages/plan-list/index.wxml`

- [ ] **Step 1: 修改 index.js —— 换 require，删除命名弹窗状态与回调，重写按钮处理**

Read `miniprogram/pages/plan-list/index.js` first, then apply these edits:

替换顶部的 `require` 行（第 4 行）:
```js
const hardwarePdfExporter = require('../../utils/hardware-pdf-exporter.js');
```
改为：
```js
const hardwarePdfCloud = require('../../utils/hardware-pdf-cloud.js');
```

从 `data` 里删除 `hardwareExportNameOpen: false,`。

删除以下方法（约第 138–172 行）：
- `onTapExportHardware`
- `onHardwareExportNameCancel`
- `onHardwareExportNameConfirm`

新增一个新的 `onTapExportHardware`：
```js
  onTapExportHardware() {
    wx.showLoading({ title: '正在下载文档…', mask: true });
    hardwarePdfCloud
      .fetchHardwarePdf({
        onProgress: (p) => wx.showLoading({ title: '正在下载 ' + p + '%', mask: true }),
      })
      .then((filePath) => {
        wx.hideLoading();
        wx.openDocument({
          filePath,
          fileType: 'pdf',
          showMenu: true,
          fail: (err) => {
            wx.showModal({
              title: '预览失败',
              content: 'PDF 已下载到 ' + filePath + '\n错误: ' + (err && err.errMsg),
              showCancel: false,
            });
          },
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('[plan-list] fetchHardwarePdf failed:', err);
        wx.showModal({
          title: '下载失败',
          content: '请检查网络后重试',
          showCancel: false,
        });
      });
  },
```

- [ ] **Step 2: 修改 index.wxml —— 删除第二个 filename-input-modal**

删除以下块（当前在第 60–65 行）：
```xml
  <filename-input-modal
    visible="{{hardwareExportNameOpen}}"
    defaultValue="五金尺寸参考.pdf"
    bind:cancel="onHardwareExportNameCancel"
    bind:confirm="onHardwareExportNameConfirm">
  </filename-input-modal>
```

- [ ] **Step 3: 手动验证按钮完整流程**

微信开发者工具，清缓存 → 打开小程序 → 方案列表页 → 点 `导出五金/尺寸`：

- **首次点击（缓存为空）**：Loading 显示"正在下载 N%"进度，完成后弹出 PDF 预览
- **再次点击**：无 loading（或极短），直接弹 PDF 预览（命中缓存）
- **飞行模式（有缓存）**：静默降级，直接弹 PDF 预览
- **飞行模式（清缓存后首次）**：弹窗"下载失败，请检查网络"

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/plan-list/index.js miniprogram/pages/plan-list/index.wxml
git commit -m "feat(plan-list): 五金/尺寸导出改为云端拉取"
```

---

## Task 5: 清理不再使用的文件

**Files:**
- Delete: `miniprogram/utils/hardware-pdf-exporter.js`
- Delete: `miniprogram/cabinet/utils/cabinet-hardware/`（子目录及所有图片）—— **仅在 grep 确认无其它引用后**

- [ ] **Step 1: 确认 hardware-pdf-exporter.js 无其它引用**

Run: `grep -rn "hardware-pdf-exporter" miniprogram --include="*.js" --include="*.json" --include="*.wxml"`
Expected: 无输出（Task 4 之前唯一的引用已经被替换掉）

如果有输出：STOP，把那些引用也改掉再继续。

- [ ] **Step 2: 确认 cabinet-hardware 图片无其它引用**

Run: `grep -rn "cabinet-hardware" miniprogram --include="*.js" --include="*.json" --include="*.wxml" --include="*.wxss"`
Expected: 无输出

如果有输出：STOP，先解决那些引用再继续。

- [ ] **Step 3: 删除文件**

```bash
git rm miniprogram/utils/hardware-pdf-exporter.js
git rm -r miniprogram/cabinet/utils/cabinet-hardware/
```

- [ ] **Step 4: 手动回归验证**

微信开发者工具重新编译，走完 Task 4 的手动验证清单，确认：
- `导出方案信息` 按钮仍然正常（使用 canvas + jsPDF）
- `导出五金/尺寸` 按钮仍然正常（云端下载）
- 编译无报错、控制台无 404

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: 删除已废弃的本地五金 PDF 生成器与图片资源"
```

---

## Task 6: 手动全流程验收 + 推送

- [ ] **Step 1: 覆盖 spec 里"测试要点"6 条**

对照 spec `docs/superpowers/specs/2026-07-02-cloud-hardware-pdf-design.md` §测试要点，逐条走：

1. 首次点击（清缓存后）：下载 → 打开成功 ✓
2. 立即再点：无 loading，直接打开 ✓
3. COS 上改 `version` 字段：再点，触发下载并覆盖缓存 ✓
4. 关小程序、飞行模式再点：
   - 有缓存 → 打开旧缓存 ✓
   - 无缓存 → 报错弹窗 ✓
5. 连点两次按钮：只发一次 downloadFile（并发保护，看 network 面板）✓
6. COS 上删掉 PDF、留 manifest：downloadFile 失败 → 有缓存降级 / 无缓存报错 ✓

- [ ] **Step 2: 推送到 GitHub**

```bash
git push
```

---

## Self-Review 结果

**1. Spec coverage** —
- §云端资源布局 → Task 1 前置说明
- §数据流 → Task 2 + Task 3
- §错误处理三张表 → Task 3 的 `_run` catch 分支 + Task 4 的按钮 catch
- §并发保护 → Task 1 的 `_pendingPromise`
- §影响到的现有代码（修改/删除/保留）→ Task 4 + Task 5
- §测试要点 6 条 → Task 6 逐条覆盖

**2. Placeholder scan** —
- `<bucket>.cos.<region>.myqcloud.com` 是 Task 1 Step 1 里明确要求用户先替换的具体值，不是隐式 TBD

**3. Type consistency** —
- `fetchHardwarePdf(options)` 在 Task 3 引入 options.onProgress；Task 4 用同名字段调用，一致
- `_cachedPdfPath()` / `_isCachedFileExists()` / `_getCachedVersion()` / `_setCachedVersion()` 命名前后一致
- `CACHE_FILE_NAME` / `CACHE_VERSION_KEY` / `MANIFEST_URL` 常量在多处使用，无重命名
