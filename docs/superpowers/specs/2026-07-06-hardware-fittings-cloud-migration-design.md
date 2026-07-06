# 拆单规范 PDF 迁移到 GLB 存储桶 设计方案

日期：2026-07-06
状态：待实施

## 背景

`导出拆单规范`按钮（`miniprogram/pages/plan-list/index.js:154` 的 `onTapExportHardware`）当前由 `miniprogram/utils/hardware-pdf-cloud.js` 提供实现：从固定域名 `hardware-fit-1439937513.cos.ap-shanghai.myqcloud.com` 拉 `hardware-pdf/manifest.json`，用 `manifest.version` 做版本对比，再按 `manifest.url` 下载 PDF。

现在 PDF 已迁移到与 GLB 模型共用的存储桶，路径 `hardware-fittings/`。新桶下**不再放** `manifest.json`——版本信息完全由云端文件的 ETag 提供，对比逻辑复用 GLB 模型的一套（`model-sync.js` + `model-sync-diff.js` + 云函数 `listCabinetModels`）。

## 目标

- 拆单规范 PDF 的下载源从旧的 COS 直链切换到与 GLB 共用的存储桶
- 版本对比机制与 GLB 一致：云函数用 `listDirectoryFiles` 拿 ETag，客户端本地缓存 md5 做对比
- 云端不再需要维护 `manifest.json`
- 三层兜底策略保持不变：远端拿不到 → 本地缓存；下载失败 → 本地缓存 + toast
- `fetchHardwarePdf()` 对外签名保持不变，`plan-list` 页无需改动

## 非目标

- 不改造 GLB 模型同步机制
- 不做多 PDF 管理（`hardware-fittings/` 下当前仅一份 PDF）
- 不迁移旧 COS 桶上的资源（旧桶资源本次改造后即弃用）
- 不做后台预热

## 架构总览

```
plan-list/index.js
     │  onTapExportHardware()
     ▼
hardware-pdf-cloud.js         ← 改造：切换下载源，用 md5 做版本对比
     │  fetchHardwarePdf()  →  Promise<localFilePath>
     ▼
cloud.js                       ← 新增：listHardwareFittings()
     │  wx.cloud.callFunction('quickstartFunctions', { type: 'listHardwareFittings' })
     ▼
quickstartFunctions/index.js   ← 新增：listHardwareFittings 分支
     │  app.storage.listDirectoryFiles('hardware-fittings/')
     ▼
腾讯云 COS （与 GLB 共用桶）
     └── hardware-fittings/
          └── split-order-spec.pdf
```

## 云端资源布局

与 GLB 模型共用的存储桶，前缀目录 `hardware-fittings/`：

```
hardware-fittings/split-order-spec.pdf     拆单规范主文件
```

**不放 `manifest.json`**。所有元信息（fileID、md5、size）由云函数动态从 `listDirectoryFiles` 返回。

命名说明：`split-order-spec.pdf` 是客户端硬编码约定的文件名，云端上传时须使用该确切名字。之所以约定英文短名——与 GLB 那边的英文命名风格一致，避免中文 key 在 `cloudPathToFileId` / `getTempFileURL` 环节的 encoding 隐患。

## 云函数改动

### 新增分支：`listHardwareFittings`

在 `cloudfunctions/quickstartFunctions/index.js` 增加，形态与现有 `listCabinetModels`（同文件 L178-L214）完全对齐：

```js
const listHardwareFittings = async () => {
  const envId = cloud.getWXContext().ENV;
  const app = CloudBase.init({ envId });
  let files = [];
  try {
    files = await app.storage.listDirectoryFiles('hardware-fittings/');
  } catch (e) {
    console.warn('[listHardwareFittings] list fail', e && e.message);
    return { success: false, errMsg: e && e.message, files: [], serverTime: Date.now() };
  }
  const items = [];
  files.forEach((f) => {
    const key = f.Key || '';
    if (!/\.pdf$/i.test(key)) return;
    const name = key.split('/').pop();
    items.push({
      name,
      fileID: app.storage.cloudPathToFileId(key),
      md5: String(f.ETag || '').replace(/^"|"$/g, ''),
      size: Number(f.Size) || 0,
    });
  });
  return { success: true, files: items, serverTime: Date.now() };
};
```

在 `exports.main` 的 switch 里新增：

```js
case 'listHardwareFittings':
  return await listHardwareFittings();
```

### 返回结构选型

