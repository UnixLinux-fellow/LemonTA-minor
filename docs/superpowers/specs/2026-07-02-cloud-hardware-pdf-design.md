# 五金/尺寸 PDF 云端下载 + 本地缓存 + 版本对比 设计方案

日期：2026-07-02
状态：待实施

## 背景

当前 `导出五金/尺寸` 按钮的实现（`miniprogram/utils/hardware-pdf-exporter.js`）在小程序内用 canvas + jsPDF 实时拼装一份多页 PDF。图片资源打包进小程序、jsPDF 库约 300KB、canvas 4× 缩放渲染多页在低端机上会卡死过多次，历经多轮修复仍不理想。

需求改为：PDF 由线下预制好，放在腾讯云 COS 上，小程序按钮点击后从云端拉取，本地缓存并做版本对比，避免重复下载。

## 目标

- 小程序不再实时生成 PDF；PDF 由人工在 COS 上维护
- 首次点击：拉取 PDF 到本地缓存并打开
- 再次点击：如云端未更新，直接打开本地缓存，无网络开销
- 云端 PDF 更新后，下一次点击能自动感知并下载新版本
- 无网络时，若有旧缓存则降级打开旧缓存

## 非目标

- 不做 PDF 生成/编辑工具链
- 不做多份 PDF 管理（当前只有一份"五金尺寸参考"）
- 不做自动化的 manifest 版本递增；version 由人工维护
- 不做 COS 签名（走公有读）

## 架构总览

```
plan-list/index.js
     │  onTapExportHardware()
     ▼
hardware-pdf-cloud.js
     │  fetchHardwarePdf()  →  Promise<localFilePath>
     ▼
COS (公有读)
     ├── hardware-pdf/manifest.json
     └── hardware-pdf/五金尺寸参考.pdf
```

新增模块：`miniprogram/utils/hardware-pdf-cloud.js`，对外仅暴露一个函数：

```js
module.exports = { fetchHardwarePdf };
// fetchHardwarePdf() -> Promise<string>  返回本地 PDF 文件路径
```

调用方 `plan-list/index.js` 拿到路径后直接 `wx.openDocument({ filePath, fileType: 'pdf', showMenu: true })`。

## 云端资源布局

腾讯云 COS 存储桶下的前缀目录 `hardware-pdf/`：

```
hardware-pdf/manifest.json      版本清单，几百字节
hardware-pdf/五金尺寸参考.pdf    主文件，大小可变
```

### manifest.json 结构

```json
{
  "version": "2026-07-02-1",
  "url": "https://<bucket>.cos.<region>.myqcloud.com/hardware-pdf/五金尺寸参考.pdf"
}
```

- `version`：字符串，任意可比较即可（推荐用 `YYYY-MM-DD-N` 格式）。每次替换 PDF 时人工修改此字段。
- `url`：PDF 完整 HTTPS 直链。放在 manifest 内而非硬编码在小程序里，方便未来换桶/换路径不用发版。

### COS 权限

- 存储桶或 `hardware-pdf/` 前缀设为 **公有读、私有写**。
- 小程序侧不签名，直接 `wx.request` 拉 manifest、`wx.downloadFile` 拉 PDF。
- 不涉及敏感数据，公有读风险可控。

### 小程序管理后台配置

将 COS 域名（形如 `<bucket>.cos.<region>.myqcloud.com`）**同时**加入：

- `request` 合法域名（用于拉 manifest.json）
- `downloadFile` 合法域名（用于拉 PDF）

## 数据流

### 本地存储位置

- PDF 文件：`${wx.env.USER_DATA_PATH}/hardware-pdf.pdf`（固定文件名，覆盖写入）
- 版本记录：`wx.setStorageSync('hardwarePdfCachedVersion', '<version-string>')`

选择 `USER_DATA_PATH` 而非临时文件的原因：临时文件会被微信在小程序重启或内存不足时自动清理；`USER_DATA_PATH` 为小程序独立持久目录（上限 10MB），只在用户主动清缓存或卸载时才丢失。

### 每次点击的执行流程

