# 柜体 GLB 模型云存储化 与 本地缓存同步 · 设计文档

- 日期：2026-07-05
- 分支：feat/migrate-3-tabs（如需另开可命名 feat/cabinet-model-cloud-sync）
- 状态：设计（待实施）

## 背景

目前 21 个 GLB 柜体模型（~648KB）随主包一起打进小程序，位于 `miniprogram/cabinet/utils/cabinet-model/`。新增或修改柜型模型需要发新版本才能触达用户，也会增加主包体积。

本次目标：

- GLB 模型全部迁移到微信云存储 `cloud://.../cabinet-model/{50cm,100cm,zj}/`
- 主包内彻底移除 GLB，包体减小 ~648KB
- 小程序启动时对账云上目录，本地缓存与云端**完全镜像同步**
- 支持云上上传新型号后无需改代码即被自动识别（picker + renderer 都动态适配）

## 云端目录约定

云存储根：`cloud://lemonta-dev-d6ggnte9lb20a40c3.6c65-lemonta-dev-d6ggnte9lb20a40c3-1439937513/cabinet-model/`

子目录按柜体宽度归类：

| 子目录  | 内容 |
|---------|------|
| `50cm/` | 50A~50L（标准柜） + 50G1/50G2（加高模块） |
| `100cm/`| 100A~100L（标准柜） + 100G1/100G2（加高模块） |
| `zj/`   | Y-110-230、Z-110-230（转角柜） + YG-110-230G1/G2、ZG-110-230G1/G2（转角加高） |

上传新型号（如 `100M.glb`）到对应子目录即会被小程序自动识别，无需改代码。

## 同步策略：完全镜像

云存储是唯一权威源。每次 onLaunch 与云端对账：

- 云上新增 → 本地下载
- 云上同名文件 md5 变更 → 本地覆盖下载，运行中的柜体 hot-replace
- 云上删除 → 本地对应文件也删
- 云函数调用失败 → 有本地 manifest 时静默用本地兜底，无 manifest 时 3D 页显示错误

## 架构总览

三层职责分离：

```
┌──────────────────────────────────────────────────────┐
│ 云函数 quickstartFunctions / listCabinetModels       │
│  - @cloudbase/manager-node listDirectoryFiles        │
│  - 列 cabinet-model/{50cm,100cm,zj}/*.glb            │
│  - 返回 [{ subdir, name, fileID, md5, size }]        │
└──────────────────────────────────────────────────────┘
                       ↓ callFunction
┌──────────────────────────────────────────────────────┐
│ miniprogram/cabinet/utils/model-sync.js  ← 新建      │
│  - syncOnLaunch() : 拉云清单 → diff → 下载/删除      │
│  - onManifestReady()                                 │
│  - listModels() / getLocalPath() / onModelReady()    │
└──────────────────────────────────────────────────────┘
                       ↓ 读取
┌──────────────────────────────────────────────────────┐
│ cabinet-model.js  (改)     three-renderer.js (改)    │
│  localModels() 委托 sync   _resolveModelPath 委托 sync│
└──────────────────────────────────────────────────────┘
```

关键点：

- **同步入口单一**：所有云 ↔ 本地 ↔ 缓存交互集中在 `model-sync.js`
- **启动时机**：`app.js` onLaunch → `modelSync.syncOnLaunch()`（不 await）
- **3D 页时机**：进入 3D 页 → `await modelSync.onManifestReady()`
- **首次进入**（无本地 manifest）：3D 页 loading 直到全量下载完成
- **后续启动**（本地 manifest 存在）：3D 页立即可用；后台 sync 完成后 hot-replace

## 云函数 `listCabinetModels`

**位置**：`cloudfunctions/quickstartFunctions/index.js` 里新增 case，沿用现有 quickstartFunctions 单函数多路由模式。

**实现**：使用 `@cloudbase/manager-node` 的 `storage.listDirectoryFiles` 递归列出三个子目录。

```js
const CloudBase = require('@cloudbase/manager-node');
const app = CloudBase.init({ envId: cloud.DYNAMIC_CURRENT_ENV });

const listCabinetModels = async () => {
  const subdirs = ['50cm', '100cm', 'zj'];
  const models = [];
  for (const subdir of subdirs) {
    const files = await app.storage.listDirectoryFiles(`cabinet-model/${subdir}/`);
    files
      .filter((f) => /\.glb$/i.test(f.Key))
      .forEach((f) => {
        const name = f.Key.split('/').pop();
        models.push({
          subdir,
          name,
          fileID: `cloud://${envId}/cabinet-model/${subdir}/${name}`,
          md5: String(f.ETag || '').replace(/^"|"$/g, ''),
          size: f.Size,
        });
      });
  }
  return { success: true, models, serverTime: Date.now() };
};
```

**接口协议**：

```jsonc
// request
{ "type": "listCabinetModels" }

