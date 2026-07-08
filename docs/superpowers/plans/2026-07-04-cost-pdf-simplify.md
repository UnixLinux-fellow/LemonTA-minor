# 导出方案成本 PDF 简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从"导出方案成本"PDF 的成本透视页中移除每个柜子的板材/五金明细表，仅保留卡头 + 4 格网格概览。

**Architecture:** 仅改 `miniprogram/utils/pdf-exporter.js` 中的 `_renderAndFlushCostBreakdown`。删除柜子循环内两处明细表的绘制调用（板材表 + 跨页五金表）及其局部常量；柜子块简化为"卡头 + 4 格网格"一个整体块，走常规 `addBlock` 分页即可。收口条、总成本、未算占位页、总表、目录、内链等一律不动。

**Tech Stack:** 微信小程序 + jsPDF + Canvas 2D + 现有 `_drawCabinetCard` / `_drawSkCard` / `_drawGrandTotalCard` 工具函数

**测试方式:** 该项目没有单元测试框架，本次改动无法用自动化测试覆盖。采用**人工验证**：由用户在微信开发者工具里点击"导出方案成本"按钮，检查生成的 PDF 输出是否符合预期。

---

## File Structure

只改 1 个文件：

- `miniprogram/utils/pdf-exporter.js` — 修改 `_renderAndFlushCostBreakdown` 函数（当前位于 line 680-775）

---

## Task 1: 移除板材/五金明细表调用，简化柜子块渲染

**Files:**
- Modify: `miniprogram/utils/pdf-exporter.js:680-775`

- [ ] **Step 1: 打开文件并定位 `_renderAndFlushCostBreakdown` 函数**

Run: `grep -n "async function _renderAndFlushCostBreakdown" miniprogram/utils/pdf-exporter.js`
Expected: 输出 `680:async function _renderAndFlushCostBreakdown(canvas, ctx, plan, cost, flushPage) {`

- [ ] **Step 2: 用 Edit 工具替换整段函数体**

原函数从 line 680 起，结束于第一个 `await endPage();` 后的 `}`（约 line 775）。

**替换前**（需要匹配的旧内容）：

```js
  const panelCols = [
    { title: '名称', ratio: 0.24 },
    { title: '尺寸', ratio: 0.24 },
    { title: '面积', ratio: 0.20 },
    { title: '单价', ratio: 0.16 },
    { title: '小计', ratio: 0.16 },
  ];
  const hardwareCols = [
    { title: '部件', ratio: 0.44 },
    { title: '数量', ratio: 0.16 },
    { title: '单价', ratio: 0.20 },
    { title: '小计', ratio: 0.20 },
  ];

  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const gap = 8 * SCALE;
    // 引导块：卡头 + 4 格 + 板材表（通常一页内可放下）
    const headH = 36 * SCALE;
    const gridH = 60 * SCALE;
    const panelRows = _panelDetailRows(m);
    const panelTableH = 26 * SCALE + Math.max(1, panelRows.length) * 22 * SCALE;
    const leadBlockH = headH + gridH + gap + panelTableH + gap;
    await addBlock(leadBlockH, (yy) => {
      let cy = yy;
      const cardH = _drawCabinetCard(ctx, m, contentX, cy, contentW);
      cy += cardH + gap;
      _drawDetailTable(ctx, panelCols, panelRows, contentX, cy, contentW);
    });
    // 五金表：可能很长，按剩余空间跨页写
    await _drawPagedDetailTable(
      ctx, hardwareCols, _hardwareDetailRows(m),
      contentX, contentW, addBlock, endPage, beginPage,
      () => y, () => pageBottom
    );
    y += cardGap;
  }
```

**替换后**（新内容）：

```js
  const modules = (cost.modules || []);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const headH = 36 * SCALE;
    const gridH = 60 * SCALE;
    const blockH = headH + gridH + cardGap;
    await addBlock(blockH, (yy) => {
      _drawCabinetCard(ctx, m, contentX, yy, contentW);
    });
  }
```

关键说明：
- 删除 `panelCols`、`hardwareCols` 两个局部常量
- 柜子循环内不再调 `_drawDetailTable`（板材表）
- 柜子循环内不再调 `_drawPagedDetailTable`（跨页五金表）
- 柜子块高度从"卡头 + 4格 + gap + 板材表 + gap"简化为"卡头 + 4格 + cardGap"
- `y += cardGap` 挪进 `blockH`（一次性算上间距）
- 保留 `_drawCabinetCard`：它已经画好卡头 + 4 格网格
- 保留其后收口条、总成本、`endPage()` 的原有调用（不在本次替换范围内，函数尾部原封不动）

- [ ] **Step 3: 复查——确认改动后函数体结构**

Run: `grep -n "^async function _renderAndFlushCostBreakdown\|^function _renderCostPlaceholderPage" miniprogram/utils/pdf-exporter.js`
Expected: `_renderAndFlushCostBreakdown` 与 `_renderCostPlaceholderPage` 之间的行数明显减少（约 60-70 行 → 约 40-45 行）。

Run: `grep -c "panelCols\|hardwareCols\|_drawPagedDetailTable\|_drawDetailTable" miniprogram/utils/pdf-exporter.js`
Expected: 数量比改动前减少（`_drawPagedDetailTable` 若不再有其他调用，其定义处仍在，只是零调用；`panelCols` / `hardwareCols` 在其他函数如 `_renderCostBreakdown` 中仍存在）。

- [ ] **Step 4: 语法检查——用 Node 语法解析确认文件仍可加载**

Run: `node --check miniprogram/utils/pdf-exporter.js`
Expected: 无输出（node --check 通过时静默返回 0）；若有语法错误则报错并列出行号。

- [ ] **Step 5: 人工验证 PDF 输出（用户操作）**

告诉用户如何验收：

1. 打开微信开发者工具，加载项目
2. 进入"我的方案列表"页面
3. 点击"导出方案成本"按钮
4. 选择 1 个已算成本的方案 + 1 个未算成本的方案 → 命名 → 生成 PDF
5. 打开生成的 PDF，验证：
   - 已算方案的成本透视页：每个柜子只显示"卡头（名称 + ¥总价）+ 4 格网格（板材合计/运输费用/五金配件/安装费用）"，**无任何表格**
   - 收口条卡片（若有 `cost.sk`）仍显示
   - 总成本预估卡片仍显示
   - 未算方案的占位页仍显示"未算成本，请到成本页选择板材/五金后再导出"
   - 页数明显少于改造前（10 柜子从 3-5 页 → 1-2 页）
6. 再点击"导出方案信息"（不含成本），验证输出未受影响

- [ ] **Step 6: 提交**

```bash
git add miniprogram/utils/pdf-exporter.js
git commit -m "feat(pdf): 成本方案 PDF 移除每柜子板材/五金明细表"
```

---

## Self-Review Notes

- **Spec coverage**：spec 的所有目标（保留卡头+4格、保留收口条、保留总成本、保留未算占位、不影响其他导出、不新增开关）都在 Task 1 中覆盖。
- **Placeholder scan**：无 TBD/TODO；所有代码块都是完整可直接替换的内容。
- **Type consistency**：`headH` / `gridH` / `cardGap` / `blockH` 在替换后新代码内自洽；`addBlock`、`_drawCabinetCard`、`contentX`、`contentW` 均引用函数已有的上层变量，未新增未定义符号。
- **文件路径**：`miniprogram/utils/pdf-exporter.js` 路径已在 spec 与 codebase 中验证一致。
