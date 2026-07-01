# 五金/尺寸参考 PDF 导出 — 设计方案

## 背景

`pages/plan-list` 页面目前有一个「导出方案信息」按钮，可生成包含所有方案的 PDF（`utils/pdf-exporter.js` + `vendor/jspdf.min.js`，canvas 渲染每页再拼进 PDF）。

用户希望在该按钮**后面**再加一个独立的「导出五金/尺寸」按钮，一键生成一个**独立的、与方案无关的**参考资料 PDF，内容为 `cabinet/utils/cabinet-hardware/` 目录下的三张图片和一份 docx 转换出的图片（衣柜尺寸、五金规范、国产五金参数、进口五金参数）。

## 需求

- 新按钮位置：`plan-list` 页面「导出方案信息」按钮**之后**，样式与之保持视觉一致（同一容器 `.export-btn-wrap`）。
- 点击流程：弹出文件名输入框（复用现有 `filename-input-modal`）→ 用户确认 → 生成 PDF → 调 `wx.openDocument` 预览。**无需选择方案**（跳过 `plan-select-modal` 环节）。
- 页面顺序（严格）：
  1. 衣柜尺寸（`衣柜尺寸.png`）
  2. 五金规范（`五金规范.jpg` / `五金规范-1.jpg` / `五金规范-2.jpg` …）
  3. 国产五金参数（`国产五金参数.jpg`）
  4. 进口五金参数（`进口五金参数.jpg`）
- 每页布局：**只有一张图片，contain 铺满整个 A4 页面，居中，保持长宽比，不裁剪、不变形，不加标题、页码、水印**。
- 五金规范多页支持：导出器按后缀 `1..N` 依次扫描 `五金规范-N.jpg`，最多扫到连续缺失即停止。若仅有 `五金规范.jpg`（无 `-N`）则视为单页。若两者共存，以带 `-N` 的多页为准。
- 图片资源缺失（例如用户没手动转 docx）→ 使用现有 `_drawPlaceholder` 的等价样式画灰底提示文字（例如「五金规范图片缺失，请将 docx 另存为图片放入 cabinet-hardware/ 目录」），**不阻塞其他页**。
- 命名默认值：`filename-input-modal` 支持 `defaultValue` 属性（见组件源码），弹出时预填「五金尺寸参考.pdf」；提交后走 `filenameCleaner.cleanFileName` 清洗。
- 生成失败：复用现有 `wx.showToast({ title: '生成失败', icon: 'none' })` + `console.error` 模式（与 `plan-list/index.js:129-133` 一致）。

## 非目标

- 不解析 docx。用户负责一次性把 `五金规范.docx` 用 Word/WPS 另存为 JPG 放到 `miniprogram/cabinet/utils/cabinet-hardware/` 目录。
- 不添加封面页、目录页、页眉页脚。
- 不与 `pdf-exporter.js` 的方案 PDF 合并；生成两个独立 PDF 是有意为之。
- 不新增单元测试（导出器强依赖 `wx.canvasToTempFilePath` 等小程序 API，Node/Jest 环境跑不了；改动量小，视觉验证在开发者工具里做）。

## 架构

新加一个与 `pdf-exporter.js` 平级、职责单一的导出器：

```
miniprogram/
  utils/
    pdf-exporter.js              # 现有：多方案 PDF
    hardware-pdf-exporter.js     # 新增：4-N 页硬件参考 PDF
    filename-cleaner.js          # 复用
  vendor/
    jspdf.min.js                 # 复用
  pages/plan-list/
    index.js                     # 加 onTapExportHardware
    index.wxml                   # 加按钮 + 第二个 filename-input-modal（或复用同一个，见下）
    index.wxss                   # 按钮微样式（若与现有一致可零改动）
  cabinet/utils/cabinet-hardware/
    衣柜尺寸.png                 # 已有
    国产五金参数.jpg             # 已有
    进口五金参数.jpg             # 已有
    五金规范.docx                # 已有，保留不删
    五金规范.jpg                 # 新增：由用户手动从 docx 导出
    五金规范-1.jpg / -2.jpg 等   # 可选：多页版本
```

### 单元职责

**`utils/hardware-pdf-exporter.js`** — 唯一职责：把一个有序的图片路径列表铺进 A4 PDF，返回临时文件路径。

对外接口：
```js
async function exportHardware({ canvas, fileName }) {
  // 1. 构造图片路径列表（按固定顺序，含多页扫描）
  // 2. 逐张渲染到 canvas，contain 布局，铺满 A4
  // 3. canvas → JPEG → base64 → jsPDF.addImage
  // 4. arrayBuffer → wx.getFileSystemManager().writeFile → tempFilePath
}

module.exports = { exportHardware };
```

依赖：
- `wx.getFileSystemManager()`（探测五金规范多页文件是否存在 + 写临时 PDF）
- `wx.canvasToTempFilePath` + `wx.getFileSystemManager().readFile`（canvas → base64）
- `jsPDF`（拼 PDF）
- `../vendor/jspdf.min.js`
- 不依赖 `pdf-exporter.js`（保持独立，避免耦合）

