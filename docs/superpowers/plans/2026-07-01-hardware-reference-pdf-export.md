# 五金/尺寸参考 PDF 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `pages/plan-list` 页面新增「导出五金/尺寸」按钮，一键生成独立 PDF，按序包含衣柜尺寸、五金规范（可多页）、国产五金参数、进口五金参数四份参考资料。

**Architecture:** 新建一个与现有 `utils/pdf-exporter.js` 平级、职责单一的 `utils/hardware-pdf-exporter.js`，用现有 canvas + jsPDF 模式渲染定长图片页；`pages/plan-list` 复用现有 `#pdf-canvas` 节点和 `filename-input-modal` 组件，只增按钮和处理函数。

**Tech Stack:** 微信小程序（wx.canvas 2d / wx.canvasToTempFilePath / wx.getFileSystemManager），jsPDF（`miniprogram/vendor/jspdf.min.js`）。

**Spec:** `docs/superpowers/specs/2026-07-01-hardware-reference-pdf-export-design.md`

---

## Prerequisites（用户手动一次性准备）

在开始任何编码之前，请先在文件系统里手动准备好资源图片：

- [ ] **Step 0.1: 把 docx 转为图片**

用 Word / WPS 打开 `miniprogram/cabinet/utils/cabinet-hardware/五金规范.docx`，另存为图片（JPG），命名为 `五金规范.jpg`，放到同一目录。

若内容超过一屏可拆多页，命名 `五金规范-1.jpg`、`五金规范-2.jpg` 依次编号。

- [ ] **Step 0.2: 确认所有资源就位**

在 `miniprogram/cabinet/utils/cabinet-hardware/` 目录里应存在：
- `衣柜尺寸.png`（已有）
- `五金规范.jpg` 或 `五金规范-1.jpg` `五金规范-2.jpg` ...（新增）
- `国产五金参数.jpg`（已有）
- `进口五金参数.jpg`（已有）

**说明：**这一步的缺失不会阻塞后续开发（导出器会画占位符），但真机预览效果需要图片就位后才能确认。

---

## Task 1：新建 hardware-pdf-exporter 骨架 + 常量

**Files:**
- Create: `miniprogram/utils/hardware-pdf-exporter.js`

- [ ] **Step 1.1: 创建文件，写常量和模块头**

创建 `miniprogram/utils/hardware-pdf-exporter.js`，写入：

```js
// 五金/尺寸参考 PDF 导出：4-N 页固定图片资源，与方案无关。
// 与 utils/pdf-exporter.js 平级，共用 canvas + jsPDF 模式但保持独立。
const jspdfModule = require('../vendor/jspdf.min.js');
const jsPDF = jspdfModule.jsPDF || jspdfModule;

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const SCALE = 2;
const CANVAS_W = Math.round(A4_W_PT * SCALE);
const CANVAS_H = Math.round(A4_H_PT * SCALE);
const MARGIN = 40 * SCALE;
const MAX_SPEC_PAGES = 5; // 五金规范最多扫多少页

const HARDWARE_DIR = 'cabinet/utils/cabinet-hardware/';

module.exports = { exportHardware };

async function exportHardware({ canvas, fileName }) {
  throw new Error('not implemented');
}
```

- [ ] **Step 1.2: 提交骨架**

```bash
git add miniprogram/utils/hardware-pdf-exporter.js
git commit -m "feat(hardware-pdf): 新建导出器骨架"
```

---

