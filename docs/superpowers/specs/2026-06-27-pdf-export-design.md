# 方案信息 PDF 导出功能设计

## 背景

LemonTA 小程序的「我的设计」（plan-list）页面列出用户保存的所有衣柜方案。每个方案在创建过程中已经积累了空间照片、墙体参数、布局预览截图、线框图、板材五金选择、成本计算等完整数据。目前用户没有办法把这些数据离线带走。

本次新增「导出方案信息」按钮，让用户挑选若干方案打包成一个 PDF，由微信文档预览页交付。

## 目标

- 在 plan-list 页面下方新增「导出方案信息」按钮。
- 用户可勾选要导出的方案（一个或多个，不强制全选）。
- 用户可自定义 PDF 文件名，默认值为「我的衣柜方案.pdf」。
- 每个方案在 PDF 中至少包含：空间照片、墙体尺寸、转角与加高信息、布局预览截图、线框图、板材五金选择、成本明细。
- 生成完成后通过 `wx.openDocument` 让用户预览，并自行通过微信预览页右上角菜单保存到文件或转发。

## 非目标

- 不做 PDF 上传到云端 / 不返回下载链接（现有的「下载方案文件」按钮走的是另一条路径，本次不动）。
- 不做云端 PDF 生成。整个 PDF 在小程序前端生成。
- 不补全已丢失的临时照片（space-setup 保存的 photoPath 是微信临时路径，重启后会失效；本次不增加云存储备份，照片丢了就跳过）。
- 不做用户体系改造（userTag 当前固定为 'guest'，文件名通过用户输入获取）。

## 用户流程

1. 在 plan-list 页面，已保存方案列表下方显示「导出方案信息」按钮。
   - 列表为空时按钮禁用并灰显。
2. 用户点击按钮 → 弹出「选择方案」弹窗。
   - 列表内每行一个方案，显示方案名 + 副信息（W×H、转角、柜子数）。
   - 每行右侧有勾选框。
   - 顶部有「全选 / 取消全选」开关。
   - 底部「取消」与「下一步」按钮。「下一步」在至少勾选一项时可点。
3. 点「下一步」→ 弹出「文件名」输入弹窗。
   - 单行输入框，默认值「我的衣柜方案.pdf」。
   - 用户可改文本。
   - 底部「取消」与「确认导出」按钮。
4. 点「确认导出」→ 弹窗关闭，显示全屏 loading「正在生成 PDF…」。
5. PDF 生成完成 → loading 消失 → 调 `wx.openDocument(filePath, { fileType: 'pdf' })`。
6. 用户在微信预览页右上角菜单选择「保存到手机」「发送给朋友」等微信内置操作。

边界：
- 文件名不带 `.pdf` 时自动补齐。
- 文件名包含 `/ \ : * ? " < > |` 等非法字符时，自动替换为 `_`。
- 文件名为空时，回退到默认值「我的衣柜方案.pdf」。

## PDF 版面

PDF 整体顺序：[方案 1 的所有页] → [分隔页] → [方案 2 的所有页] → [分隔页] → ……

只有一个方案时，不生成分隔页。

### 方案分隔页（仅多方案时存在）

居中显示方案名（48pt），下方一行小字「方案 N / 总数」。

### 第 1 页：方案概览

- 顶部标题区：
  - 方案名（24pt 加粗）
  - 副标题（12pt）：`{W} × {H} cm · {cornerLabel}{加高时追加 " · 加高"}`
- 上半区：
  - 左侧空间照片（约页宽 45%，等比缩放，无照片或路径失效则画灰底「无照片」占位）
  - 右侧文字块：墙体尺寸、转角类型、是否加高，每项一行
- 下半区：
  - 布局预览截图 `plan.previewImage`（彩色 3D 带墙，宽占页面 90%，等比缩放）
  - 缺失时画灰底「无预览」占位

### 第 2 页：线框图 + 板材五金

- 上半区：线框图 `plan.wireframeImage`（去墙、有编号），宽占页面 90%，等比缩放；缺失时画灰底「无线框图」占位
- 下半区：板材五金，5 行
  - 板材：`materials.panel`
  - 柜门面板：`materials.doorPanel`
  - 柜门工艺：`materials.doorCraft`
  - 五金：`materials.hardware`
  - 灯带：`materials.lighting`

### 第 3+ 页：成本明细

- 顶部：「总价：¥{grandTotal}」
- 逐柜体输出，每个柜体一段：
  - 段头：柜体序号 + 型号 + 尺寸（如「① 50cm 标准柜 · L01 50×60×230」）
  - 小计金额
  - 明细表（板材 + 五金两个子表）
    - 表头：名称 / 规格 / 数量 / 单价 / 小计
    - 数据来自 `cost.modules[i].detail`，过滤掉 qty==0 或 total==0 的行
- 当前页剩余高度装不下下一段时，调 `doc.addPage()`。

## 文件 / 模块结构

### 新增

- `miniprogram/vendor/jspdf.min.js` — jsPDF UMD 构建产物。约 350KB。
- `miniprogram/vendor/NotoSansSC-normal.js` — 思源黑体（子集化简版）以 base64 形式注入 jsPDF 的字体文件。预计 1–2 MB。
- `miniprogram/utils/pdf-exporter.js` — 唯一公开接口 `exportPlans(plans, fileName) → Promise<filePath>`。
- `miniprogram/components/plan-select-modal/` — 「选择方案」弹窗组件，含 `index.{js,wxml,wxss,json}`。
- `miniprogram/components/filename-input-modal/` — 「文件名」输入弹窗组件，含 `index.{js,wxml,wxss,json}`。