// response
{
  "success": true,
  "models": [
    { "subdir": "50cm",  "name": "50A.glb",        "fileID": "cloud://...", "md5": "...", "size": 29808 },
    { "subdir": "100cm", "name": "100A.glb",       "fileID": "cloud://...", "md5": "...", "size": 29808 },
    { "subdir": "zj",    "name": "Y-110-230.glb",  "fileID": "cloud://...", "md5": "...", "size": 34396 }
  ],
  "serverTime": 1720000000000
}
// 失败: { "success": false, "errMsg": "..." }
```

**依赖**：`cloudfunctions/quickstartFunctions/package.json` 新增 `@cloudbase/manager-node`。云函数运行时 `cloud.DYNAMIC_CURRENT_ENV` 就是当前环境，无需外部 SecretId/Key。

**miniprogram/utils/cloud.js 新增导出**：

```js
listCabinetModels: () => call('listCabinetModels'),
```

## `model-sync.js` 核心模块

**新文件**：`miniprogram/cabinet/utils/model-sync.js`

**本地目录结构**：

```
${wx.env.USER_DATA_PATH}/cabinet-model/
├── manifest.json
├── 50cm/50A.glb
├── 50cm/50B.glb
├── 100cm/100A.glb
├── ...
└── zj/Y-110-230.glb
```

**manifest.json 结构**：

```json
{
  "version": 1,
  "syncedAt": 1720000000000,
  "models": [
    {
      "subdir": "50cm",
      "name": "50A.glb",
      "fileID": "cloud://.../cabinet-model/50cm/50A.glb",
      "md5": "a1b2c3...",
      "size": 29808,
      "downloaded": true,
      "downloadedAt": 1720000001234,
      "pending": null
    }
  ]
}
```

字段语义：

- `downloaded: true` 表示本地实际有对应 glb 文件；`false` 表示 manifest 记录了但下载失败/未完成
- `getLocalPath` 只对 `downloaded: true` 的返回路径，否则返回 null（renderer 触发兜底 Box + 订阅 hot-replace）
- `pending: { md5, fileID } | null`：云上同名文件 md5 变更但新版本尚未下完时，旧版本继续可用（md5/fileID/downloaded 保留旧值），新版本信息暂存在 `pending`。下载完成后 pending 提升为主字段：新 md5/fileID 覆盖旧，`downloaded: true`，`pending: null`，同时触发 onModelReady 事件供 renderer hot-replace

**公开 API**：

```js
// onLaunch 调用，异步执行。首次调用记录 Promise 供 onManifestReady 等待
syncOnLaunch() -> Promise<{ added, updated, removed, kept }>

// 3D 页等待"至少有一份可用 manifest"
onManifestReady() -> Promise<void>
// - 有本地 manifest → 立即 resolve（同步任务后台跑）
// - 无本地 manifest → 等首次全量下载完成
// - 云函数失败 + 无本地 manifest → reject

// picker 用：列所有已缓存可用的模型
listModels() -> [{ subdir, name, w, h, code, kind, localPath }]

// renderer 用：给定柜型描述返回本地绝对路径；未缓存返回 null
getLocalPath({ subdir, name }) -> string | null

// renderer 用：某模型下载完成/更新 时回调
onModelReady(subdir, name, cb) -> unsubscribeFn
```

**syncOnLaunch 内部流程**：

```
1. 读本地 manifest.json（不存在则 local = []）
2. wx.cloud.callFunction('listCabinetModels') → remote 清单
   ├─ 失败 + 有 local → resolve(kept: local)   // 用本地兜底
   └─ 失败 + 无 local → reject(no-manifest)    // 3D 页错误提示
3. diff:
   - remote 有 local 无           → added: 加入下载队列
   - remote 有 local 有 md5 不同   → updated: 加入下载队列（下载后覆盖）
   - remote 无 local 有           → removed: 删除本地文件 + manifest 条目
