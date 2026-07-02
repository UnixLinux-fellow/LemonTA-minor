# 导出方案成本 PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在方案列表页新增"导出方案成本"按钮，生成的 PDF 在"导出方案信息"基础上加成本列/总计和成本透视页。

**Architecture:** 扩展现有 `utils/pdf-exporter.js`，新增入口 `exportPlansWithCost` 复用 A4 常量、canvas 工具、jsPDF 与现有渲染函数（`_renderSeparator`、`_renderOverview`、`_renderLayout`）。总表函数 `_renderOverviewTable` 加可选 `options.showCostColumn/costMap` 参数；新增 `_renderCostBreakdown` 多页渲染每方案成本透视。plan-list 页新增按钮 + 两个 modal + 4 个回调。

**Tech Stack:** 微信小程序原生 API、`jsPDF`、canvas 2D、`utils/cost-engine.js`。

**Spec:** `docs/superpowers/specs/2026-07-02-plan-cost-export-design.md`

---

## File Structure

**Modify:**
- `miniprogram/utils/pdf-exporter.js`
  - `_renderOverviewTable(ctx, plans)` → `_renderOverviewTable(ctx, plans, options)`
  - 新增 `_computeCostFor(plan)` helper
  - 新增 `_renderCostBreakdown(canvas, ctx, plan, cost)` 渲染函数（含分页逻辑）
  - 新增导出入口 `exportPlansWithCost({ canvas, plans, fileName })`
  - `module.exports` 新增 `exportPlansWithCost`
- `miniprogram/pages/plan-list/index.js`
  - 顶部新增 `require` `cost-engine`
  - `data` 新增 3 项
  - 新增 4 个回调（`onTapExportCost`、`onCostExportSelectCancel/Confirm`、`onCostExportNameCancel/Confirm`）
- `miniprogram/pages/plan-list/index.wxml`
  - 新增 `.export-btn-wrap-cost` 块
  - 新增 2 个 modal 实例
- `miniprogram/pages/plan-list/index.wxss`
  - 新增 `.export-btn-wrap-cost` 样式

**Not touched:**
- `utils/cost-engine.js`（只读，不改）
- 现有 `exportPlans`（保持行为不变）
- 其他导出流程（方案信息、五金/尺寸）

---

