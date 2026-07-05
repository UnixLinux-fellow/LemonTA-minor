# glb 模型下载改用 `getTempFileURL` + `wx.downloadFile` 两步法

**日期**：2026-07-05
**范围**：`miniprogram/utils/model-sync.js` 内部下载实现
**参照**：LemonTA-main 项目
- `packageDesign/layout/layout.js:826-957`（设计图片下载）
- `pages/knowledge/glbviewer/glbviewer.js:1201-1254`（glb 下载）

---

## 背景

当前 LemonTA-minor 项目通过 `wx.cloud.downloadFile({fileID})` 一步下载 glb 模型文件。参照项目 LemonTA-main 使用两步法：先 `wx.cloud.getTempFileURL` 将 `cloud://` 转为 HTTPS 临时 URL，再用 `wx.downloadFile({url})` 下载。本次改造将下载底层 API 与 main 项目对齐。

## 目标

- glb 下载底层从 `wx.cloud.downloadFile({fileID})` 一步改为 `wx.cloud.getTempFileURL` + `wx.downloadFile({url})` 两步
- 只改 `miniprogram/utils/model-sync.js` 中的 `downloadOne(entry)` 函数内部实现
- 对外接口、manifest 结构、并发调度、落盘策略、渲染器接入方式全部保持不变

## 非目标（明确不做）

- 不批量 `getTempFileURL`（一次最多 50 fileID）—— 保留原并发队列按单文件粒度调度
- 不缓存 `tempFileURL` —— glb 只在下载时用一次
- 不改 `manifest.json` 结构（不存 `tempFileURL`）
- 不改 `cloud.js`、`model-sync-diff.js`
- 不改 3D 场景/渲染器读取本地路径的方式
- 不改对外 API 签名：`syncOnLaunch` / `onManifestReady` / `listModels` / `getLocalPath` / `onModelReady`

## 架构

改动范围：**一个文件**（`miniprogram/utils/model-sync.js`），改写 `downloadOne(entry)` 内部实现，并在同文件内新增两个内部 helper。文件其他部分与对外导出完全不动。

`downloadOne(entry)`（原第 97-133 行）拆为三部分：

1. `_resolveHttpsURL(fileID) → Promise<string>` —— 调 `wx.cloud.getTempFileURL({fileList:[fileID]})`，取 `res.fileList[0].tempFileURL`，返空/错拒绝
2. `_downloadHttpsToTemp(url) → Promise<string>` —— 调 `wx.downloadFile({url})`，校验 `res.statusCode === 200 && res.tempFilePath`
3. `downloadOne(entry)` —— 组合上述两步，加上原有的 `fs.saveFile` + atomic rename + `_downloadPromises` 去重逻辑

其余组件完全不动：
- `manifest.json` 结构与读写（`readManifestSync` / `writeManifestSync`）
- `syncOnLaunch` 调度、`ensureDirsSync`、`diff.diff` / `diff.buildManifest`
- 并发队列 `runDownloadQueue`（`MAX_CONCURRENT_DOWNLOADS = 3`）
- 事件订阅 `onModelReady` / `emitReady`
- `_downloadPromises` 同 fileID 并发去重
- `listModels` / `getLocalPath` / `onManifestReady` 对外接口

## 数据流

**改造前**：

```
entry.fileID (cloud://...)
   ↓  wx.cloud.downloadFile({fileID})
res.tempFilePath
   ↓  fs.saveFile → rename
localFilePath(entry)  ← 3D 渲染器读取
```

**改造后**：

```
entry.fileID (cloud://...)
   ↓  wx.cloud.getTempFileURL({fileList:[fileID]})
res.fileList[0].tempFileURL (https://...)
   ↓  wx.downloadFile({url})
res.tempFilePath
   ↓  fs.saveFile → rename           ← 后续与原来完全一致
localFilePath(entry)  ← 3D 渲染器读取（不变）
```

第二步（`fs.saveFile` 及之后）与改造前完全一致，因此 manifest 更新、`emitReady`、渲染器读取本地路径的行为不变。

## 组件

### `_resolveHttpsURL(fileID)`

- **职责**：把一个 `cloud://` fileID 转成 HTTPS URL
- **入参**：`fileID: string`
- **出参**：`Promise<string>`（resolve 时为 HTTPS URL；reject 时携带 `new Error(code)`，`code` 为 `temp_url_empty` 或 `temp_url_fail`）
- **实现**：调 `wx.cloud.getTempFileURL({fileList: [fileID]})`；成功时读 `res.fileList[0].tempFileURL`，若为空 `reject(new Error('temp_url_empty'))`；失败回调 `reject(new Error('temp_url_fail'))`

### `_downloadHttpsToTemp(url)`