4. 立即持久化 manifest.json：
   - added（本地无对应文件）→ 写入新条目，downloaded: false
   - kept（md5 未变）→ downloaded 字段沿用旧值
   - updated（md5 变更）→ 保留旧的 md5/fileID/downloaded 不变，另加 `pending: { md5, fileID }` 字段；旧文件继续可用；下载队列按 pending 拉新版
   - removed → 从 manifest 与磁盘一并删除
5. 并发下载（≤3 并发）：
   - wx.cloud.downloadFile({ fileID }) → 拿到 tempFilePath
   - fs.saveFile(tempFilePath, targetPath + '.download')
   - saveFile 完成后 fs.rename → 最终 targetPath
   - 成功后更新 manifest 里该条 downloaded=true，写盘
   - 失败保留在待下载状态，下次 syncOnLaunch 重试
6. 每个文件下载完成 → 触发 onModelReady 事件
```

**并发/断点/去重**：

- 全局单例（模块 top-level 状态），多页面并发调用只跑一次 sync
- 下载去重：同一 fileID 正在下 → 复用同一 Promise
- 断点安全：先落到 `.download` 后缀，`rename` 成最终名——避免半文件被后续启动当成"已下载"
- 删除操作在启动同步初期就完成（第 3 步），避免运行时读到即将被删的文件

**parseCabinetName** 复用 `cabinet-model.js` 现有 `parse()`：

- `50A.glb` → { w: 50, code: 'a', kind: 'standard' }
- `100G1.glb` → { w: 100, code: 'g1', kind: 'raise' }
- `Y-110-230.glb` → { code: 'y', kind: 'corner' }
- `YG-110-230G1.glb` → { code: 'yg', kind: 'corner-raise' }

subdir 决定物理存放位置，kind 由文件名解析出。

## `three-renderer.js` 改造

### 路径解析：`_resolveModelPath`

改为查询 model-sync：

```js
_resolveModelPath(it) {
  const modelSync = require('./model-sync.js');
  const code = (it.code || '').toLowerCase();

  let realCode = code;
  if (code === 'e1' || code === 'e2') realCode = 'a';

  if (it.kind === 'standard' || it.kind === 'nonstandard') {
    const w = it.w >= 75 ? 100 : 50;
    return modelSync.getLocalPath({
      subdir: w === 50 ? '50cm' : '100cm',
      name: `${w}${realCode.charAt(0).toUpperCase()}.glb`,
    });
  }
  if (it.kind === 'corner') {
    if (code === 'y') return modelSync.getLocalPath({ subdir: 'zj', name: 'Y-110-230.glb' });
    if (code === 'z') return modelSync.getLocalPath({ subdir: 'zj', name: 'Z-110-230.glb' });
    return null;
  }
  if (code === 'yg') return modelSync.getLocalPath({ subdir: 'zj', name: 'YG-110-230G1.glb' });
  if (code === 'zg') return modelSync.getLocalPath({ subdir: 'zj', name: 'ZG-110-230G1.glb' });
  if (code === 'g' || code === 'g1' || code === 'g2') {
    const w = it.w >= 75 ? 100 : 50;
    const variant = code === 'g2' ? 'G2' : 'G1';
    return modelSync.getLocalPath({
      subdir: w === 50 ? '50cm' : '100cm',
      name: `${w}${variant}.glb`,
    });
  }
  return null;
}
```

`getLocalPath` 未命中时返回 `null`（触发兜底 Box + 订阅 hot-replace）。

### `_readGlb` 兼容 wxfile 路径

USER_DATA_PATH 返回的是 `wxfile://usr/...` 或 `${USER_DATA_PATH}/...`，`fs.readFile` 直接吃；只需去掉"去前导 /"的兜底分支——那条只对包内路径生效。

```js
_readGlb(path) {
  if (GLB_BUFFER_CACHE[path]) return Promise.resolve(GLB_BUFFER_CACHE[path]);
  if (GLB_BUFFER_PROMISES[path]) return GLB_BUFFER_PROMISES[path];
  const isUserData = path.indexOf(wx.env.USER_DATA_PATH) === 0
                  || path.indexOf('wxfile://') === 0;
  const promise = new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: path,
      success: (res) => resolve(res.data),
      fail: (err) => {
        if (isUserData) return reject(err);
        fs.readFile({
          filePath: path.replace(/^\//, ''),
          success: (res) => resolve(res.data),
          fail: (err2) => reject(err2),
        });
      },
    });
  });
  // ... 同现有 cache 逻辑
}
```