### 修改

- `miniprogram/pages/plan-list/index.js` — 添加 onTapExport / 弹窗状态 / 调用 pdf-exporter。
- `miniprogram/pages/plan-list/index.wxml` — 在列表下方加按钮、引用两个新组件。
- `miniprogram/pages/plan-list/index.wxss` — 按钮样式。
- `miniprogram/pages/plan-list/index.json` — 注册两个新组件。

### pdf-exporter.js 内部分工

单文件，约 500–700 行，内部分函数：

- `_ensureFont()` — 首次调用时把字体 base64 注入 jsPDF；缓存到 module-level，第二次直接返回。
- `_drawOverviewPage(doc, plan)` — 第 1 页。
- `_drawLayoutPage(doc, plan)` — 第 2 页。
- `_drawCostPages(doc, plan)` — 成本明细，可能多页，函数内部自行 `addPage`。
- `_drawSeparatorPage(doc, plan, idx, total)` — 方案分隔页。
- `_drawImageOrPlaceholder(doc, imgSrc, x, y, w, h, fallbackText)` — 图片或占位灰框。
- `_writeToTempFile(arrayBuffer)` — 写入 `wx.env.USER_DATA_PATH/{timestamp}-{cleanFileName}`，返回 filePath。
- `exportPlans(plans, fileName)` — 顶层调度，循环方案、调对应 draw 函数、收尾保存。

不拆多文件的理由：每个 draw 函数核心都是「在 doc 上画图画字」，传 doc 是主旋律；拆开后跨文件传递参数反而显得绕。如果未来某个 draw 超过 200 行，可考虑独立成文件。

## 数据流

```
plan-list.onTapExport
  ↓
弹「选择方案」弹窗 (PlanSelectModal)
  ↓ confirm(selectedPlanIds[])
plan-list 收集勾选 → 弹「文件名」弹窗 (FilenameInputModal)
  ↓ confirm(rawFileName)
plan-list 清洗文件名 → wx.showLoading
  ↓
pdfExporter.exportPlans(plans, cleanFileName)
  ↓ 内部
  _ensureFont()
  new jsPDF({ unit: 'pt', format: 'a4' })  // doc 启动时已在 page 1
  for (i = 0; i < plans.length; i++) {
    if (i > 0) {
      doc.addPage();
      _drawSeparatorPage(doc, plans[i], i + 1, plans.length);
      doc.addPage();
    }
    _drawOverviewPage(doc, plans[i]);
    doc.addPage(); _drawLayoutPage(doc, plans[i]);
    doc.addPage(); _drawCostPages(doc, plans[i]);  // 内部可能再 addPage
  }
  const buf = doc.output('arraybuffer');
  filePath = await _writeToTempFile(buf, cleanFileName);
  ↓
plan-list 拿到 filePath → wx.hideLoading → wx.openDocument({filePath, fileType:'pdf'})
```

## 错误处理

- **字体注入失败**（vendor 文件缺失或解析失败）：showModal「PDF 字体加载失败，请联系开发」，不进入 wx.openDocument。
- **某张图为空或加载失败**：调用 `_drawImageOrPlaceholder` 时降级为灰底占位文本，不打断整体生成。
- **某个方案的 cost / cabinets 字段为空**（数据不完整）：成本页只画「数据缺失」一行，不抛异常。
- **生成中抛异常**：catch 后 `wx.hideLoading`、`wx.showToast({title:'生成失败', icon:'none'})`，并 `console.error` 详细堆栈。
- **wx.openDocument 失败**：fail 回调里 showModal「PDF 已生成在 [filePath]，请到文件管理器查看」。
- **写文件失败**（USER_DATA_PATH 满）：reject Promise，外层走「生成失败」分支。

## 测试

### 单元测试（Node + jest）

- `_drawImageOrPlaceholder` 在 `imgSrc=''`、`undefined` 时不抛异常。
- 文件名清洗函数：
  - 空 → `我的衣柜方案.pdf`
  - 无 `.pdf` 后缀 → 补齐
  - 含非法字符 → 替换 `_`
- `exportPlans` 在以下方案下能跑通不抛异常（mock jsPDF）：
  - 单方案、多方案
  - 方案缺 previewImage / wireframeImage / photoPath
  - 方案缺 cabinets / cost

### 手工测试

- 微信开发者工具 + 至少一台真机各跑一遍：
  - 单方案导出 → 文字不乱码，图片清晰，能预览
  - 3 个方案导出 → 分隔页正确，页码不错乱
  - 全选 → 取消全选 切换正常
  - 文件名改成「老李的衣柜.pdf」→ 微信预览页显示正确名字
  - 关掉 vendor 字体文件，确认错误提示出现且不卡死

## 兼容性 / 性能

- jsPDF UMD 构建在小程序里需要包装一层全局 `globalThis = {}` shim，参考社区方案。
- 字体注入会让单次生成内存峰值升高（base64 解码），3 方案以内 < 50MB，可接受；超过 5 方案时可加分批生成或提示用户分批导出，本次不实现。
- iOS 真机 `wx.openDocument` 对 PDF 支持原生；Android 部分机型可能需要安装文件查看器，开发者工具下会以 webview 预览。