尽管当前只关心一个文件，仍然返回数组 `files[]`——理由：
1. 与 `listCabinetModels` 保持结构一致，云函数分支之间可读
2. 未来 `hardware-fittings/` 下若新增 PDF，云函数不用改，仅客户端改文件名常量即可

### 云函数 node_modules

`cloudfunctions/quickstartFunctions/` 已包含 `@cloudbase/node-sdk`（`listCabinetModels` 在用），本次不新增依赖。

## 客户端改动

### `miniprogram/utils/cloud.js`

新增一行封装：

```js
listHardwareFittings: () => call('listHardwareFittings'),
```

### `miniprogram/utils/hardware-pdf-cloud.js` 改造

**保留不变**：

- 对外 API：`module.exports = { fetchHardwarePdf }`
- 本地文件名常量：`CACHE_FILE_NAME = 'hardware-pdf.pdf'`（`USER_DATA_PATH/hardware-pdf.pdf`）
- 模块级 `_pendingPromise` 去重
- 三层兜底：远端失败/下载失败时的本地缓存降级
- `_isCachedFileExists` / `_cachedPdfPath` / `_persistToCache` 工具函数

**删除**：

- `MANIFEST_URL` 常量
- `CACHE_VERSION_KEY = 'hardwarePdfCachedVersion'` 常量
- `_fetchManifest()`
- `_getCachedVersion()` / `_setCachedVersion(v)`

**新增**：

```js
const cloud = require('./cloud.js');   // 顶层 require，与 model-sync.js:10 一致

const SPEC_FILE_NAME = 'split-order-spec.pdf';
const CACHE_MD5_KEY = 'hardwarePdfCachedMd5';
const LEGACY_VERSION_KEY = 'hardwarePdfCachedVersion';

// 旧 key 一次性清理，避免遗留占用 storage
let _legacyCleaned = false;
function _cleanupLegacyKey() {
  if (_legacyCleaned) return;
  _legacyCleaned = true;
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) {
      wx.removeStorageSync(LEGACY_VERSION_KEY);
    }
  } catch (e) { /* ignore */ }
}

function _getCachedMd5() {
  try { return wx.getStorageSync(CACHE_MD5_KEY) || ''; } catch (e) { return ''; }
}

function _setCachedMd5(md5) {
  try { wx.setStorageSync(CACHE_MD5_KEY, md5); } catch (e) { /* ignore */ }
}

// 从云函数拿远端 spec 的 { md5, fileID }
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
      const url = res && res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
      if (!url) { reject(new Error('temp_url_empty')); return; }
      resolve(url);
    }).catch(() => reject(new Error('temp_url_fail')));
  });
}
```

`_downloadToTemp` 改造为两步式（先解析 tempFileURL，再 downloadFile）：

```js
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
```

`_run(onProgress)` 主流程调整：

```js
async function _run(onProgress) {
  _cleanupLegacyKey();

  let spec;
  try {
    spec = await _fetchRemoteSpec();
  } catch (err) {
    if (_isCachedFileExists()) return _cachedPdfPath();
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
```

### 数据流

```
fetchHardwarePdf():
  0. 首次调用清理旧 storage key 'hardwarePdfCachedVersion'
  1. cloud.listHardwareFittings()
     ├─ 成功 → 在数组里找 name === 'split-order-spec.pdf'
     │       → 拿到 { md5, fileID }
     │   2. 读 cachedMd5 与本地 PDF 是否存在
     │      ├─ md5 相同 且缓存文件在
     │      │    → 返回本地路径（无下载）
     │      └─ 否
     │          3. wx.cloud.getTempFileURL(fileID) → https URL
     │             4. wx.downloadFile(url) → tempFilePath
     │                ├─ 成功
     │                │    5. 复制到 USER_DATA_PATH/hardware-pdf.pdf
     │                │    6. wx.setStorageSync('hardwarePdfCachedMd5', md5)
     │                │    7. 返回本地路径
     │                └─ 失败
     │                    → 有旧缓存：toast '更新失败，已打开本地版本'，返回旧缓存
     │                    → 无旧缓存：throw
     └─ 失败（云函数挂 / 找不到 spec 文件）
         → 有旧缓存：沉默降级，返回旧缓存
         → 无旧缓存：throw
```

## 错误处理