内部小函数（沿用 `pdf-exporter.js` 里已经验证过的模式，但**复制精简版**而非引用 —— 因为 `pdf-exporter.js` 没导出这些内部函数，且需求差别不大）：
- `_resolveHardwareSources(fs)` — 返回按顺序的 `{ path, fallbackText }[]`：先加尺寸，再加五金规范（可能 1-N 页），再加国产，再加进口。
- `_renderImagePage(canvas, ctx, src, fallbackText)` — 白底 + `_drawImageContain` 铺满整页。
- `_drawImageContain` / `_drawPlaceholder` / `_wrapText` — 从 `pdf-exporter.js` 复制精简版。
- `_captureJpeg` / `_readBase64` / `_addCanvasPage` / `_writeToTempFile` — 从 `pdf-exporter.js` 复制精简版。

**`pages/plan-list/index.js`** — 新增：
```js
const hardwarePdfExporter = require('../../utils/hardware-pdf-exporter.js');

// data 追加：hardwareExportNameOpen: false

onTapExportHardware() {
  this.setData({ hardwareExportNameOpen: true });
},

onHardwareExportNameCancel() {
  this.setData({ hardwareExportNameOpen: false });
},

async onHardwareExportNameConfirm(e) {
  const fileName = filenameCleaner.cleanFileName(e.detail.value);
  this.setData({ hardwareExportNameOpen: false });
  wx.showLoading({ title: '正在生成 PDF…', mask: true });
  try {
    const canvas = await getPdfCanvas(this);
    const filePath = await hardwarePdfExporter.exportHardware({ canvas, fileName });
    wx.hideLoading();
    wx.openDocument({
      filePath, fileType: 'pdf', showMenu: true,
      fail: (err) => wx.showModal({
        title: '预览失败',
        content: 'PDF 已生成在 ' + filePath + '\n错误: ' + (err && err.errMsg),
        showCancel: false,
      }),
    });
  } catch (err) {
    wx.hideLoading();
    console.error('exportHardware failed:', err);
    wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
  }
}
```

**`pages/plan-list/index.wxml`** — 在现有 `.export-btn` 之后追加同容器内的兄弟按钮，并追加第二个 `filename-input-modal`：
```xml
<view class="export-btn-wrap" wx:if="{{plans.length}}">
  <view class="export-btn" bindtap="onTapExport">导出方案信息</view>
  <view class="export-btn" bindtap="onTapExportHardware">导出五金/尺寸</view>
</view>

<filename-input-modal
  visible="{{hardwareExportNameOpen}}"
  defaultValue="五金尺寸参考.pdf"
  bind:cancel="onHardwareExportNameCancel"
  bind:confirm="onHardwareExportNameConfirm">
</filename-input-modal>
```
注意：五金按钮**在方案数量为 0 时也应该可用**（它与方案无关），因此需要把它从 `wx:if="{{plans.length}}"` 的容器里挪出来，或加一层判断。实现时把两个按钮拆到独立容器，或去掉整体 `wx:if`，用按钮自己的可用性判断。**决策：把「导出五金/尺寸」放到一个独立的、不受 `plans.length` 约束的容器/位置，紧贴「导出方案信息」按钮之后**，视觉上仍连在一起，但当方案列表为空时只显示这一个按钮。

## 数据流

```
用户点击「导出五金/尺寸」
  ↓
onTapExportHardware() → setData({ hardwareExportNameOpen: true })
  ↓
filename-input-modal 显示 → 用户输入文件名 → confirm
  ↓
onHardwareExportNameConfirm(e)
  ↓
cleanFileName → getPdfCanvas → hardwarePdfExporter.exportHardware({ canvas, fileName })
  ↓
exportHardware:
  ├─ _resolveHardwareSources(): 用 wx.getFileSystemManager().accessSync 探测五金规范多页存在性
  │    返回: [
  │      { path: '/cabinet/utils/cabinet-hardware/衣柜尺寸.png', fallback: '衣柜尺寸图片缺失' },
  │      { path: '/cabinet/utils/cabinet-hardware/五金规范[-N].jpg', fallback: '五金规范图片缺失' } × N,
  │      { path: '/cabinet/utils/cabinet-hardware/国产五金参数.jpg', fallback: '国产五金参数图片缺失' },
  │      { path: '/cabinet/utils/cabinet-hardware/进口五金参数.jpg', fallback: '进口五金参数图片缺失' },
  │    ]
  │
  ├─ 循环每个 source:
  │    _renderImagePage(canvas, ctx, source.path, source.fallback)
  │      → 白底 + _drawImageContain 铺满整页
  │    _addCanvasPage(doc, canvas, isFirstPage)
  │      → canvasToTempFilePath (jpg) → base64 → doc.addImage
  │
  └─ doc.output('arraybuffer') → writeFile → tempFilePath
  ↓
wx.openDocument(tempFilePath)
```