### 兜底 Box 与 hot-replace

`_loadItemMesh` 未命中 path 时走 `_fallbackBox(it)`（现有代码已如此），额外订阅 ready：

```js
_loadItemMesh(it) {
  ...
  const path = this._resolveModelPath(it);
  if (!path) {
    this._subscribeHotReplace(it);
    return Promise.resolve(this._fallbackBox(it));
  }
  ...
}

_subscribeHotReplace(it) {
  const modelSync = require('./model-sync.js');
  const target = this._resolveTarget(it);   // { subdir, name }
  const unsub = modelSync.onModelReady(target.subdir, target.name, () => {
    this._replaceCabinet(it);
    unsub();
  });
}

// _replaceCabinet: 从 this._cabinets 找到匹配 it 的 group（按 w/h/code/kind），
// 保留 group.position / rotation / scale，替换内部 mesh，重跑
//   _stripNonGeometryNodes / _normalizeMaterials / _applyMaterial / _applyEdges
// 完成后清理该 path 的 _loaderCache 与模块级 GLB_BUFFER_CACHE 旧 buffer
```

**运行中 md5 变更**（sync 重下同一 fileID → onModelReady 再次触发）：

- 清理该 path 的 `_loaderCache[path]` 与模块级 `GLB_BUFFER_CACHE[path]` 里的旧 buffer/scene
- 触发 `_replaceCabinet(it)` 走同一 hot-replace 路径
- 用户当前 rot/zoom 变换保留

**preview 模式（`renderSingle`）** 同样：未命中时 `_fallbackBox`，ready 后重跑 `renderSingle(item, colorId)`。

## `cabinet-model.js` 与 picker 改造

现有 `localModels()` 硬编码枚举 `a..z + g/g1/g2` + `fileExists` 探测。云化后：

```js
function localModels() {
  const modelSync = require('./model-sync.js');
  return modelSync.listModels();  // 已下载可用的模型元数据数组
}
```

`makeModel` 的 `path` 字段改为通过 `modelSync.getLocalPath(...)` 拿。

`parse()`、`format()`、`shortName()` 保持不变。

删除：`fileExists`、`LOCAL_MODEL_DIR`、`localPath`（Node 分支同时删除，测试不再需要"扫本地"）。

`categorize` 保留原语义，但新增 subdir 依据更稳：

```js
if (m.subdir === 'zj') out.corner.push(m);
```

**picker 页调用点**（`miniprogram/cabinet/pages/design/index.js` 与相关 picker 组件）：如果同步调用 `localModels()`，需要 await `modelSync.onManifestReady()` 之后再调用。

**本次接受的限制**：picker 已展开、后台又新增了云柜型 → 现有 picker UI 不响应新增；用户下次进 picker 会看到新柜型。

## `app.js` 集成 与 加载态

**onLaunch 里加**：

```js
onLaunch: function () {
  try {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloud1-5gbuna7d27dafeba', traceUser: true });
    }
  } catch (e) { ... }

  // 新增：kick off model sync（不 await）
  try {
    const modelSync = require('./cabinet/utils/model-sync.js');
    modelSync.syncOnLaunch().catch((err) => {
      console.warn('[model-sync] launch sync failed:', err);
    });
  } catch (e) {
    console.warn('[model-sync] init failed:', e);
  }

  // 现有 userInfo / fonts 加载...
}
```

`model-sync.js` 设计为 `require` 立即返回、内部懒初始化（首次调用 `syncOnLaunch` 时才建目录、读 manifest）。

**3D 页 onLoad 里加**：

```js
async onLoad(options) {
  const modelSync = require('../../utils/model-sync.js');
  try {
    await modelSync.onManifestReady();
  } catch (e) {
    this.setData({ modelError: '模型资源加载失败，请检查网络后重试' });
    return;
  }
  // manifest ready → 初始化 renderer / picker
}
```

**加载态语义**：

| 场景 | 行为 |
|------|------|
| 首次进入 + 全量下载中 | 3D 画布渲染空房间；单个柜体落位时先出兜底 Box；ready 后 hot-replace |
| 已有本地 manifest | `onManifestReady()` 立即 resolve；3D 页秒开；后台 sync 完成按需 hot-replace |
| 云函数失败 + 有本地 manifest | 静默兜底，console.warn |
| 云函数失败 + 无本地 manifest | 3D 页错误提示，picker 不出现 |
| 单个 glb downloadFile 失败 | 该柜型保持 `downloaded: false`，picker 不显示；下次 syncOnLaunch 重试 |
| md5 变更但下载失败 | 保留旧文件继续可用（旧记录仍 `downloaded: true`） |

