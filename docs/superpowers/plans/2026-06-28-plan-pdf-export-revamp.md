# 方案 PDF 导出改版 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 PDF 导出：首页改为四列表格总览、总览页右侧追加板材五金、线框图页改用 wireframeImage 并对未计算成本方案显示提示语占位。

**Architecture:** 单文件改造，仅修改 `miniprogram/utils/pdf-exporter.js`。抽出 `_countCabinets(plan)` 纯函数以便 Node 单测。新增 `_renderOverviewTable` 取代 `_renderToc`。修改 `_renderOverview` 添加 5 行板材五金。修改 `_renderLayout` 改用 wireframeImage。

**Tech Stack:** 微信小程序、Canvas 2D、jsPDF（vendored）、Node 18+（用于 `tests/run.js` 纯函数断言）

参考 spec：`docs/superpowers/specs/2026-06-28-plan-pdf-export-revamp-design.md`

---

## Task 1: 抽出 `_countCabinets(plan)` 纯函数 + 单元测试

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`（在 `_drawWireframeDiagram` 上方添加导出函数；在 `module.exports` 中暴露，便于测试 require）
- Modify: `tests/run.js`（在 `// ---- cost-engine ----` 节之前新增 `pdf-exporter` 节）

- [ ] **Step 1.1: 在 `tests/run.js` 顶部 require pdf-exporter（仅 _countCabinets）**

在 `tests/run.js` 第 8 行 `planStore` require 之后追加：

```javascript
const pdfExporter = require(path.resolve(__dirname, '../miniprogram/utils/pdf-exporter.js'));
```

注意：`pdf-exporter.js` 顶部 `require('../vendor/jspdf.min.js')` 在 Node 下可能加载失败。需要先在 Node 环境下确认 require 不抛错（jspdf.min.js 是 UMD，应该能在 Node 下加载）。若加载失败，则把 `_countCabinets` 拆到独立的 `miniprogram/utils/cabinet-counter.js` 文件并双方 require —— 见 Step 1.2。

- [ ] **Step 1.2: 决定文件位置（先尝试方案 A）**

方案 A（首选）：在 `pdf-exporter.js` 内部定义 `_countCabinets` 并通过 `module.exports = { exportPlans, _countCabinets }` 暴露。

方案 B（兜底）：若 Step 1.1 在 Node 下执行 `tests/run.js` 时 require pdf-exporter 报错，则新建 `miniprogram/utils/cabinet-counter.js`，导出 `countCabinets(plan)`；pdf-exporter.js require 并复用；tests/run.js 直接 require cabinet-counter.js。

执行：先按方案 A 写好（见 1.3、1.4），然后在 Step 1.5 跑 `node tests/run.js`；若失败错误信息提示 jspdf 加载问题，再切到方案 B。

- [ ] **Step 1.3: 在 `tests/run.js` 添加 `_countCabinets` 测试用例（先写，会失败）**

在 `tests/run.js` 的 `// ---- cost-engine ----` 节（约第 297 行）之前插入：

```javascript
// ---- pdf-exporter._countCabinets ----
group('pdf-exporter._countCabinets', () => {
  // 空 layout
  eq(pdfExporter._countCabinets({ layout: { items: [] } }), 0, '空 items 返回 0');
  eq(pdfExporter._countCabinets({}), 0, '无 layout 返回 0');
  eq(pdfExporter._countCabinets({ layout: null }), 0, 'layout=null 返回 0');

  // 仅下排标准柜
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'sk', w: 2 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'b', w: 100 },
      { kind: 'nonstandard', w: 30 },
      { kind: 'sk', w: 2 },
    ] },
  }), 4, '3 standard + 1 nonstandard = 4');

  // 含 corner，hasRaise=false
  eq(pdfExporter._countCabinets({
    wall: { w: 480, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'corner', code: 'z', w: 110 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'corner', code: 'y', w: 110 },
    ] },
  }), 3, 'corner+standard+corner = 3');

  // 加高排：wall.h > 250 && hasRaise=true → 下排柜体各 +1
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 270 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'b', w: 100 },
      { kind: 'nonstandard', w: 30 },
    ] },
  }), 6, '3 下排 + 3 加高排 = 6');

  // hasRaise=true 但 wall.h<=250 → 不加高
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'a', w: 50 },
    ] },
  }), 2, 'hasRaise=true 但 h<=250 → 不算加高');

  // sk 不计数
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    layout: { items: [
      { kind: 'sk', side: 'left', w: 2 },
      { kind: 'sk', side: 'right', w: 2 },
    ] },
  }), 0, '仅有 sk 返回 0');
});
```