## Task 2：内部工具函数（canvas 绘制原语）

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-exporter.js`

这些是从 `miniprogram/utils/pdf-exporter.js:13-78` 复制的精简版本（不引用是因为原文件未导出这些函数，且需求差异微小）。

- [ ] **Step 2.1: 加 `_resetCanvas`**

在 `module.exports` 之前追加：

```js
function _resetCanvas(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}
```

- [ ] **Step 2.2: 加 `_wrapText`**

在 `_resetCanvas` 之后追加：

```js
function _wrapText(ctx, text, maxWidth) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
```

- [ ] **Step 2.3: 加 `_drawPlaceholder`**

在 `_wrapText` 之后追加：

```js
function _drawPlaceholder(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxW = w - 40 * SCALE;
  const lines = _wrapText(ctx, text, maxW);
  const lineH = 22 * SCALE;
  const totalH = lines.length * lineH;
  const startY = y + h / 2 - totalH / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x + w / 2, startY + i * lineH);
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}
```

- [ ] **Step 2.4: 加 `_drawImageContain`**

在 `_drawPlaceholder` 之后追加：

```js
function _drawImageContain(canvas, ctx, src, dx, dy, dw, dh, fallback) {
  return new Promise((resolve) => {
    if (!src) {
      _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
      resolve(false);
      return;
    }
    const img = canvas.createImage();
    img.onload = () => {
      const ratio = Math.min(dw / img.width, dh / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      try {
        ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
        resolve(true);
      } catch (e) {
        _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
        resolve(false);
      }
    };
    img.onerror = () => {
      _drawPlaceholder(ctx, dx, dy, dw, dh, fallback);
      resolve(false);
    };
    img.src = src;
  });
}
```

注意与 `pdf-exporter.js` 版本的差异：`resolve(true/false)` 返回图片是否成功加载，方便调用方（Task 3 探测多页存在性）判断。

- [ ] **Step 2.5: 加 canvas→PDF 相关函数**

在 `_drawImageContain` 之后追加：

```js
function _captureJpeg(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.85,
      success: (r) => resolve(r.tempFilePath),
      fail: reject,
    });
  });
}

function _readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve('data:image/jpeg;base64,' + r.data),
      fail: reject,
    });
  });
}

async function _addCanvasPage(doc, canvas, isFirstPage) {
  if (!isFirstPage) doc.addPage();
  const tmp = await _captureJpeg(canvas);
  const dataUrl = await _readBase64(tmp);
  doc.addImage(dataUrl, 'JPEG', 0, 0, A4_W_PT, A4_H_PT);
}

