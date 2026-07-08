# glb 下载改用两步法 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `miniprogram/utils/model-sync.js` 中 glb 文件下载从 `wx.cloud.downloadFile({fileID})` 一步法改为 `wx.cloud.getTempFileURL` + `wx.downloadFile({url})` 两步法，对齐 LemonTA-main 项目的模式。

**Architecture:** 只改一个文件 `miniprogram/utils/model-sync.js`：`downloadOne(entry)` 内部拆为两个 helper（`_resolveHttpsURL` / `_downloadHttpsToTemp`）+ 组合逻辑。落盘、manifest、并发队列、hot-replace 事件、对外 API 全部不动。

**Tech Stack:** 微信小程序云能力（`wx.cloud.getTempFileURL`、`wx.downloadFile`、`wx.getFileSystemManager`）、Jest 29 单测。

---

## File Structure

- **Modify**: `miniprogram/utils/model-sync.js`
  - 新增两个内部 helper：`_resolveHttpsURL(fileID)`、`_downloadHttpsToTemp(url)`
  - 改写 `downloadOne(entry)` 内部实现
  - 其他函数、`module.exports` 完全不动
- **Create**: `tests/model-sync-download.test.js` —— `downloadOne` 单元测试

参照文件（只读，不改）：
- `D:\工程\柠檬塔\程序\LemonTA-main\LemonTA-main\pages\knowledge\glbviewer\glbviewer.js:1201-1254`（main 项目 glb 下载模式）
- `D:\工程\柠檬塔\程序\LemonTA-main\LemonTA-main\packageDesign\layout\layout.js:826-957`（main 项目图片 getTempFileURL 用法）

---

## Task 1: 建立测试骨架 + wx mock

在写业务代码之前，先建立单测文件与 wx mock，避免后续 TDD 时反复搭脚手架。

**Files:**
- Create: `tests/model-sync-download.test.js`

- [ ] **Step 1: 创建测试文件（含 wx global mock）**

在 `tests/model-sync-download.test.js` 写入：