- [ ] **Step 1.4: 在 `pdf-exporter.js` 添加 `_countCabinets` 函数并导出**

在 `_drawWireframeDiagram` 函数（约第 126 行）**上方**插入：

```javascript
function _countCabinets(plan) {
  if (!plan || !plan.layout) return 0;
  const items = Array.isArray(plan.layout.items) ? plan.layout.items : [];
  const wall = plan.wall || {};
  const wallH = wall.h || 0;
  let bottom = 0;
  items.forEach((it) => {
    if (it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard') {
      bottom += 1;
    }
  });
  const hasRaise = plan.hasRaise && wallH > 250;
  return hasRaise ? bottom * 2 : bottom;
}
```

并在文件末尾 `module.exports = { exportPlans };` 改为：

```javascript
module.exports = { exportPlans, _countCabinets };
```

- [ ] **Step 1.5: 运行测试，确认通过**

Run:
```
node tests/run.js
```

Expected 输出末尾：`<N> passed, 0 failed`，包含 `pdf-exporter._countCabinets` 节 6 条全部 ✓。

若 require pdf-exporter.js 报 jspdf 加载错误：切到方案 B：
1. 新建 `miniprogram/utils/cabinet-counter.js`，把 `_countCabinets` 拷过去，重命名为 `countCabinets`，`module.exports = { countCabinets }`
2. pdf-exporter.js 顶部 `const { countCabinets } = require('./cabinet-counter.js');`，删除内部 `_countCabinets`，把 `module.exports` 还原成 `{ exportPlans }`
3. tests/run.js 改 require：`const { countCabinets } = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-counter.js'));`，测试改用 `countCabinets(...)`

- [ ] **Step 1.6: 提交**

```bash
git add miniprogram/utils/pdf-exporter.js tests/run.js
git commit -m "feat(pdf): extract _countCabinets pure function with unit tests"
```

---