```
fetchHardwarePdf():
  1. wx.request(manifest.json)
     ├─ 成功 → 拿到 cloudVersion, cloudUrl
     │   2. 读 cachedVersion 与本地 PDF 是否存在
     │      ├─ cloudVersion === cachedVersion 且缓存文件在
     │      │    → 返回本地路径（无下载）
     │      └─ 否
     │          3. wx.downloadFile(cloudUrl)
     │             ├─ 成功
     │             │    4. 把临时文件复制到 USER_DATA_PATH/hardware-pdf.pdf
     │             │    5. wx.setStorageSync('hardwarePdfCachedVersion', cloudVersion)
     │             │    6. 返回本地路径
     │             └─ 失败
     │                 → 若有旧缓存：toast '更新失败，已打开本地版本'，返回旧缓存路径
     │                 → 若无旧缓存：throw
     └─ 失败（无网 / manifest 挂）
         → 若有旧缓存：沉默降级，返回旧缓存路径
         → 若无旧缓存：throw
```

### UX 反馈

- 命中缓存（无下载）：无 loading，直接 `openDocument`
- 需要下载：`wx.showLoading({ title: '正在下载文档…', mask: true })`；用 `downloadFile.onProgressUpdate` 更新为 `正在下载文档 45%`；完成后 `hideLoading`。

## 错误处理

| 场景 | 有旧缓存 | 无旧缓存 |
|---|---|---|
| manifest.json 拉取失败 | 沉默降级，控制台打日志 | `wx.showModal` 提示下载失败，请检查网络 |
| downloadFile 失败 | toast 提示"更新失败，已打开本地版本" | `wx.showModal` 提示下载失败 |
| openDocument 失败 | `wx.showModal` 显示文件路径 + errMsg | 同 |

**降级原则**：只要本地有可用缓存，就不让用户看到错误页——用户体验优先于版本新鲜度。

**并发保护**：`hardware-pdf-cloud.js` 模块级 `_pendingPromise` 变量。连点按钮时，第二次调用直接复用第一次的 Promise，不发第二次网络请求。

**不做重试、不降级到本地生成**：降级到本地生成会把删掉的 jsPDF 和图片资源又拉回来，违背本次改造的简化目标。

## 影响到的现有代码

### 修改

- `miniprogram/pages/plan-list/index.js`
  - 删除 `require('../../utils/hardware-pdf-exporter.js')`，改为 `require('../../utils/hardware-pdf-cloud.js')`
  - 删除 `hardwareExportNameOpen` state 与 `onHardwareExportName*` 回调
  - `onTapExportHardware` 改为：`showLoading` → `fetchHardwarePdf()` → `hideLoading` → `openDocument`
- `miniprogram/pages/plan-list/index.wxml`
  - 删除第二个 `<filename-input-modal>`（`hardwareExportNameOpen` 绑定的那个）

### 保留不动

- `<canvas id="pdf-canvas">`（`utils/pdf-exporter.js` 导出方案信息仍在用）
- `getPdfCanvas`（同上）
- `miniprogram/vendor/jspdf.min.js`（同上）
- `miniprogram/utils/pdf-exporter.js`（导出方案信息功能不变）

### 可删除

- `miniprogram/utils/hardware-pdf-exporter.js` 整个文件
- `miniprogram/cabinet/utils/cabinet-hardware/` 下的图片资源：`衣柜尺寸.png`、`五金规范*.png/jpg`、`国产五金参数.jpg`、`进口五金参数.jpg`（如别处未引用；实施时先 grep 确认）

### 新增

- `miniprogram/utils/hardware-pdf-cloud.js`

## 关键常量

放在 `hardware-pdf-cloud.js` 顶部：

```js
const MANIFEST_URL = 'https://<bucket>.cos.<region>.myqcloud.com/hardware-pdf/manifest.json';
const CACHE_FILE_NAME = 'hardware-pdf.pdf';
const CACHE_VERSION_KEY = 'hardwarePdfCachedVersion';
```

其中 `MANIFEST_URL` 的实际域名会在实施阶段由用户提供并填入。

## 测试要点

小程序无标准单元测试框架，手动验证清单：

1. 首次点击（清缓存后）：下载 → 打开成功
2. 立即再点：无 loading，直接打开（验证缓存命中）
3. COS 上改 `version` 字段：再点，触发下载并覆盖缓存，`hardwarePdfCachedVersion` 更新
4. 关小程序飞行模式再点：有缓存 → 打开旧缓存；无缓存 → 报错弹窗
5. 连点两次按钮：只发一次 downloadFile（并发保护）
6. COS 上删掉 PDF、留 manifest：downloadFile 失败 → 有缓存降级 / 无缓存报错

## 未来可能的扩展（本次不做）

- 后台预热：`onLaunch` 时静默检查版本并下载
- 多份 PDF 管理：manifest 支持多份文件、每份独立版本
- 签名/私有读：如后续需要按用户鉴权，改走 COS STS 临时密钥