```js
// downloadOne 单元测试：验证 getTempFileURL + wx.downloadFile 两步法

// ---- wx global mock ----
// jest 默认没有 wx，需要在 require 目标模块前挂到 global
function installWxMock(overrides) {
  const files = {};
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    cloud: {
      getTempFileURL: overrides.getTempFileURL,
    },
    downloadFile: overrides.downloadFile,
    getFileSystemManager: () => ({
      accessSync: (p) => {
        if (!files[p]) { const err = new Error('no access'); err.errMsg = 'accessSync:fail'; throw err; }
      },
      mkdirSync: (p) => { files[p] = 'dir'; },
      readFileSync: (p) => { if (!files[p]) throw new Error('no file'); return files[p]; },
      writeFileSync: (p, buf) => { files[p] = buf; },
      unlinkSync: (p) => { delete files[p]; },
      saveFile: ({ tempFilePath, filePath, success, fail }) => {
        if (overrides.saveFileShouldFail) { fail && fail({ errMsg: 'saveFile:fail' }); return; }
        files[filePath] = 'saved:' + tempFilePath;
        success && success({ savedFilePath: filePath });
      },
      renameSync: (from, to) => {
        if (overrides.renameShouldFail) { const e = new Error('rename fail'); e.errMsg = 'rename:fail'; throw e; }
        files[to] = files[from]; delete files[from];
      },
    }),
  };
  return files;
}

function clearWxMock() {
  delete global.wx;
  // 强制下次 require 重新初始化模块单例
  jest.resetModules();
}

describe('model-sync downloadOne (two-step)', () => {
  afterEach(() => { clearWxMock(); });

  test('placeholder — real tests added in later tasks', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 跑一遍测试确认骨架能执行**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: PASS（1 passed）

- [ ] **Step 3: 提交**

```bash
git add tests/model-sync-download.test.js
git commit -m "test(model-sync): scaffold downloadOne two-step test file"
```

---

## Task 2: 为 downloadOne 暴露测试入口

`downloadOne` 目前是模块内部函数，`module.exports` 不导出。为方便单测，把它加入导出（不改运行时行为，因为运行时不会有人从外部调它）。

**Files:**
- Modify: `miniprogram/utils/model-sync.js:347-354`

- [ ] **Step 1: 写一个失败的测试断言导出存在**

替换 `tests/model-sync-download.test.js` 里的 placeholder 测试：

```js
  test('exports downloadOne for testing', () => {
    installWxMock({});
    const ms = require('../miniprogram/utils/model-sync.js');
    expect(typeof ms.downloadOne).toBe('function');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: FAIL（`ms.downloadOne` is undefined）

- [ ] **Step 3: 在 model-sync.js 的 module.exports 里加 downloadOne**

打开 `miniprogram/utils/model-sync.js`，找到最后的 `module.exports` 区块（第 347-354 行），改为：

```js
module.exports = {
  syncOnLaunch,
  onManifestReady,
  listModels,
  getLocalPath,
  onModelReady,
  _getManifest: () => _manifest,
  // 内部实现，仅用于测试
  downloadOne,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/model-sync.js tests/model-sync-download.test.js
git commit -m "chore(model-sync): expose downloadOne for unit test"
```

---

## Task 3: 新增 `_resolveHttpsURL` helper

单独实现"cloud:// fileID → HTTPS URL"这一步。TDD：先写测试再写实现。

**Files:**
- Modify: `miniprogram/utils/model-sync.js` (在 `downloadOne` 上方新增 helper)
- Modify: `tests/model-sync-download.test.js`

- [ ] **Step 1: 先写 3 条 `_resolveHttpsURL` 测试（应该失败）**

在 `tests/model-sync-download.test.js` 的 describe 内追加：

```js
  test('_resolveHttpsURL: returns HTTPS URL on success', async () => {
    installWxMock({
      getTempFileURL: ({ fileList }) => Promise.resolve({
        fileList: [{ fileID: fileList[0], tempFileURL: 'https://cdn/x.glb' }],
      }),
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._resolveHttpsURL('cloud://a/x.glb')).resolves.toBe('https://cdn/x.glb');
  });

  test('_resolveHttpsURL: rejects temp_url_empty when tempFileURL missing', async () => {
    installWxMock({
      getTempFileURL: ({ fileList }) => Promise.resolve({
        fileList: [{ fileID: fileList[0], tempFileURL: '' }],
      }),
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._resolveHttpsURL('cloud://a/x.glb'))
      .rejects.toThrow('temp_url_empty');
  });

  test('_resolveHttpsURL: rejects temp_url_fail on API failure', async () => {
    installWxMock({
      getTempFileURL: () => Promise.reject({ errMsg: 'cloud fail' }),
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._resolveHttpsURL('cloud://a/x.glb'))
      .rejects.toThrow('temp_url_fail');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: FAIL（`ms._resolveHttpsURL is not a function`）

- [ ] **Step 3: 在 model-sync.js 中实现 `_resolveHttpsURL`**

在 `miniprogram/utils/model-sync.js` 第 96 行（`// ---- 下载单文件` 注释上方）插入：

```js
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
```

同时在 `module.exports` 里加一行 `_resolveHttpsURL,`：

```js
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
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: PASS（4 passed，含 placeholder 前置）

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/model-sync.js tests/model-sync-download.test.js
git commit -m "feat(model-sync): add _resolveHttpsURL helper (cloud:// → HTTPS)"
```

---

## Task 4: 新增 `_downloadHttpsToTemp` helper

实现"HTTPS URL → 微信临时文件路径"这一步。

**Files:**
- Modify: `miniprogram/utils/model-sync.js` (紧接 `_resolveHttpsURL` 下方)
- Modify: `tests/model-sync-download.test.js`

- [ ] **Step 1: 写 3 条 `_downloadHttpsToTemp` 测试（应该失败）**

在 `tests/model-sync-download.test.js` 追加：

```js
  test('_downloadHttpsToTemp: resolves tempFilePath on 200', async () => {
    installWxMock({
      downloadFile: ({ success }) => {
        setImmediate(() => success({ statusCode: 200, tempFilePath: 'wxfile://tmp/x.glb' }));
      },
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._downloadHttpsToTemp('https://cdn/x.glb'))
      .resolves.toBe('wxfile://tmp/x.glb');
  });

  test('_downloadHttpsToTemp: rejects http_<code> on non-200', async () => {
    installWxMock({
      downloadFile: ({ success }) => {
        setImmediate(() => success({ statusCode: 403, tempFilePath: '' }));
      },
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._downloadHttpsToTemp('https://cdn/x.glb'))
      .rejects.toThrow('http_403');
  });

  test('_downloadHttpsToTemp: rejects download_fail on fail callback', async () => {
    installWxMock({
      downloadFile: ({ fail }) => {
        setImmediate(() => fail({ errMsg: 'network down' }));
      },
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    await expect(ms._downloadHttpsToTemp('https://cdn/x.glb'))
      .rejects.toThrow('download_fail');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: FAIL（`ms._downloadHttpsToTemp is not a function`）

- [ ] **Step 3: 在 model-sync.js 中实现 `_downloadHttpsToTemp`**

在 `_resolveHttpsURL` 下方追加：

```js
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
```

同时在 `module.exports` 里加 `_downloadHttpsToTemp`：

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: PASS（7 passed）

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/model-sync.js tests/model-sync-download.test.js
git commit -m "feat(model-sync): add _downloadHttpsToTemp helper (HTTPS → tempFile)"
```

---

## Task 5: 改写 `downloadOne` 组合两步

现在把 `downloadOne` 内部的 `wx.cloud.downloadFile({fileID})` 一步法改为组合上述两个 helper。落盘（`saveFile` + `renameSync`）、并发去重（`_downloadPromises`）、错误契约（始终 resolve）全部保持。

**Files:**
- Modify: `miniprogram/utils/model-sync.js:97-133` (`downloadOne` 函数体)
- Modify: `tests/model-sync-download.test.js`

- [ ] **Step 1: 写 4 条 `downloadOne` 集成测试（应该失败）**

在 `tests/model-sync-download.test.js` 追加：

```js
  const entry = { subdir: '50cm', name: '50G1.glb', fileID: 'cloud://x/50G1.glb' };

  test('downloadOne: full happy path', async () => {
    installWxMock({
      getTempFileURL: () => Promise.resolve({ fileList: [{ tempFileURL: 'https://cdn/50G1.glb' }] }),
      downloadFile: ({ success }) => setImmediate(() => success({ statusCode: 200, tempFilePath: 'wxfile://tmp/50G1.glb' })),
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    const res = await ms.downloadOne(entry);
    expect(res.ok).toBe(true);
    expect(res.path).toBe('wxfile://usr/cabinet-model/50cm/50G1.glb');
  });

  test('downloadOne: temp_url_empty propagates', async () => {
    installWxMock({
      getTempFileURL: () => Promise.resolve({ fileList: [{ tempFileURL: '' }] }),
      downloadFile: () => {},
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    const res = await ms.downloadOne(entry);
    expect(res).toEqual({ ok: false, err: 'temp_url_empty' });
  });

  test('downloadOne: http_<code> propagates', async () => {
    installWxMock({
      getTempFileURL: () => Promise.resolve({ fileList: [{ tempFileURL: 'https://cdn/x.glb' }] }),
      downloadFile: ({ success }) => setImmediate(() => success({ statusCode: 500, tempFilePath: '' })),
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    const res = await ms.downloadOne(entry);
    expect(res).toEqual({ ok: false, err: 'http_500' });
  });

  test('downloadOne: same fileID concurrent calls dedupe', async () => {
    let tempCalls = 0;
    let dlCalls = 0;
    installWxMock({
      getTempFileURL: () => { tempCalls++; return Promise.resolve({ fileList: [{ tempFileURL: 'https://cdn/x.glb' }] }); },
      downloadFile: ({ success }) => { dlCalls++; setImmediate(() => success({ statusCode: 200, tempFilePath: 'wxfile://tmp/x.glb' })); },
    });
    const ms = require('../miniprogram/utils/model-sync.js');
    const [a, b] = await Promise.all([ms.downloadOne(entry), ms.downloadOne(entry)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(tempCalls).toBe(1);
    expect(dlCalls).toBe(1);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: 前 3 条 FAIL（旧 `downloadOne` 调 `wx.cloud.downloadFile` 而 mock 里没配），第 4 条也 FAIL。

- [ ] **Step 3: 改写 `downloadOne` 组合两步**

打开 `miniprogram/utils/model-sync.js`，找到 `downloadOne` 函数（原第 97-133 行），完整替换为：

```js
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
```

- [ ] **Step 4: 跑单元测试确认通过**

Run: `npm test -- tests/model-sync-download.test.js`
Expected: PASS（11 passed）

- [ ] **Step 5: 跑全量单测确认无回归**

Run: `npm test`
Expected: 所有测试 PASS（包含原有 `filename-cleaner.test.js`）

- [ ] **Step 6: 提交**

```bash
git add miniprogram/utils/model-sync.js tests/model-sync-download.test.js
git commit -m "feat(model-sync): switch downloadOne to two-step (getTempFileURL + wx.downloadFile)"
```

---

## Task 6: 收尾清理与验证

**Files:**
- Modify: `miniprogram/utils/model-sync.js`（可选：移除已不使用的注释）

- [ ] **Step 1: 检查文件顶部注释是否需要更新**

打开 `miniprogram/utils/model-sync.js` 第 1-7 行的模块头注释。当前描述聚焦于 manifest/diff/hot-replace，不涉及底层下载 API，**保持原样不改**。

- [ ] **Step 2: 全文件搜索是否还有残留的 `wx.cloud.downloadFile`**

Run: `grep -n "wx.cloud.downloadFile" miniprogram/utils/model-sync.js`
Expected: 无输出（所有旧引用已被替换）

- [ ] **Step 3: 微信开发者工具真机验证（用户手动）**

- 打开微信开发者工具，加载本项目
- 清除小程序数据（避免命中旧 manifest）
- 冷启动，进入柜体设计 3D 页
- 验证：柜体模型能正常渲染，控制台无 `[model-sync]` 相关 error
- （可选）通过"清缓存"重启验证第二次仍然从本地读取

- [ ] **Step 4: 最终提交（如果 Step 1-2 有变更；否则跳过）**

若 Step 2 发现残留并清理，或 Step 1 决定微调注释：

```bash
git add miniprogram/utils/model-sync.js
git commit -m "chore(model-sync): finalize two-step download cleanup"
```

若无变更则不提交。

---

## 自检清单

实施完成后逐条对照 spec 的验收标准：

- [ ] `miniprogram/utils/model-sync.js` 只修改 `downloadOne` 并新增 `_resolveHttpsURL` / `_downloadHttpsToTemp`；其他函数与原 `module.exports` 中的 5 个对外方法（`syncOnLaunch` / `onManifestReady` / `listModels` / `getLocalPath` / `onModelReady`）完全一致
- [ ] 新增测试文件 `tests/model-sync-download.test.js` 全部 PASS
- [ ] 原有测试 `tests/filename-cleaner.test.js` 未受影响
- [ ] 微信开发者工具下 3D 页正常渲染（Task 6 Step 3）
- [ ] `cloud.js`、`model-sync-diff.js`、3D 渲染器、picker 无任何修改
- [ ] `manifest.json` 结构未变（不含 `tempFileURL` 字段）