## Task 1: 总表函数加可选成本列参数（向后兼容）

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js:392-502`

目标：把 `_renderOverviewTable(ctx, plans)` 改为 `_renderOverviewTable(ctx, plans, options)`。`options` 为空时行为完全不变（4 列，原样）；`options.showCostColumn === true` 时切到 5 列 + 总计行。

- [ ] **Step 1: 读取现有 `_renderOverviewTable` 实现**

Read `miniprogram/utils/pdf-exporter.js:392-502` 了解当前结构。已知：
- 4 列，比例 `[0.32, 0.24, 0.22, 0.22]`
- 表头文字 `['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数']`
- 每行内链信息 push 到 `entries[]` 返回

- [ ] **Step 2: 添加 currency 格式化 helper**

在 `pdf-exporter.js` 里 `_wrapText` 之后（约 58 行后）插入：

```js
function _formatCurrency(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '¥' + parts.join('.');
}
```

- [ ] **Step 3: 改造 `_renderOverviewTable` 签名与列定义**

把:
```js
function _renderOverviewTable(ctx, plans) {
```
改为:
```js
function _renderOverviewTable(ctx, plans, options) {
  const showCost = !!(options && options.showCostColumn);
  const costMap = (options && options.costMap) || new Map();
```

在 `_renderOverviewTable` 内部，把:
```js
const colRatios = [0.32, 0.24, 0.22, 0.22];
```
改为:
```js
const colRatios = showCost
  ? [0.26, 0.20, 0.18, 0.18, 0.18]
  : [0.32, 0.24, 0.22, 0.22];
```

把:
```js
const headers = ['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数'];
```
改为:
```js
const headers = showCost
  ? ['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数', '方案成本']
  : ['方案名称', '空间尺寸', '普通衣柜个数', '加高衣柜个数'];
```

- [ ] **Step 4: 在数据行循环里新增成本单元格绘制**

在 `visible.forEach((plan, i) => {` 内部，`ctx.fillText(String(counts.raise), colX[3] + headerPadX, cellCenterY);` 那行之后添加：

```js
    if (showCost) {
      const cost = costMap.get(plan.id);
      if (cost && typeof cost.grandTotal === 'number') {
        ctx.fillStyle = '#1f2937';
        ctx.fillText(_formatCurrency(cost.grandTotal), colX[4] + headerPadX, cellCenterY);
      } else {
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('未算成本', colX[4] + headerPadX, cellCenterY);
      }
    }
```

- [ ] **Step 5: 加总计行（仅 showCost）**

在数据行循环结束（`ctx.textBaseline = 'top';` 之前）加入：

```js
  if (showCost) {
    const totalRowY = startY + visible.length * rowH;
    // 总计行深底 + 白字
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(tableX, totalRowY, tableW, rowH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const totalCenterY = totalRowY + rowH / 2;
    const totalLabel = `总计（共 ${visible.length} 个方案）`;
    ctx.fillText(totalLabel, colX[0] + headerPadX, totalCenterY);

    let sum = 0;
    let counted = 0;
    let missing = 0;
    visible.forEach((p) => {
      const c = costMap.get(p.id);
      if (c && typeof c.grandTotal === 'number') {
        sum += c.grandTotal;
        counted += 1;
      } else {
        missing += 1;
      }
    });
    let totalCellText;
    if (counted === 0) {
      totalCellText = '—';
    } else if (missing > 0) {
      totalCellText = _formatCurrency(sum) + ' (不含未算 ' + missing + ' 个)';
    } else {
      totalCellText = _formatCurrency(sum);
    }
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.fillText(totalCellText, colX[4] + headerPadX, totalCenterY);
    ctx.fillStyle = '#1f2937';
  }
```

- [ ] **Step 6: 语法检查 + 手动确认现有导出仍工作**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

不要跑小程序验证——需要人工。假设：现有调用点 `exportPlans` 中 `_renderOverviewTable(ctx, plans)` 未传 options，走旧 4 列分支，行为不变。

- [ ] **Step 7: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 总表函数支持可选成本列"
```

---

## Task 2: 加 `_computeCostFor` helper

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`（顶部添加 require + helper）

- [ ] **Step 1: 顶部添加 cost-engine 引用**

在 `pdf-exporter.js` 第 3 行 `const jspdfModule = require(...)` 之后添加：

```js
const costEngine = require('../cabinet/utils/cost-engine.js');
```

- [ ] **Step 2: 加 `_computeCostFor` helper**

在 `_formatCurrency` 之后添加：

```js
function _computeCostFor(plan) {
  if (!plan || !plan.materials) return null;
  try {
    return costEngine.calc({
      cabinets: plan.cabinets || [],
      materials: plan.materials,
      wall: plan.wall,
    });
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 3: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 加 _computeCostFor helper"
```

---

## Task 3: 新增 `_renderCostBreakdown`（未算成本占位分支）

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

目标：先实现 `_renderCostBreakdown` 的骨架和"未算成本"分支。已算分支在 Task 4-6 逐步补齐。

- [ ] **Step 1: 添加函数骨架**

在 `_renderOverviewTable` 之后添加：

```js
// 渲染方案的"成本透视"部分：
// - 未算成本：1 页占位提示
// - 已算成本：从上向下堆叠卡片，页满则新开一页
// 返回渲染的 canvas 数组（每张对应 PDF 里的一页 JPEG）。
// 调用方负责用 _addCanvasPage 把每张塞进 doc。
async function _renderCostBreakdown(canvas, ctx, plan, cost) {
  const pages = []; // 每项：一个已在 canvas 上画完的快照，用于随后 _captureJpeg
  // 骨架：先只实现未算分支。已算分支由 Task 4-6 补齐。
  if (!cost) {
    _renderCostPlaceholderPage(ctx, plan);
    pages.push('rendered');
    return pages;
  }
  // 已算分支占位（Task 4 会替换）
  _renderCostPlaceholderPage(ctx, plan, '（成本透视已算分支占位——Task 4 会填充）');
  pages.push('rendered');
  return pages;
}

// 未算成本占位页：方案名 + 副标题 + 居中提示
function _renderCostPlaceholderPage(ctx, plan, overrideText) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
  ctx.fillText(plan.name || '', MARGIN, MARGIN);

  ctx.fillStyle = '#6b7280';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);

  const msg = overrideText || '未算成本，请到成本页选择板材/五金后再导出';
  ctx.fillStyle = '#9ca3af';
  ctx.font = (16 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, CANVAS_W / 2, CANVAS_H / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 加 _renderCostBreakdown 骨架 + 未算成本占位"
```

---

## Task 4: `_renderCostBreakdown` 已算分支 —— 页眉 + 柜子卡片 + 4 格网格 + 分页

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

目标：已算成本时，从上向下堆叠"柜子卡片"，每张卡片视为不可切割整体，超页则新开一页。这一步先只画卡头 + 4 格网格（板材/五金/运输/安装），暂不含展开明细表。展开明细在 Task 5。

- [ ] **Step 1: 引入分页管理器 helper**

在 `_renderCostPlaceholderPage` 之后添加：

```js
// 分页布局器：维护当前 canvas 的 y 光标；调用 addBlock(height, drawFn) 时
// 若剩余高度不够则先 finalize 当前页（推入 pages），再复位光标并画。
function _createCostPageManager(canvas, ctx, plan) {
  const pageTopContent = MARGIN + 100 * SCALE; // 页眉占 100pt*SCALE 左右
  const pageBottom = CANVAS_H - MARGIN;
  const state = { y: 0, pages: [], canvas, ctx, plan };

  function _drawHeader() {
    _resetCanvas(ctx);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
    ctx.fillText(plan.name || '', MARGIN, MARGIN);

    ctx.fillStyle = '#6b7280';
    ctx.font = (14 * SCALE) + 'px sans-serif';
    ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);
  }

  function beginPage() {
    _drawHeader();
    state.y = pageTopContent;
  }

  function commitPage() {
    state.pages.push('rendered');
  }

  function remaining() {
    return pageBottom - state.y;
  }

  function addBlock(height, drawFn) {
    if (state.y + height > pageBottom && state.y > pageTopContent) {
      commitPage();
      beginPage();
      // 首次翻页后仍不够：允许溢出（这一版不切割，写日志）
      if (height > pageBottom - pageTopContent) {
        // Task 5 里明细表分页时可能会切分行；此处只针对卡片整体块的极端情况
      }
    }
    drawFn(state.y);
    state.y += height;
  }

  function finalize() {
    if (state.y > pageTopContent) commitPage();
    return state.pages;
  }

  beginPage();
  return { addBlock, remaining, finalize };
}
```

- [ ] **Step 2: 加柜子卡片绘制 helper**

在 `_createCostPageManager` 之后添加：

```js
function _drawCabinetCard(ctx, module_, x, y, w) {
  const headH = 36 * SCALE;
  const gridH = 60 * SCALE;
  const totalH = headH + gridH;

  // 卡头背景
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y, w, headH);

  // 卡头文字（左：名称，右：¥total）
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headCenterY = y + headH / 2;
  const title = module_.label + ' ' + (module_.code || '') + '-' + module_.w + '-' + module_.h;
  ctx.fillText(title, x + 12 * SCALE, headCenterY);
  const priceText = _formatCurrency(module_.total || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 12 * SCALE, headCenterY);

  // 4 格网格
  const gridY = y + headH;
  const cellW = w / 2;
  const cellH = gridH / 2;
  const cells = [
    ['板材合计', module_.panelCost],
    ['运输费用', module_.transport],
    ['五金配件', module_.hardwareCost],
    ['安装费用', module_.install],
  ];
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = Math.max(1, 1 * SCALE);
  for (let i = 0; i < 4; i++) {
    const cx = x + (i % 2) * cellW;
    const cy = gridY + Math.floor(i / 2) * cellH;
    ctx.strokeRect(cx, cy, cellW, cellH);
    ctx.fillStyle = '#6b7280';
    ctx.font = (12 * SCALE) + 'px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(cells[i][0], cx + 12 * SCALE, cy + 10 * SCALE);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
    ctx.fillText(_formatCurrency(cells[i][1] || 0), cx + 12 * SCALE, cy + 30 * SCALE);
  }

  ctx.textBaseline = 'top';
  return totalH;
}
```

- [ ] **Step 3: 替换 `_renderCostBreakdown` 已算分支**

删除 Task 3 里已算分支的占位调用（`_renderCostPlaceholderPage(ctx, plan, '...')`），替换为：

```js
  if (!cost) {
    _renderCostPlaceholderPage(ctx, plan);
    pages.push('rendered');
    return pages;
  }

  const mgr = _createCostPageManager(canvas, ctx, plan);
  const contentX = MARGIN;
  const contentW = CANVAS_W - MARGIN * 2;
  const cardGap = 20 * SCALE;

  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const cardH = 36 * SCALE + 60 * SCALE; // 卡头 + 4 格
    mgr.addBlock(cardH + cardGap, (y) => {
      _drawCabinetCard(ctx, m, contentX, y, contentW);
    });
  }

  // 收口条 + 总计（Task 6 会替换）
  return mgr.finalize();
```

- [ ] **Step 4: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 成本透视页渲染柜子卡片 + 分页"
```

---

## Task 5: 柜子卡片下追加展开的板材/五金明细表

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

- [ ] **Step 1: 加明细表绘制 helper**

在 `_drawCabinetCard` 之后添加：

```js
// 通用 5 列表格绘制：
//   columns: [{ title, ratio }] 5 项
//   rows: [[cellText, ...5]]
//   起始 y，返回渲染高度。
function _drawDetailTable(ctx, columns, rows, x, y, w) {
  const headerH = 26 * SCALE;
  const rowH = 22 * SCALE;
  const padX = 8 * SCALE;

  // 计算列 x
  const colX = [];
  let cx = x;
  for (let i = 0; i < columns.length; i++) {
    colX.push(cx);
    cx += w * columns[i].ratio;
  }

  // 表头
  ctx.fillStyle = '#374151';
  ctx.fillRect(x, y, w, headerH);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (11 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headerCenterY = y + headerH / 2;
  columns.forEach((col, i) => {
    ctx.fillText(col.title, colX[i] + padX, headerCenterY);
  });

  // 空行占位
  const useRows = (Array.isArray(rows) && rows.length) ? rows : [['无数据', '', '', '', '']];

  // 行
  const startY = y + headerH;
  useRows.forEach((row, i) => {
    const ry = startY + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(x, ry, w, rowH);
    }
    ctx.fillStyle = '#1f2937';
    ctx.font = (11 * SCALE) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const cellY = ry + rowH / 2;
    for (let c = 0; c < columns.length; c++) {
      const text = row[c] == null ? '' : String(row[c]);
      ctx.fillText(text, colX[c] + padX, cellY);
    }
  });

  ctx.textBaseline = 'top';
  return headerH + useRows.length * rowH;
}

function _panelDetailRows(module_) {
  const panels = (module_.detail && module_.detail.panels) || [];
  return panels.map((p) => [
    p.name || '',
    p.size || '',
    (p.area != null ? p.area + '㎡' : '') + (p.qty != null ? '×' + p.qty : ''),
    p.unit != null ? _formatCurrency(p.unit) : '',
    p.total != null ? _formatCurrency(p.total) : '',
  ]);
}

function _hardwareDetailRows(module_) {
  const hardware = (module_.detail && module_.detail.hardware) || [];
  return hardware.map((h) => [
    h.name || '',
    '数量',
    h.qty != null ? String(h.qty) : '',
    h.unit != null ? _formatCurrency(h.unit) : '',
    h.total != null ? _formatCurrency(h.total) : '',
  ]);
}

function _cabinetCardTotalHeight(module_) {
  const headH = 36 * SCALE;
  const gridH = 60 * SCALE;
  const gap = 8 * SCALE;
  const panelHeaderH = 26 * SCALE;
  const panelRowH = 22 * SCALE;
  const panelRows = ((module_.detail && module_.detail.panels) || []).length || 1;
  const hardwareRows = ((module_.detail && module_.detail.hardware) || []).length || 1;
  const panelTableH = panelHeaderH + panelRows * panelRowH;
  const hardwareTableH = panelHeaderH + hardwareRows * panelRowH;
  return headH + gridH + gap + panelTableH + gap + hardwareTableH;
}
```

- [ ] **Step 2: 更新 `_renderCostBreakdown` 已算分支：卡片 + 两张明细表作为一个块**

把 Task 4 里的：
```js
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const cardH = 36 * SCALE + 60 * SCALE;
    mgr.addBlock(cardH + cardGap, (y) => {
      _drawCabinetCard(ctx, m, contentX, y, contentW);
    });
  }
```

替换为：

```js
  const panelCols = [
    { title: '名称', ratio: 0.24 },
    { title: '尺寸', ratio: 0.24 },
    { title: '面积', ratio: 0.20 },
    { title: '单价', ratio: 0.16 },
    { title: '小计', ratio: 0.16 },
  ];
  const hardwareCols = [
    { title: '部件', ratio: 0.28 },
    { title: '规格', ratio: 0.16 },
    { title: '数量', ratio: 0.16 },
    { title: '单价', ratio: 0.20 },
    { title: '小计', ratio: 0.20 },
  ];

  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const gap = 8 * SCALE;
    const cardBlockH = _cabinetCardTotalHeight(m) + cardGap;
    mgr.addBlock(cardBlockH, (y) => {
      let cy = y;
      const cardH = _drawCabinetCard(ctx, m, contentX, cy, contentW);
      cy += cardH + gap;
      const panelH = _drawDetailTable(ctx, panelCols, _panelDetailRows(m), contentX, cy, contentW);
      cy += panelH + gap;
      _drawDetailTable(ctx, hardwareCols, _hardwareDetailRows(m), contentX, cy, contentW);
    });
  }
```

- [ ] **Step 3: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 成本透视展开板材/五金明细表"
```

---

## Task 6: 加收口条卡片 + 总成本预估

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

- [ ] **Step 1: 加收口条卡片 helper**

在 `_hardwareDetailRows` 之后添加：

```js
function _drawSkCard(ctx, sk, x, y, w) {
  const headH = 36 * SCALE;
  const bodyH = 30 * SCALE;
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(x, y, w, headH);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(sk.label || '收口条', x + 12 * SCALE, y + headH / 2);
  const priceText = _formatCurrency(sk.total || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 12 * SCALE, y + headH / 2);

  ctx.fillStyle = '#6b7280';
  ctx.font = (12 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('面积 ' + sk.area + '㎡ × 单价 ' + _formatCurrency(sk.unit || 0),
    x + 12 * SCALE, y + headH + 8 * SCALE);
  return headH + bodyH;
}

function _drawGrandTotalCard(ctx, grandTotal, x, y, w) {
  const h = 60 * SCALE;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff7c2';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('总成本预估', x + 20 * SCALE, y + h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  const priceText = _formatCurrency(grandTotal || 0);
  const priceW = ctx.measureText(priceText).width;
  ctx.fillText(priceText, x + w - priceW - 20 * SCALE, y + h / 2);
  ctx.textBaseline = 'top';
  return h;
}
```

- [ ] **Step 2: 在 `_renderCostBreakdown` 里追加收口条 + 总计**

在 Task 5 里 `for (let i = 0; i < modules.length; i++) { ... }` 循环之后、`return mgr.finalize();` 之前，替换 `// 收口条 + 总计（Task 6 会替换）` 那行为：

```js
  if (cost.sk) {
    const skH = 36 * SCALE + 30 * SCALE + cardGap;
    mgr.addBlock(skH, (y) => {
      _drawSkCard(ctx, cost.sk, contentX, y, contentW);
    });
  }
  const grandH = 60 * SCALE + cardGap;
  mgr.addBlock(grandH, (y) => {
    _drawGrandTotalCard(ctx, cost.grandTotal, contentX, y, contentW);
  });
```

- [ ] **Step 3: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 成本透视加收口条 + 总计"
```

---

## Task 7: 新入口 `exportPlansWithCost`

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

目标：在文件末尾新增导出入口，页序为：总表 → 每方案（分隔+封面+布局+成本透视 1..N 页）。

- [ ] **Step 1: 添加 `exportPlansWithCost`**

在现有 `exportPlans` 之后、`module.exports` 之前添加：

```js
async function exportPlansWithCost({ canvas, plans, fileName }) {
  if (!canvas) throw new Error('canvas is required');
  if (!Array.isArray(plans) || plans.length === 0) throw new Error('plans is empty');

  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let isFirst = true;

  // 1) 预计算每方案成本
  const costMap = new Map();
  plans.forEach((p) => {
    costMap.set(p.id, _computeCostFor(p));
  });

  // 2) 预计算每方案在 PDF 里"入口页"号（供总表内链）
  //    页序：目录页(1) + 每方案 [separator? + overview + layout + costBreakdown pages]
  //    每方案 costBreakdown 页数不定；分两次遍历不划算，且内链只跳"入口页"（第一个可见页），
  //    因此先假设每方案 costBreakdown 至少 1 页，剩余多出的页不影响内链跳转。
  let pageCursor = 1; // 目录占第 1 页
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    pageCursor += 1; // 入口页（i>0 是 separator，i==0 是 overview）
    p._tocPage = pageCursor;
    // 之后 layout + 至少 1 页 costBreakdown（若 > 1 页，不影响内链跳到第一个）
    pageCursor += (i === 0 ? 1 : 2);
    pageCursor += 1; // 至少 1 页 costBreakdown
  }

  // 3) 渲染总表
  const tocEntries = _renderOverviewTable(ctx, plans, {
    showCostColumn: true,
    costMap,
  });
  await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

  // 4) 逐方案渲染
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const cost = costMap.get(plan.id);

    if (i > 0) {
      _renderSeparator(ctx, plan, i + 1, plans.length);
      await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
    }
    await _renderOverview(canvas, ctx, plan);
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

    await _renderLayout(canvas, ctx, plan);
    await _addCanvasPage(doc, canvas, isFirst); isFirst = false;

    // 成本透视：可能 1..N 页
    // _renderCostBreakdown 内部 finalize 前每页画在同一个 canvas 上，
    // 但由于我们一次只有一个 canvas，需要在每"页"绘制完后立刻 _addCanvasPage。
    // 因此改造：让 _renderCostBreakdown 每完成一页就调用回调。
    await _renderAndFlushCostBreakdown(canvas, ctx, plan, cost, async () => {
      await _addCanvasPage(doc, canvas, isFirst); isFirst = false;
    });
  }

  // 5) 目录页内链
  if (doc.setPage && tocEntries.length) {
    try {
      doc.setPage(1);
      tocEntries.forEach((e) => {
        doc.link(e.x, e.y, e.w, e.h, { pageNumber: e.pageNumber });
      });
    } catch (err) {
      console.warn('[pdf] add toc links failed', err && err.message);
    }
  }

  const buf = doc.output('arraybuffer');
  return _writeToTempFile(buf, fileName);
}
```

- [ ] **Step 2: 加 `_renderAndFlushCostBreakdown`（重写 Task 3-6 里的分页管理器为 flush 模式）**

在 `_renderCostBreakdown` 之后添加：

```js
// 每完成一页就 flush（画完的 canvas 快照塞入 PDF），然后清空 canvas 继续画下一页。
// 与 _renderCostBreakdown 不同：这版直接接管 canvas 逐页输出，不再收集 pages 数组。
async function _renderAndFlushCostBreakdown(canvas, ctx, plan, cost, flushPage) {
  if (!cost) {
    _renderCostPlaceholderPage(ctx, plan);
    await flushPage();
    return;
  }

  const pageTopContent = MARGIN + 100 * SCALE;
  const pageBottom = CANVAS_H - MARGIN;
  const contentX = MARGIN;
  const contentW = CANVAS_W - MARGIN * 2;
  const cardGap = 20 * SCALE;
  let y = 0;
  let pageStarted = false;

  function beginPage() {
    _resetCanvas(ctx);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
    ctx.fillText(plan.name || '', MARGIN, MARGIN);
    ctx.fillStyle = '#6b7280';
    ctx.font = (14 * SCALE) + 'px sans-serif';
    ctx.fillText('成本透视', MARGIN, MARGIN + 46 * SCALE);
    y = pageTopContent;
    pageStarted = true;
  }

  async function endPage() {
    if (pageStarted) {
      await flushPage();
      pageStarted = false;
    }
  }

  async function addBlock(height, drawFn) {
    if (!pageStarted) beginPage();
    if (y + height > pageBottom && y > pageTopContent) {
      await endPage();
      beginPage();
    }
    drawFn(y);
    y += height;
  }

  const panelCols = [
    { title: '名称', ratio: 0.24 },
    { title: '尺寸', ratio: 0.24 },
    { title: '面积', ratio: 0.20 },
    { title: '单价', ratio: 0.16 },
    { title: '小计', ratio: 0.16 },
  ];
  const hardwareCols = [
    { title: '部件', ratio: 0.28 },
    { title: '规格', ratio: 0.16 },
    { title: '数量', ratio: 0.16 },
    { title: '单价', ratio: 0.20 },
    { title: '小计', ratio: 0.20 },
  ];

  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const gap = 8 * SCALE;
    const cardBlockH = _cabinetCardTotalHeight(m) + cardGap;
    await addBlock(cardBlockH, (cy) => {
      let yy = cy;
      const cardH = _drawCabinetCard(ctx, m, contentX, yy, contentW);
      yy += cardH + gap;
      const panelH = _drawDetailTable(ctx, panelCols, _panelDetailRows(m), contentX, yy, contentW);
      yy += panelH + gap;
      _drawDetailTable(ctx, hardwareCols, _hardwareDetailRows(m), contentX, yy, contentW);
    });
  }

  if (cost.sk) {
    const skH = 36 * SCALE + 30 * SCALE + cardGap;
    await addBlock(skH, (cy) => {
      _drawSkCard(ctx, cost.sk, contentX, cy, contentW);
    });
  }
  const grandH = 60 * SCALE + cardGap;
  await addBlock(grandH, (cy) => {
    _drawGrandTotalCard(ctx, cost.grandTotal, contentX, cy, contentW);
  });

  await endPage();
}
```

- [ ] **Step 3: 更新 `module.exports`**

把:
```js
module.exports = { exportPlans, _countCabinets };
```
改为:
```js
module.exports = { exportPlans, exportPlansWithCost, _countCabinets };
```

- [ ] **Step 4: 语法检查**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf-exporter): 加 exportPlansWithCost 入口"
```

---

## Task 8: plan-list 页新增按钮和回调

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js`
- Modify: `miniprogram/pages/plan-list/index.wxml`
- Modify: `miniprogram/pages/plan-list/index.wxss`

- [ ] **Step 1: `index.js` - `data` 新增字段**

Read `miniprogram/pages/plan-list/index.js` first.

`data` 内加入：
```js
    costExportSelectOpen: false,
    costExportNameOpen: false,
    _costSelectedIds: [],
```

- [ ] **Step 2: `index.js` - 新增 4 个回调**

在 `onHardwareExportName*` 或最后一个方法（`onTapExportHardware`）之后、`showToast` 之前添加：

```js
  onTapExportCost() {
    if (!this.data.plans.length) return;
    this.setData({ costExportSelectOpen: true });
  },

  onCostExportSelectCancel() {
    this.setData({ costExportSelectOpen: false });
  },

  onCostExportSelectConfirm(e) {
    this.setData({
      costExportSelectOpen: false,
      costExportNameOpen: true,
      _costSelectedIds: e.detail.ids || [],
    });
  },

  onCostExportNameCancel() {
    this.setData({ costExportNameOpen: false, _costSelectedIds: [] });
  },

  async onCostExportNameConfirm(e) {
    const fileName = filenameCleaner.cleanFileName(e.detail.value);
    const ids = this.data._costSelectedIds || [];
    this.setData({ costExportNameOpen: false, _costSelectedIds: [] });
    if (!ids.length) return;

    const plans = ids.map((id) => planStore.get(id)).filter(Boolean);

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    try {
      const canvas = await getPdfCanvas(this);
      const filePath = await pdfExporter.exportPlansWithCost({ canvas, plans, fileName });
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
      console.error('exportPlansWithCost failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    }
  },
```

- [ ] **Step 3: `index.wxml` - 新增按钮行与两个 modal**

在现有 `<view class="export-btn-wrap">...</view>` 块之后追加：

```xml
  <view class="export-btn-wrap-cost">
    <view class="export-btn" bindtap="onTapExportCost">导出方案成本</view>
  </view>
```

在最后一个 `<filename-input-modal>` 之后、`<canvas>` 之前，追加两个 modal：

```xml
  <plan-select-modal
    visible="{{costExportSelectOpen}}"
    plans="{{plans}}"
    bind:cancel="onCostExportSelectCancel"
    bind:confirm="onCostExportSelectConfirm">
  </plan-select-modal>

  <filename-input-modal
    visible="{{costExportNameOpen}}"
    defaultValue="方案成本.pdf"
    bind:cancel="onCostExportNameCancel"
    bind:confirm="onCostExportNameConfirm">
  </filename-input-modal>
```

- [ ] **Step 4: `index.wxss` - 新增样式**

在文件末尾追加：

```css
.export-btn-wrap-cost {
  padding: 0 32rpx 40rpx;
}
.export-btn-wrap-cost .export-btn {
  width: 100%;
}
```

- [ ] **Step 5: 语法检查**

Run:
```
node --check miniprogram/pages/plan-list/index.js
node --check miniprogram/utils/pdf-exporter.js
```
Expected: 无输出。

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/plan-list/index.js miniprogram/pages/plan-list/index.wxml miniprogram/pages/plan-list/index.wxss
git commit -m "feat(plan-list): 加导出方案成本按钮与命名弹窗"
```

---

## Task 9: 手动全流程验收 + 推送

- [ ] **Step 1: 覆盖 spec 里"测试要点" 7 条**

对照 `docs/superpowers/specs/2026-07-02-plan-cost-export-design.md` §测试要点：

1. **混合选择**（2 已算 + 1 未算）→ 总表金额与"未算成本"正确；总计 `= SUM(已算)` + "(不含未算 1 个)"
2. **全部未算** → 总计 "—"；每个成本透视页显示占位提示
3. **全部已算** → 总计 = 各方案 grandTotal 之和
4. **多柜子分页**（10+ 柜子）→ 成本透视分多页；柜子卡不被切开
5. **内链** → 总表方案名可跳到对应方案封面页；总计行无内链
6. **失败提示** → 断开 canvas 或伪造错误场景 → "生成失败" toast
7. **向后兼容** → "导出方案信息"按钮生成的 PDF 与改造前一致（4 列，无成本列）

- [ ] **Step 2: 推送到 GitHub**

```bash
git push
```

---

## Self-Review 结果

**1. Spec coverage** —

- §架构总览 → Task 1 + Task 7（入口 + 复用现有函数）
- §成本判定与数据准备（`_computeCostFor` 用 `plan.materials` 判定）→ Task 2
- §总表页改造（5 列 + 总计行 + 内链保留）→ Task 1
- §成本透视页渲染（页眉、卡片、明细表、收口条、总计、分页策略）→ Task 3-6
- §页面回调与 UI（按钮 + 4 回调 + wxss + 2 modal）→ Task 8
- §错误处理（`calc` 抛错降级、明细空数据、`showToast('生成失败')`）→ Task 2 + Task 5 + Task 8
- §影响到的现有代码 → 各 Task 精确到文件行

**2. Placeholder scan** —

- Task 3 骨架里 `_renderCostPlaceholderPage(ctx, plan, '（成本透视已算分支占位——Task 4 会填充）')` 是**中间态**占位，Task 4 Step 3 明确要求删除并替换。
- 每步都有完整代码，无 "TODO" / "Add error handling"。

**3. Type consistency** —

- `_renderOverviewTable(ctx, plans, options)` 签名与 `options.showCostColumn/costMap` 在 Task 1 定义，Task 7 调用时字段名一致
- `_computeCostFor(plan)` 返回 `null | costObject`，Task 3/4/5/6 均以此判定
- `_cabinetCardTotalHeight` / `_drawCabinetCard` / `_drawDetailTable` / `_panelDetailRows` / `_hardwareDetailRows` / `_drawSkCard` / `_drawGrandTotalCard` 函数命名前后一致
- `_renderCostBreakdown`（收集模式）与 `_renderAndFlushCostBreakdown`（flush 模式）都保留：前者只在 Task 3-6 编译验证阶段可能被调用，Task 7 里的 `exportPlansWithCost` 明确使用后者，避免误用。若最终代码不需要 `_renderCostBreakdown` 收集模式，可以在 Task 7 后单独删除——本计划保留以支持未来复用。