## 图片路径解析

小程序里 `require` 只能拿到 JS 模块，图片资源要用**相对小程序根目录的绝对路径字符串**给 `canvas.createImage().src`。四个资源的路径都是固定的：

- `cabinet/utils/cabinet-hardware/衣柜尺寸.png`
- `cabinet/utils/cabinet-hardware/五金规范.jpg` 或 `cabinet/utils/cabinet-hardware/五金规范-N.jpg`
- `cabinet/utils/cabinet-hardware/国产五金参数.jpg`
- `cabinet/utils/cabinet-hardware/进口五金参数.jpg`

微信 canvas 2d 的 `createImage()` 可以直接吃这种相对小程序根的路径（同 `pdf-exporter.js` 里加载 `plan.photoPath` / `plan.previewImage` 时的处理）。因为这些是**本地包内资源**而非 tempFilePath，一律以「代码包内路径」写死。

多页存在性探测用：
```js
try {
  wx.getFileSystemManager().accessSync('cabinet/utils/cabinet-hardware/五金规范-' + n + '.jpg');
  // 存在
} catch (e) {
  // 不存在，停止扫描
}
```
`wx.getFileSystemManager().accessSync` 对代码包内资源（相对路径）**不可用**（仅支持 USER_DATA_PATH 等可写路径）。**决策采用「用 image.onload/onerror 探测存在性」：**给一个上限 `MAX_SPEC_PAGES = 5`，从 `五金规范-1.jpg` 到 `五金规范-5.jpg` 逐张异步加载。若某页 `onerror` 触发，视为不存在，**停止扫描后续页码**（首次失败即中断，避免中间缺页）。若 `五金规范-1.jpg` 也不存在，则回退加载 `五金规范.jpg`（单页模式）；若单页也不存在，则该位置放一页占位符「五金规范图片缺失」。

## 错误处理

| 场景 | 处理 |
|------|------|
| 图片文件缺失（例如没转 docx） | 该页走 `_drawPlaceholder` 灰底提示文字，不阻塞其他页 |
| `canvasToTempFilePath` 失败 | reject → 上层 `try/catch` → `wx.showToast('生成失败')` |
| `readFile` / `writeFile` 失败 | 同上 |
| `wx.openDocument` 失败 | 复用现有 `wx.showModal` 提示文件已生成位置 |
| jsPDF 加载失败 | 加载期错误由 `require` 抛出，上层 `try/catch` 兜底 |
| Canvas 节点找不到 | `getPdfCanvas` reject → 同上 |

## 测试策略

不写单元测试。**在微信开发者工具中目视验证**：

1. 打开 `pages/plan-list`，确认新增按钮出现在「导出方案信息」之后。
2. 点击「导出五金/尺寸」→ 弹出命名框 → 输入 → 确认。
3. PDF 打开，逐页检查：
   - 第 1 页：衣柜尺寸.png contain 铺满
   - 第 2 页（+）：五金规范图片（若准备了 `-1`、`-2` 则有多页，顺序正确）
   - 接下页：国产五金参数.jpg
   - 最后一页：进口五金参数.jpg
4. 故意删掉某张图（例如临时重命名 `国产五金参数.jpg`），再次导出 → 该页应显示灰底文字，其余页正常。
5. 方案列表为空时，「导出五金/尺寸」按钮仍可点击并成功导出。

## 变更清单（供实现时对照）

- **新建** `miniprogram/utils/hardware-pdf-exporter.js`
- **修改** `miniprogram/pages/plan-list/index.js` — 引入新导出器、增 3 个处理函数、`data` 加 `hardwareExportNameOpen`
- **修改** `miniprogram/pages/plan-list/index.wxml` — 增按钮、增第二个 `filename-input-modal`，处理空方案列表下按钮的显隐
- **可能修改** `miniprogram/pages/plan-list/index.wxss` — 若两个并列按钮排版需要微调；否则零改动
- **用户手动准备** `miniprogram/cabinet/utils/cabinet-hardware/五金规范.jpg`（由 docx 另存/截图得来）

## 风险与决策记录

- **五金规范单/多页共存策略**：以带 `-N` 后缀的多页为准（若存在 `五金规范-1.jpg`，即使还存在 `五金规范.jpg` 也忽略无后缀版本）。避免同一份内容被重复导出两次。
- **图片资源路径写法**：写死为 `cabinet/utils/cabinet-hardware/xxx`（小程序代码包内相对根路径），跟 `pdf-exporter.js` 里 `plan.photoPath` 用法一致。
- **不加标题的取舍**：用户明确要求「不加标题」；简化实现，视觉更聚焦。
- **不新增测试**：pdf-exporter.js 现在也没有单元测试，遵循既有约定，避免引入 Jest + wx mock 的额外维护成本。
