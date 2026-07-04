# 导出方案成本 PDF 简化设计方案

日期：2026-07-04
状态：待实施

## 背景

`导出方案成本` 按钮生成的 PDF 中，每个方案的"成本透视"页会针对每个柜子渲染四部分内容：

1. 卡头（柜子名称 + `¥ 总价`）
2. 4 格网格（板材合计 / 运输费用 / 五金配件 / 安装费用）
3. 板材明细表（5 列：名称/尺寸/面积/单价/小计，每行一块板材）
4. 五金明细表（4 列：部件/数量/单价/小计，每行一个五金件）

需求：PDF 不再需要模块明细价格（3、4 两块），保留每个柜子的概览成本（1、2 两块）即可。

## 目标

- 每个柜子在 PDF 中只显示卡头 + 4 格网格
- 页面上方的方案名/"成本透视"副标题保持不变
- 收口条卡片（`cost.sk`）保持不变
- "总成本预估" 卡片保持不变
- 未算成本占位页保持不变

## 非目标

- 不改动 `导出方案信息` / `导出五金/尺寸` 两个按钮的输出
- 不改动首页方案总表（`_renderOverviewTable`，保留 `方案成本` 列和总计行）
- 不改动 cost 页在小程序内部的 UI（`miniprogram/cabinet/pages/cost/index.wxml` 仍显示"查看模块明细"入口）
- 不新增开关参数（YAGNI，当前没有第二处调用需要保留明细形态）
- 不删除仍被其他导出流程引用的辅助函数

## 改动范围

仅修改 `miniprogram/utils/pdf-exporter.js` 中的 `_renderAndFlushCostBreakdown`（约 line 680-775）。

### 具体改动

**删除**：
- 局部常量 `panelCols`（板材表列定义）
- 局部常量 `hardwareCols`（五金表列定义）
- 柜子循环内的"引导块"中调用 `_drawDetailTable(ctx, panelCols, panelRows, ...)` 的一段（板材表）
- 柜子循环内调用 `_drawPagedDetailTable(...)` 的一段（跨页五金表）
- `panelRows`、`panelTableH`、`leadBlockH` 等仅服务于表格的中间量

**保留 / 简化**：
- 每个柜子块只包含：卡头(`headH = 36 * SCALE`) + 4 格网格(`gridH = 60 * SCALE`) + `gap`
- 柜子块高度：`headH + gridH + cardGap`（可直接一次 `addBlock` 塞入）
- 因为块很小（≈ 116 * SCALE），必然能塞进一页 → 走常规 `addBlock` 分页即可，不再需要跨页表格逻辑
- `_drawCabinetCard` 本身已经绘制卡头 + 4 格网格，直接复用，不改
- 收口条卡片调用 `_drawSkCard` 保持不变
- 总成本卡片调用 `_drawGrandTotalCard` 保持不变
- 未算成本分支 `_renderCostPlaceholderPage` 保持不变

### 影响面

| 项 | 处理 |
|---|---|
| `_renderCostBreakdown`（早期版本，未在调用链中） | 保留不动，避免误伤 |
| `_panelDetailRows` / `_hardwareDetailRows` | 保留（其他辅助逻辑或早期版本仍引用） |
| `_drawDetailTable` / `_drawPagedDetailTable` | 保留（其他导出流程或早期版本仍可能引用） |
| `_drawCabinetCard` / `_drawSkCard` / `_drawGrandTotalCard` | 保留不变，无需改 |
| `_cabinetCardTotalHeight`（旧版 breakdown 使用） | 保留不变，不影响新版流程 |
| `exportPlansWithCost` / `_renderOverviewTable` / `_renderLayout` / `_renderSeparator` / `_renderOverview` | 不改 |

### 分页与页数影响

现在 10 柜子的方案约 3-5 页；改后每张柜子卡只占 ~116 * SCALE 高度，加上页眉 100 * SCALE + 边距，A4 一页能容纳 ~7-8 张柜子卡。10 柜子的方案预计压缩到 1-2 页。

## 测试要点

1. **已算成本，单柜子**：柜子卡只显示"卡头 + 4 格"，无任何表格；后续为收口条卡片 + 总成本卡片
2. **已算成本，多柜子（10+）**：柜子卡不被分页切开；总页数明显少于改造前
3. **未算成本**：占位页保持"未算成本，请到成本页选择板材/五金后再导出"提示，无回归
4. **混合选择**：3 个方案中 2 个已算 + 1 个未算，各方案独立渲染正确
5. **收口条 / 总成本**：仍在最后正确显示
6. **首页总表 / 目录 / 内链**：不受影响，行为与改造前一致
7. **其他两个导出按钮**（导出方案信息、导出五金/尺寸）：输出不变

## 风险

- 唯一风险点：`_renderAndFlushCostBreakdown` 内的分页逻辑此前需要处理"五金表跨页"这个复杂情况；简化后完全不再需要，代码路径应该更短更稳。若删除时误伤 `y` 光标推进逻辑，可能导致柜子卡片重叠。改动时需要保持 `y += cardGap` 等光标推进不变。
- 保留 `_drawPagedDetailTable` 等函数意味着代码里会有暂时不被调用的辅助函数。因这些函数被旧版 `_renderCostBreakdown` 或其他流程可能引用（其他表格类导出），本次不清理，避免引入无关变更。