## Task 2: 新增 `_renderOverviewTable` 取代 `_renderToc`

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`

新表格 4 列：方案名称(28%) | 空间尺寸(22%) | 衣柜个数(15%) | 成本透视(35%)。返回值 `tocEntries` 结构（`{pageNumber, x, y, w, h}` in pt）不变，供 `doc.link()` 加内链使用。

- [ ] **Step 2.1: 替换 `_renderToc` 函数实现**

在 `pdf-exporter.js` 第 327 行 `function _renderToc(ctx, plans) {` 开始的整个函数（到约第 388 行 `return entries; }` 结束）替换为：

```javascript
function _renderOverviewTable(ctx, plans) {
  _resetCanvas(ctx);

  // 标题
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (28 * SCALE) + 'px sans-serif';
  ctx.fillText('方案总览', MARGIN, MARGIN);

  ctx.fillStyle = '#6b7280';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.fillText('点击方案名跳转到对应方案页', MARGIN, MARGIN + 40 * SCALE);

  // 表格区域
  const tableX = MARGIN;
  const tableY = MARGIN + 100 * SCALE;
  const tableW = CANVAS_W - MARGIN * 2;
  const headerH = 30 * SCALE;
  const rowH = 36 * SCALE;

  // 4 列宽度
  const colRatios = [0.28, 0.22, 0.15, 0.35];
  const colX = [];
  let cx = tableX;
  for (let i = 0; i < colRatios.length; i++) {
    colX.push(cx);
    cx += tableW * colRatios[i];
  }
  const colW = colRatios.map((r) => tableW * r);

  // 表头背景
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(tableX, tableY, tableW, headerH);

  // 表头文字
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (14 * SCALE) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  const headerCenterY = tableY + headerH / 2;
  const headerPadX = 12 * SCALE;
  const headers = ['方案名称', '空间尺寸', '衣柜个数', '成本透视'];
  headers.forEach((label, i) => {
    ctx.fillText(label, colX[i] + headerPadX, headerCenterY);
  });

  // 数据行
  const startY = tableY + headerH;
  const maxRows = Math.floor((CANVAS_H - startY - MARGIN) / rowH);
  const visible = plans.slice(0, maxRows);
  const entries = [];

  visible.forEach((plan, i) => {
    const ry = startY + i * rowH;
    // zebra
    if (i % 2 === 1) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(tableX, ry, tableW, rowH);
    }

    const cellCenterY = ry + rowH / 2;
    ctx.textBaseline = 'middle';
    ctx.font = (14 * SCALE) + 'px sans-serif';

    // 列 1：方案名（蓝色 + 下划线）
    const name = plan.name || '(未命名)';
    ctx.fillStyle = '#2563eb';
    const nameX = colX[0] + headerPadX;
    ctx.fillText(name, nameX, cellCenterY);
    const nameWidth = ctx.measureText(name).width;
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = Math.max(1, 1 * SCALE);
    ctx.beginPath();
    ctx.moveTo(nameX, cellCenterY + 10 * SCALE);
    ctx.lineTo(nameX + nameWidth, cellCenterY + 10 * SCALE);
    ctx.stroke();

    // 列 2：空间尺寸
    const wall = plan.wall || {};
    const sizeText = `${wall.w || '?'}×${wall.h || '?'}cm`;
    ctx.fillStyle = '#1f2937';
    ctx.fillText(sizeText, colX[1] + headerPadX, cellCenterY);

    // 列 3：衣柜个数
    const cabCount = _countCabinets(plan);
    ctx.fillText(String(cabCount), colX[2] + headerPadX, cellCenterY);

    // 列 4：成本透视
    let costText;
    if (plan.cost && plan.cost.grandTotal != null) {
      costText = '¥' + plan.cost.grandTotal;
    } else {
      costText = '未计算';
      ctx.fillStyle = '#9ca3af';
    }
    ctx.fillText(costText, colX[3] + headerPadX, cellCenterY);

    // 内链 hit-box（整行）—— 转 PDF 坐标 (pt) = canvas 坐标 / SCALE
    entries.push({
      pageNumber: plan._tocPage,
      x: tableX / SCALE,
      y: ry / SCALE,
      w: tableW / SCALE,
      h: rowH / SCALE,
    });
  });

  // 还原 baseline
  ctx.textBaseline = 'top';

  // 截断提示
  if (plans.length > visible.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = (12 * SCALE) + 'px sans-serif';
    ctx.fillText(
      `… 还有 ${plans.length - visible.length} 个方案未在表格中列出`,
      MARGIN,
      startY + visible.length * rowH + 10 * SCALE
    );
  }

  return entries;
}
```

- [ ] **Step 2.2: 修改 `exportPlans` 的调用点**

在 `pdf-exporter.js` 找到（约第 458 行）：

```javascript
  // 先渲染目录页（占第 1 页）
  const tocEntries = _renderToc(ctx, plans);
```

替换为：

```javascript
  // 先渲染总览表格页（占第 1 页）
  const tocEntries = _renderOverviewTable(ctx, plans);
```

- [ ] **Step 2.3: 真机/开发者工具验证**

人工跑一次（开发者工具中预览）：选择 2~3 个方案导出，打开 PDF 第 1 页：
- 标题「方案总览」+ 副文「点击方案名跳转到对应方案页」
- 表头深灰底白字，4 列对齐
- 数据行 zebra（白/灰交替）
- 名称蓝色下划线、点击能跳转到对应方案页
- 成本列：已计算的方案显示「¥<金额>」、未计算的灰色「未计算」
- 空间尺寸列显示「<W>×<H>cm」
- 衣柜个数为整数

- [ ] **Step 2.4: 提交**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf): replace toc page with overview table (4-column)"
```

---

## Task 3: 总览页右侧追加 5 行板材五金

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`（函数 `_renderOverview`，约第 54-84 行）

- [ ] **Step 3.1: 修改 `_renderOverview` 函数**

在 `pdf-exporter.js` 找到（约第 75-78 行）：

```javascript
  ctx.fillText(`墙体尺寸: 宽度${wall.w || '?'}x高度${wall.h || '?'}cm`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`转角类型: ${cornerLabel || '无转角'}`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`是否加高: ${plan.hasRaise ? '加高' : '无'}`, infoX, infoY);