## 测试策略

**单元测试**（`tests/run.js` Node 环境）：

1. **`cabinet-model.js`**：`parse()` 用例保留；`localModels()` 改为委托 model-sync，测试用 stub 注入固定清单
2. **`model-sync` diff 逻辑**（新增）：给定 local + remote 数组，输出 `{ added, updated, removed, kept }` 是否正确
   - 首次同步（local 空）→ added 全部
   - md5 变更 → updated
   - 云上删除 → removed
   - 云函数失败 + 有 local → 走兜底
   - 云函数失败 + 无 local → reject
3. **不测试**：`wx.cloud.downloadFile` / `fs.saveFile` 的实际 IO（wx 环境专属）；只测 diff 与队列调度纯逻辑

**手动验证**：

| 场景 | 期望 |
|------|------|
| 首次全新安装打开小程序 | app 启动不阻塞；3D 页先兜底 Box，模型陆续 hot-replace；picker 逐个填入 |
| 有本地 manifest + 断网 | 3D 页秒开；picker 与之前一致 |
| 云上上传新柜型 100M.glb（无需改代码） | 下次 onLaunch 后 picker 出现 100M；renderer 能加载 |
| 云上删除 100D.glb | 下次 onLaunch 后本地 100D.glb 被删；picker 不再显示 100D |
| 云上覆盖 100A.glb（md5 变） | 下次 onLaunch 后本地 100A.glb 更新；正在渲染的柜体 hot-replace |
| 3D 页运行中 sync 完成 hot-replace | 用户当前旋转/缩放角度保留；模型无缝更换 |
| 云函数抛异常 | 有本地 manifest → 静默兜底；无本地 → 3D 页错误提示 |

## 破坏性变更 与 回滚

**破坏性变更**：

- 删除 `miniprogram/cabinet/utils/cabinet-model/` 整个目录（21 个 glb）
- `cabinet-model.js` 移除 `fileExists` / `LOCAL_MODEL_DIR` / `localPath`
- `cloudfunctions/quickstartFunctions` 新增 `@cloudbase/manager-node` 依赖 —— 云函数需重新部署
- 首次上线后，旧版本小程序打开无法加载 glb（因为旧版本仍指向包内路径）—— 这是包内彻底移除的必然后果

**上线前置条件**：

1. 云存储 `cabinet-model/{50cm,100cm,zj}/` 三个目录已按约定上传全部 21 个 glb
2. `quickstartFunctions` 云函数已部署新版本（含 `listCabinetModels`）
3. 云函数依赖 `@cloudbase/manager-node` 已 install 并随部署上传

**回滚**：

- 代码层：`git revert` 本次改动即可恢复包内 glb + 恢复 `cabinet-model.js` 硬编码路径
- 数据层：`USER_DATA_PATH/cabinet-model/` 残留不影响回滚版本运行（旧版从包内读，忽略 USER_DATA_PATH）
- 云函数：旧版 `quickstartFunctions` 不含 `listCabinetModels` case，旧代码不会调用它，无副作用

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `cloudfunctions/quickstartFunctions/index.js` | 修改：新增 `listCabinetModels` case |
| `cloudfunctions/quickstartFunctions/package.json` | 修改：新增 `@cloudbase/manager-node` 依赖 |
| `miniprogram/utils/cloud.js` | 修改：新增 `listCabinetModels` 导出 |
| `miniprogram/cabinet/utils/model-sync.js` | 新建 |
| `miniprogram/cabinet/utils/cabinet-model.js` | 修改：`localModels` 委托 sync；删除 fileExists 等 |
| `miniprogram/cabinet/utils/three-renderer.js` | 修改：`_resolveModelPath` 委托 sync；`_readGlb` 兼容 wxfile；`_loadItemMesh` hot-replace |
| `miniprogram/app.js` | 修改：onLaunch 里 kick off syncOnLaunch |
| `miniprogram/cabinet/pages/design/index.js` | 修改：onLoad 里 await onManifestReady + 错误态展示 |
| `miniprogram/cabinet/utils/cabinet-model/*.glb` | 删除：全部 21 个 |
| `tests/run.js` 相关用例 | 修改：cabinet-model 测试用 stub 注入；新增 model-sync diff 用例 |