- **职责**：从 HTTPS URL 下到微信临时文件路径
- **入参**：`url: string`
- **出参**：`Promise<string>`（resolve 时为 `tempFilePath`；reject 时携带 `new Error(code)`，`code` 为 `http_<statusCode>` 或 `download_fail`）
- **实现**：调 `wx.downloadFile({url})`；校验 `statusCode === 200 && tempFilePath` 存在；非 200 `reject(new Error('http_' + statusCode))`；fail 回调 `reject(new Error('download_fail'))`

**说明**：`wx.downloadFile` 的 fail 回调返回 `{errMsg}` 字符串（非 Error 对象）；两个 helper 统一封装成 `new Error(code)`，`err.message` 就是稳定的短代码。`downloadOne` 在 `.catch` 里读 `err.message` 填入 `{ok:false, err}`。

### `downloadOne(entry)`

- **职责**：给定 manifest entry，把 glb 文件下到 `localFilePath(entry)`
- **入参**：`{ subdir, name, fileID }`
- **出参**：`Promise<{ ok: boolean, path?: string, err?: string }>`（**始终 resolve，绝不 reject**，与原契约一致）
- **实现骨架**：
  ```
  if (_downloadPromises[fileID]) return _downloadPromises[fileID];
  const promise = _resolveHttpsURL(fileID)
    .then((url) => _downloadHttpsToTemp(url))
    .then((tempPath) => fs.saveFile → rename → { ok: true, path: target })
    .catch((err) => { console.warn('[model-sync] ...', err.message); return { ok: false, err: err.message }; });
  _downloadPromises[fileID] = promise;
  promise.then(() => { delete _downloadPromises[fileID]; });
  return promise;
  ```

**为什么拆两个内部函数**：`getTempFileURL` 和 `downloadFile` 是两类失败模式（URL 解析失败 vs HTTP 下载失败），拆开后日志能明确定位；未来若需批量 `getTempFileURL` 只改一处。

## 错误处理

保持原契约：`downloadOne` 始终 resolve，返回 `{ ok: false, err: string }`。`runDownloadQueue` 逻辑无需改动。

`err` 值枚举：

| 值 | 触发条件 |
|---|---|
| `temp_url_empty` | `getTempFileURL` 成功但 `tempFileURL` 为空 |
| `temp_url_fail` | `getTempFileURL` 调用失败 |
| `http_<statusCode>` | `wx.downloadFile` 返回非 200（如 `http_403`） |
| `download_fail` | `wx.downloadFile` 调用失败或无 `tempFilePath` |
| `rename_fail` | `fs.saveFile` 成功后 `renameSync` 失败（原有，保留） |

日志前缀继续用 `[model-sync]`，与文件其他日志一致。示例：
- `[model-sync] getTempFileURL fail <fileID> <errMsg>`
- `[model-sync] downloadFile fail <target> <errMsg>`
- `[model-sync] rename fail <tempName> → <target> <errMsg>`（原有）

## 测试

`tests/` 下已有 model-sync 相关的 mock 结构。测试改造：

**更新现有 mock**：将 `wx.cloud.downloadFile` mock 拆为 `wx.cloud.getTempFileURL` mock + `wx.downloadFile` mock。

**新增用例**（针对 `downloadOne`）：

1. 正常路径：`getTempFileURL` 返回有效 URL → `wx.downloadFile` 返回 200 + tempFilePath → `saveFile` 成功 → resolve `{ok:true, path}`
2. `getTempFileURL` 返回空 `tempFileURL` → resolve `{ok:false, err:'temp_url_empty'}`
3. `getTempFileURL` 失败回调 → resolve `{ok:false, err:'temp_url_fail'}`
4. `wx.downloadFile` 非 200（如 403） → resolve `{ok:false, err:'http_403'}`
5. `wx.downloadFile` 失败回调 → resolve `{ok:false, err:'download_fail'}`
6. 同 fileID 并发调用 → 只发起一次两步下载（`_downloadPromises` 去重仍然生效）

**保留**：原 `syncOnLaunch` / `runDownloadQueue` / `onModelReady` / manifest 读写等测试用例，因为它们的行为不变。

不改 Jest 运行方式与配置。

## 验收标准

- `miniprogram/utils/model-sync.js` 只修改 `downloadOne` 及内部新增的两个 helper；其他函数与 `module.exports` 完全一致
- 单元测试全部通过（包括新增的 6 条 `downloadOne` 用例）
- 微信开发者工具下 3D 页正常渲染柜体模型（等价于原有行为）
- 首次冷启动能完整下载 manifest 中所有 glb 到 `USER_DATA_PATH/cabinet-model/<subdir>/<name>`
- `cloud.js`、`model-sync-diff.js`、3D 渲染器、picker 等下游无需任何修改