function _writeToTempFile(arrayBuffer, fileName) {
  return new Promise((resolve, reject) => {
    const filePath = `${wx.env.USER_DATA_PATH}/${Date.now()}-${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: arrayBuffer,
      success: () => resolve(filePath),
      fail: (err) => reject(new Error('writeFile failed: ' + (err && err.errMsg))),
    });
  });
}
```

- [ ] **Step 2.6: 提交**

```bash
git add miniprogram/utils/hardware-pdf-exporter.js
git commit -m "feat(hardware-pdf): 加 canvas 绘制/PDF 输出工具函数"
```

---

## Task 3：探测五金规范多页存在性

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-exporter.js`

策略（见 spec）：`wx.getFileSystemManager().accessSync` 对代码包内相对路径不可用，改用 image.onload/onerror 异步探测。从 `-1` 到 `-MAX_SPEC_PAGES` 逐张试加载，首次失败即停止；若 `-1` 也不存在则回退到无后缀单页；单页也不存在则该位置放占位符。

- [ ] **Step 3.1: 加 `_probeImage`**

在 Task 2 的工具函数之后追加：

```js
// 返回 Promise<boolean>：图片能否加载成功。用于探测代码包内资源是否存在。
function _probeImage(canvas, src) {
  return new Promise((resolve) => {
    const img = canvas.createImage();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}
```

- [ ] **Step 3.2: 加 `_resolveSpecPages`**

紧接 `_probeImage` 之后：

```js
// 返回五金规范图片路径数组（按 -1, -2 顺序或单页 fallback）。
// 若都不存在，返回 [null]（占位符会由渲染阶段处理）。
async function _resolveSpecPages(canvas) {
  // 优先扫 -1 -> -N 多页
  const multi = [];
  for (let i = 1; i <= MAX_SPEC_PAGES; i++) {
    const path = HARDWARE_DIR + '五金规范-' + i + '.jpg';
    const ok = await _probeImage(canvas, path);
    if (!ok) break;
    multi.push(path);
  }
  if (multi.length > 0) return multi;

  // 回退到无后缀单页
  const single = HARDWARE_DIR + '五金规范.jpg';
  const ok = await _probeImage(canvas, single);
  if (ok) return [single];

  // 都没有，返回单个 null 占位
  return [null];
}
```

- [ ] **Step 3.3: 加 `_buildSources`**

紧接 `_resolveSpecPages` 之后：

```js
// 构造按顺序的图片资源列表：
// 尺寸 → 五金规范（1-N 页）→ 国产 → 进口
async function _buildSources(canvas) {
  const specPages = await _resolveSpecPages(canvas);
  const sources = [];
  sources.push({
    path: HARDWARE_DIR + '衣柜尺寸.png',
    fallback: '衣柜尺寸图片缺失',
  });
  specPages.forEach((path) => {
    sources.push({
      path,
      fallback: '五金规范图片缺失，请将 五金规范.docx 另存为图片（.jpg）放入 cabinet-hardware/ 目录',
    });
  });
  sources.push({
    path: HARDWARE_DIR + '国产五金参数.jpg',
    fallback: '国产五金参数图片缺失',
  });
  sources.push({
    path: HARDWARE_DIR + '进口五金参数.jpg',
    fallback: '进口五金参数图片缺失',
  });
  return sources;
}
```

- [ ] **Step 3.4: 提交**

```bash
git add miniprogram/utils/hardware-pdf-exporter.js
git commit -m "feat(hardware-pdf): 加五金规范多页探测与资源列表构造"
```

---

## Task 4：渲染单页 + 主导出函数

**Files:**
- Modify: `miniprogram/utils/hardware-pdf-exporter.js`

- [ ] **Step 4.1: 加 `_renderImagePage`**

在 `_buildSources` 之后追加：

```js
// 渲染一页：白底 + 图片 contain 铺满整页（含 MARGIN）。
async function _renderImagePage(canvas, ctx, src, fallbackText) {
  _resetCanvas(ctx);
  const x = MARGIN;
  const y = MARGIN;
  const w = CANVAS_W - MARGIN * 2;
  const h = CANVAS_H - MARGIN * 2;
  await _drawImageContain(canvas, ctx, src, x, y, w, h, fallbackText);
}
```

- [ ] **Step 4.2: 替换 `exportHardware` 骨架为完整实现**

找到 Task 1 里写的：

```js
async function exportHardware({ canvas, fileName }) {
  throw new Error('not implemented');
}
```

替换为：

```js
async function exportHardware({ canvas, fileName }) {
  if (!canvas) throw new Error('canvas is required');

  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const sources = await _buildSources(canvas);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let isFirst = true;

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    await _renderImagePage(canvas, ctx, s.path, s.fallback);
    await _addCanvasPage(doc, canvas, isFirst);
    isFirst = false;
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}
```

- [ ] **Step 4.3: 提交**

```bash
git add miniprogram/utils/hardware-pdf-exporter.js
git commit -m "feat(hardware-pdf): 完成主导出流程"
```

---

## Task 5：plan-list 页面接线（wxml）

**Files:**
- Modify: `miniprogram/pages/plan-list/index.wxml`

现有 `.export-btn-wrap` 被 `wx:if="{{plans.length}}"` 包裹，方案为空时整个消失。需要让「导出五金/尺寸」按钮**不受 plans 数量约束**。

- [ ] **Step 5.1: 修改 export-btn-wrap 结构**

打开 `miniprogram/pages/plan-list/index.wxml`，定位到第 42-44 行的现有块：

```xml
<view class="export-btn-wrap" wx:if="{{plans.length}}">
  <view class="export-btn" bindtap="onTapExport">导出方案信息</view>
</view>
```

替换为：

```xml
<view class="export-btn-wrap">
  <view class="export-btn" wx:if="{{plans.length}}" bindtap="onTapExport">导出方案信息</view>
  <view class="export-btn export-btn-hardware" bindtap="onTapExportHardware">导出五金/尺寸</view>
</view>
```

说明：外层容器无 `wx:if`，第一个按钮保留 `wx:if`（无方案时隐藏），第二个按钮始终显示。

- [ ] **Step 5.2: 追加第二个 filename-input-modal**

在现有 `<filename-input-modal ...>` 块（第 53-57 行）之后追加：

```xml
<filename-input-modal
  visible="{{hardwareExportNameOpen}}"
  defaultValue="五金尺寸参考.pdf"
  bind:cancel="onHardwareExportNameCancel"
  bind:confirm="onHardwareExportNameConfirm">
</filename-input-modal>
```

- [ ] **Step 5.3: 提交**

```bash
git add miniprogram/pages/plan-list/index.wxml
git commit -m "feat(plan-list): 加导出五金/尺寸按钮和命名弹窗"
```

---

## Task 6：plan-list 页面接线（wxss）

**Files:**
- Modify: `miniprogram/pages/plan-list/index.wxss`

现有 `.export-btn` 是圆角胶囊按钮，两个按钮上下堆叠时需要一点间距。

- [ ] **Step 6.1: 加按钮间距**

打开 `miniprogram/pages/plan-list/index.wxss`，定位到第 163-173 行的现有 `.export-btn-wrap` / `.export-btn` 定义。在 `.export-btn:active` 之后追加：

```css
.export-btn + .export-btn { margin-top: 20rpx; }
```

（相邻兄弟选择器：当两个 export-btn 相邻时，第二个上外边距 20rpx。）

- [ ] **Step 6.2: 提交**

```bash
git add miniprogram/pages/plan-list/index.wxss
git commit -m "feat(plan-list): 两个导出按钮间距样式"
```

---

## Task 7：plan-list 页面接线（js）

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js`

- [ ] **Step 7.1: 引入 hardware-pdf-exporter**

打开 `miniprogram/pages/plan-list/index.js`，定位到文件顶部 require 区（第 1-4 行）：

```js
const planStore = require('../../utils/plan-store.js');
const cloud = require('../../utils/cloud.js');
const pdfExporter = require('../../utils/pdf-exporter.js');
const filenameCleaner = require('../../utils/filename-cleaner.js');
```

在 `pdfExporter` 那行之后追加一行：

```js
const hardwarePdfExporter = require('../../utils/hardware-pdf-exporter.js');
```

- [ ] **Step 7.2: 加 data 字段**

定位到 `data:` 块（第 21-28 行）：

```js
  data: {
    plans: [],
    confirmDelete: null,
    toast: '',
    exportSelectOpen: false,
    exportNameOpen: false,
    _selectedExportIds: [],
  },
```

在 `_selectedExportIds: []` 后加一个字段（保持前面尾随逗号）：

```js
  data: {
    plans: [],
    confirmDelete: null,
    toast: '',
    exportSelectOpen: false,
    exportNameOpen: false,
    _selectedExportIds: [],
    hardwareExportNameOpen: false,
  },
```

- [ ] **Step 7.3: 加三个处理函数**

定位到现有 `showToast` 方法（约第 136 行）之前，插入：

```js
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
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (err) => {
          wx.showModal({
            title: '预览失败',
            content: 'PDF 已生成在 ' + filePath + '\n错误: ' + (err && err.errMsg),
            showCancel: false,
          });
        },
      });
    } catch (err) {
      wx.hideLoading();
      console.error('exportHardware failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    }
  },

```

- [ ] **Step 7.4: 提交**

```bash
git add miniprogram/pages/plan-list/index.js
git commit -m "feat(plan-list): 接线导出五金/尺寸的处理函数"
```

---

## Task 8：目视验证

**Files:**（无代码改动）

在微信开发者工具中打开项目、点「工具 → 构建 npm」（若之前没做过），编译进入 `pages/plan-list` 页面。

- [ ] **Step 8.1: UI 检查**

- 页面底部应出现两个按钮：「导出方案信息」（现有）和「导出五金/尺寸」（新增），两者上下堆叠、间距 20rpx。
- 方案数量为 0 时：只显示「导出五金/尺寸」按钮。
- 方案数量 ≥ 1 时：显示两个按钮。

- [ ] **Step 8.2: 图片就绪场景的导出**

前提：`cabinet-hardware/` 目录下四张图（含 `五金规范.jpg`）都已就位。

1. 点击「导出五金/尺寸」→ 弹出命名框，默认值应为「五金尺寸参考.pdf」。
2. 直接点「确认导出」→ 应看到「正在生成 PDF…」加载态。
3. 加载结束后打开 PDF 预览。
4. 逐页验证：
   - 第 1 页：`衣柜尺寸.png`，contain 居中铺满
   - 第 2 页：五金规范图片
   - 第 3 页：`国产五金参数.jpg`
   - 第 4 页：`进口五金参数.jpg`

- [ ] **Step 8.3: 五金规范多页场景**

前提：把 `五金规范.jpg` 复制为 `五金规范-1.jpg` 和 `五金规范-2.jpg`，删掉无后缀版本。重新导出。

- 第 2、3 页应为两页五金规范；第 4、5 页为国产、进口。
- 总页数 5 页。

- [ ] **Step 8.4: 图片缺失降级**

前提：把 `国产五金参数.jpg` 临时重命名为 `国产五金参数.jpg.bak`。重新导出。

- 对应页应为灰底 + 文字「国产五金参数图片缺失」。
- 其他页正常。

测试完记得改回文件名。

- [ ] **Step 8.5: 空方案列表场景**

前提：删除所有已保存方案（或用一个新的开发者工具环境）。

- 页面上只显示「导出五金/尺寸」按钮。
- 点击后正常走完流程。

---

## Task 9：完工提交（可选）

**Files:**（无代码改动）

- [ ] **Step 9.1: 汇总验证结果**

如果 Task 8 全部通过，无需追加提交。若在验证中修复了任何小 bug，为每个 fix 单独提交。

- [ ] **Step 9.2: 更新已删除文件的状态（可选）**

`git status` 显示 `docs/cream-coloured.png` 等文件被删除但未提交。这些与本次工作无关，不在本 PR 范围内。**不要**在本次提交中处理。

---

## 附录：改动清单速览

| 文件 | 类型 | 说明 |
|------|------|------|
| `miniprogram/utils/hardware-pdf-exporter.js` | 新增 | 五金/尺寸 PDF 导出器 |
| `miniprogram/pages/plan-list/index.js` | 修改 | require + data 字段 + 3 个处理函数 |
| `miniprogram/pages/plan-list/index.wxml` | 修改 | 加按钮 + 加第二个命名弹窗 |
| `miniprogram/pages/plan-list/index.wxss` | 修改 | 相邻按钮间距 |
| `miniprogram/cabinet/utils/cabinet-hardware/五金规范.jpg`（或 `-N.jpg`） | 用户手动准备 | docx → 图片 |

---

## 自审记录

**Spec 覆盖度：**
- ✅ 按钮位置在「导出方案信息」之后 → Task 5
- ✅ 无需选择方案 → Task 7（`onTapExportHardware` 直接开命名弹窗）
- ✅ 页面顺序 尺寸→规范→国产→进口 → Task 3 `_buildSources`
- ✅ 每页只有图片 contain 铺满 → Task 4 `_renderImagePage`
- ✅ 五金规范多页支持 → Task 3 `_resolveSpecPages`
- ✅ 图片缺失降级为占位符 → Task 2.3 `_drawPlaceholder`、Task 2.4 `_drawImageContain` 兜底
- ✅ 复用 `filename-input-modal` + `defaultValue` → Task 5.2、Task 7.3
- ✅ 复用 `filenameCleaner.cleanFileName` → Task 7.3
- ✅ 空方案列表按钮仍可用 → Task 5.1（把 `wx:if` 移到内层按钮）
- ✅ 生成失败 toast → Task 7.3
- ✅ 不加单元测试 → 无对应 Task

**类型/命名一致性：**
- `hardwarePdfExporter.exportHardware({ canvas, fileName })` — Task 4.2 定义、Task 7.3 调用 ✅
- `hardwareExportNameOpen` 字段 — Task 7.2 声明、Task 5.2 使用 ✅
- `onTapExportHardware` / `onHardwareExportNameCancel` / `onHardwareExportNameConfirm` — Task 7.3 定义、Task 5 wxml 绑定 ✅
- `HARDWARE_DIR` 常量 — Task 1.1 定义、Task 3.2/3.3 使用 ✅
- `MAX_SPEC_PAGES` — Task 1.1 定义、Task 3.2 使用 ✅

**无占位符/歧义。**