```

替换为：

```javascript
  ctx.fillText(`墙体尺寸: 宽度${wall.w || '?'}x高度${wall.h || '?'}cm`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`转角类型: ${cornerLabel || '无转角'}`, infoX, infoY); infoY += 30 * SCALE;
  ctx.fillText(`是否加高: ${plan.hasRaise ? '加高' : '无'}`, infoX, infoY); infoY += 30 * SCALE;

  // 板材五金（与上方空间信息文字续列对齐）
  infoY += 16 * SCALE; // 段间间距
  const m = plan.materials || {};
  const matRows = [
    ['板材', m.panel],
    ['柜门面板', m.doorPanel],
    ['柜门工艺', m.doorCraft],
    ['五金', m.hardware],
    ['灯带', m.lighting],
  ];
  matRows.forEach(([k, v]) => {
    ctx.fillText(`${k}: ${v || ''}`, infoX, infoY);
    infoY += 30 * SCALE;
  });
```

- [ ] **Step 3.2: 真机/开发者工具验证**

打开 PDF 任一方案的总览页（即旧的 `_renderOverview` 那一页）：
- 照片右侧上方 3 行：墙体尺寸 / 转角类型 / 是否加高（保持原样）
- 之后留一行间距
- 接下来 5 行：板材 / 柜门面板 / 柜门工艺 / 五金 / 灯带（值来自 plan.materials）
- 字号、起始 X 与上方 3 行一致

- [ ] **Step 3.3: 提交**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf): append 5 material/hardware rows to overview right column"
```

---