| 场景 | 有旧缓存 | 无旧缓存 |
|---|---|---|
| 云函数调用失败 | 沉默降级，返回旧缓存 | throw → `plan-list/index.js` 已有的 catch 弹"下载失败" |
| 云函数返回 `success: false` | 同上 | 同上 |
| 数组里没找到 `split-order-spec.pdf` | 同上 | 同上 |
| `getTempFileURL` 失败 | toast + 旧缓存 | throw |
| `downloadFile` 失败/非 200 | toast + 旧缓存 | throw |
| `openDocument` 失败 | 由 `plan-list/index.js:167-171` 已有的 modal 处理 | 同 |

**降级原则**：只要本地有可用缓存，就不让用户看到错误页。

**并发保护**：`_pendingPromise` 逻辑不变。

## 影响到的现有代码

### 修改

- `cloudfunctions/quickstartFunctions/index.js`：新增 `listHardwareFittings` 函数与 switch case
- `miniprogram/utils/cloud.js`：新增一行 `listHardwareFittings` 封装
- `miniprogram/utils/hardware-pdf-cloud.js`：按上述改造

### 保留不动

- `miniprogram/pages/plan-list/index.js` 的 `onTapExportHardware`：`fetchHardwarePdf()` 签名不变
- 微信管理后台的域名合法列表：改造后仅走 `wx.cloud.callFunction` 与 `wx.cloud.getTempFileURL`（拿到的 tempFileURL 域名是 CloudBase 系，且 `wx.downloadFile` 对 CloudBase 临时 URL 无需在合法域名列表中登记）；不再依赖旧 COS 桶域名，但**旧域名条目可以保留不删**（不影响新逻辑）

### 可选清理（不做）

- 微信管理后台里旧 `hardware-fit-1439937513.cos.ap-shanghai.myqcloud.com` 域名可以从合法域名列表移除，但本次实施不强制处理（保留也无副作用）
- 旧 COS 桶的 `hardware-pdf/` 目录：本次改造完成、验证通过后可人工删除，与代码变更无耦合

## 关键常量（改造后）

`miniprogram/utils/hardware-pdf-cloud.js` 顶部：

```js
const SPEC_FILE_NAME = 'split-order-spec.pdf';   // hardware-fittings/ 下的 PDF 文件名
const CACHE_FILE_NAME = 'hardware-pdf.pdf';       // 本地缓存文件名（保持不变）
const CACHE_MD5_KEY = 'hardwarePdfCachedMd5';     // storage key，存云端 md5
const LEGACY_VERSION_KEY = 'hardwarePdfCachedVersion';  // 旧 key，一次性清理
```

云函数常量位于 `cloudfunctions/quickstartFunctions/index.js` 的 `listHardwareFittings` 函数体内，路径 `'hardware-fittings/'` 硬编码。

## 测试要点

小程序无标准单测框架，`tests/` 下也未曾覆盖 `hardware-pdf-cloud.js`，本次不加测试，改用手动验证：

1. **清缓存首次点击**：小程序客户端"清除数据"→ 点导出拆单规范 → 应触发下载并打开
2. **立即再点**：无 loading，直接打开（cachedMd5 命中）
3. **云端替换 PDF**：往 `hardware-fittings/split-order-spec.pdf` 上传新内容 → 客户端再点应重新下载（md5 不同）
4. **旧 storage key 清理**：清缓存前，控制台先 `wx.setStorageSync('hardwarePdfCachedVersion', 'legacy')`，然后点导出 → 完成后 `wx.getStorageSync('hardwarePdfCachedVersion')` 应为空
5. **飞行模式**：有缓存 → 打开旧缓存；无缓存 → 弹"下载失败"
6. **连点两次**：只发一次 downloadFile（`_pendingPromise` 去重）
7. **云端删掉 PDF**：客户端有缓存 → 沉默降级返回缓存；无缓存 → 弹"下载失败"

## 迁移策略

- **旧 storage key**：`hardwarePdfCachedVersion` 存的是版本字符串（如 `"2026-07-02-1"`）；改造后模块首次调用时 `wx.removeStorageSync('hardwarePdfCachedVersion')` 清理，避免遗留占用
- **旧本地文件**：文件名 `hardware-pdf.pdf` 保持不变，改造后直接覆盖写入。用户第一次点导出时会因 `CACHE_MD5_KEY` 空 vs 云端 md5 不等触发一次强制重新下载——正好拿到新桶的最新版本

## 未来可能的扩展（本次不做）

- 若 `hardware-fittings/` 下加入多份 PDF：只需 `SPEC_FILE_NAME` 改成一个映射表或允许调用方传入 name 参数，云函数无需改
- 与 GLB 同步机制合并成通用 "cloud-file-mirror" 抽象（现阶段两边 UX 差异较大，不合并）