## Task 4: 线框图页改用 wireframeImage、删除板材五金块

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js`（函数 `_renderLayout`，约第 86-115 行）

- [ ] **Step 4.1: 修改 `_renderLayout` 函数**

在 `pdf-exporter.js` 找到完整的 `_renderLayout` 函数（约第 86-115 行）：

```javascript
async function _renderLayout(canvas, ctx, plan) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  ctx.fillText('布局线框图与板材五金', MARGIN, MARGIN);

  const wfY = MARGIN + 50 * SCALE;
  const wfW = CANVAS_W - MARGIN * 2;
  const wfH = 520 * SCALE;
  _drawWireframeDiagram(ctx, plan, MARGIN, wfY, wfW, wfH);

  let y = wfY + wfH + 40 * SCALE;
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (18 * SCALE) + 'px sans-serif';
  ctx.fillText('板材五金', MARGIN, y);
  y += 32 * SCALE;
  ctx.font = (14 * SCALE) + 'px sans-serif';
  const m = plan.materials || {};
  const rows = [
    ['板材', m.panel],
    ['柜门面板', m.doorPanel],
    ['柜门工艺', m.doorCraft],
    ['五金', m.hardware],
    ['灯带', m.lighting],
  ];
  rows.forEach(([k, v]) => {
    ctx.fillText(`${k}: ${v || ''}`, MARGIN, y);
    y += 26 * SCALE;
  });
}
```

整段替换为：

```javascript
async function _renderLayout(canvas, ctx, plan) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  ctx.fillText('布局线框图', MARGIN, MARGIN);

  const wfY = MARGIN + 50 * SCALE;
  const wfW = CANVAS_W - MARGIN * 2;
  const wfH = CANVAS_H - wfY - MARGIN;

  const hint = '未计算成本，无线框图。请到"我的方案"选择该方案，选板材五金后点"计算成本"，在成本透视页即可看到线框图。';
  await _drawImageContain(canvas, ctx, plan.wireframeImage, MARGIN, wfY, wfW, wfH, hint);
}
```

- [ ] **Step 4.2: 验证 `_drawImageContain` 提示语显示正常**

检查 `_drawImageContain`（第 34 行）的 fallback 行为：当 `src` 为空或 `onerror` 时，调用 `_drawPlaceholder`，文字水平/垂直居中、单行。

提示语较长，可能会超出占位框宽度。检查 `_drawPlaceholder`（第 21 行）：当前用 `ctx.fillText` 单行绘制，不会换行。

需要在 `_drawPlaceholder` 中增加自动换行处理。修改方式：找到第 21-32 行 `_drawPlaceholder` 函数：

```javascript
function _drawPlaceholder(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1f2937';
}
```

替换为：

```javascript
function _drawPlaceholder(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.font = (14 * SCALE) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 自动换行：按字符宽度切片，留 40pt × SCALE 左右内边距
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

`_wrapText` 是辅助纯函数；放置位置：紧挨着 `_drawPlaceholder` 上方或下方均可。

- [ ] **Step 4.3: 真机/开发者工具验证**

场景 1（有 wireframeImage）：用已点过「计算成本」的方案导出 → 线框图页只有标题「布局线框图」+ 一张大图，无板材五金块。

场景 2（无 wireframeImage）：用刚建好、还没点过「计算成本」的方案导出 → 线框图页显示灰色占位框，框中央显示提示语「未计算成本，无线框图。请到"我的方案"选择该方案，选板材五金后点"计算成本"，在成本透视页即可看到线框图。」，文字自动换行，多行垂直居中。

- [ ] **Step 4.4: 提交**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf): replace canvas wireframe with wireframeImage + hint fallback"
```

---

## Task 5: 综合人工回归验证

**Files:** 无修改

- [ ] **Step 5.1: 场景 A — 3 个方案全部已计算成本**

操作：在「我的方案」页准备 3 个方案，每个都点过「计算成本」（确保 plan.wireframeImage 和 plan.cost.grandTotal 都有值），点导出，勾选全部 3 个，输入文件名，导出。

预期：
- P.1 总览表：3 行数据，名称蓝色可点、点击跳转到对应方案的总览页
- 每个方案：separator → 总览页（照片+8 行信息+大演示图）→ 线框图页（贴图）→ 成本明细
- 总览页右侧 8 行齐整：墙体尺寸 / 转角 / 加高 / [空行] / 板材 / 柜门面板 / 柜门工艺 / 五金 / 灯带

- [ ] **Step 5.2: 场景 B — 1 个方案未计算成本**

操作：建一个新方案，做完空间设置→设计→选板材，但**不点「计算成本」**直接返回「我的方案」。导出该方案。

预期：
- P.1 总览表：1 行，成本列显示「未计算」（灰色）
- 总览页右侧 8 行（板材五金 5 行显示已选的值，未选的为空）
- 线框图页：标题「布局线框图」，灰色占位框中央显示多行提示语

- [ ] **Step 5.3: 场景 C — 混合**

操作：勾选 2 个已计算 + 1 个未计算，导出。

预期：表格 3 行混排（前 2 行有金额、第 3 行「未计算」），线框图页两种分支都正确呈现。

- [ ] **Step 5.4: 单测回归**

Run:
```
node tests/run.js
```

Expected：`<N> passed, 0 failed`，新增的 `pdf-exporter._countCabinets` 节 6 条全部 ✓。

Run:
```
npx jest
```

Expected：`filename-cleaner` 套件全部通过（与本次改动无关，验证未误伤）。

- [ ] **Step 5.5: 最终提交（如有清理）**

无新增改动时跳过；如发现 lint 或格式问题在此一并修复后提交：

```bash
git status
# 若 clean，结束。若有改动：
git add -A
git commit -m "chore(pdf): minor cleanup after manual regression"
```

---

## 自审记录

**Spec 覆盖检查：**
- spec 3.1 `_countCabinets` → Task 1 ✓
- spec 3.2 `_renderOverviewTable` → Task 2 ✓
- spec 3.3 总览页右侧 5 行板材五金 → Task 3 ✓
- spec 3.4 线框图改贴 wireframeImage + 删板材五金 + 提示语 → Task 4 ✓
- spec 3.5 `exportPlans` 调用点改 `_renderOverviewTable` → Task 2.2 ✓
- spec 4 错误处理：wireframeImage 缺失走占位、grandTotal=0 显示 ¥0 → Task 2 实现中 `!= null` 判定与 Task 4 占位逻辑覆盖 ✓
- spec 5 测试：`_countCabinets` Node 单测 → Task 1.3、人工三场景 → Task 5 ✓

**类型一致：**
- `tocEntries` 结构在新旧两版均为 `{pageNumber, x, y, w, h}` ✓
- `_countCabinets` 在 Step 1.3 测试和 Step 1.4 实现的签名一致 ✓
- 方案 B 兜底命名 `countCabinets`（去前划线、因跨文件）需要同步改测试 → 已在 1.5 备注 ✓

**Placeholder 扫描：** 无 TBD/TODO，每步都有具体代码或具体校验项。
