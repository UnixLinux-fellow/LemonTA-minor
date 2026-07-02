# 导出方案成本 PDF 设计方案

日期：2026-07-02
状态：待实施

## 背景

当前方案列表页有两个导出按钮：`导出方案信息`（`utils/pdf-exporter.js`）和 `导出五金/尺寸`（云端拉取）。新需求：加第三个按钮 `导出方案成本`，PDF 结构在"方案信息"基础上增加成本相关内容：

- 首页方案表格新增"方案成本"列，末行加总计
- 每个方案后追加"成本透视"页（复刻 cost 页 UI，含展开明细）

## 目标

- 用户点 `导出方案成本` → 弹方案选择 → 弹文件命名 → 生成 PDF → 预览
- PDF 包含总表页（含成本列 + 总计）+ 每方案的分隔页 + 封面 + 布局 + 成本透视（1..N 页）
- 未算成本的方案仍可导出，在成本列显示"未算成本"，成本透视页显示占位提示，总计跳过

## 非目标

- 不新增 canvas 或 jsPDF 分身；扩展现有 `utils/pdf-exporter.js`
- 不改造 `costEngine.calc` 的返回结构
- 不为"未算成本"提供自动补算入口（用户需自行去 cost 页算）

## 架构总览

```
plan-list/index.js
   │  onTapExportCost()
   ▼
utils/pdf-exporter.js
   │  exportPlansWithCost({ canvas, plans, fileName })
   ▼
   ├── _renderOverviewTable(ctx, plans, { showCostColumn: true, costMap })
   ├── _renderSeparator / _renderOverview / _renderLayout (existing)
   └── _renderCostBreakdown(canvas, ctx, plan, cost)  ← 新增，可能占多页
```

`utils/pdf-exporter.js` 扩展现有导出器，新增一个入口 `exportPlansWithCost`，共享 A4 常量、canvas 工具、jsPDF 逻辑。文件从 601 行涨到约 900 行，按渲染函数切分。

`utils/cost-engine.js` 的 `calc({ cabinets, materials, wall })` 保持不变，直接调用。

## 成本判定与数据准备

**是否已算过成本**：以 `plan.materials` 是否被显式设置过为判定标志。`plan-store` 里的 plan 对象只有走过成本页才会有 `materials` 字段。

**每个 plan 的成本计算**：
```js
function _computeCostFor(plan) {
  if (!plan.materials) return null;
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

`null` 表示"未算成本"。总表和成本透视页据此选择占位内容还是真实内容。

## 总表页改造

现有 `_renderOverviewTable` 是 4 列：`方案名称 | 空间尺寸 | 普通衣柜个数 | 加高衣柜个数`。

改造为接受第 3 个参数 `options`：

```js
function _renderOverviewTable(ctx, plans, options) {
  const showCost = !!(options && options.showCostColumn);
  const costMap = (options && options.costMap) || new Map(); // planId → cost | null
  // ...
}
```

**showCost = false**（旧行为）：4 列不变，行为保持向后兼容。

**showCost = true**（新入口用）：
- 5 列：`方案名称 | 空间尺寸 | 普通衣柜个数 | 加高衣柜个数 | 方案成本`
- 列宽比例 `[0.26, 0.20, 0.18, 0.18, 0.18]`
- 成本列：`cost.grandTotal` 存在 → `¥12,345.67`（`toLocaleString` 或简易千分位）；`null` → "未算成本"（灰色 `#9ca3af`）
- **末行"总计"**：前四列合并显示"总计（共 N 个方案）"，成本列显示 SUM(已算方案的 grandTotal)
  - 若所有方案都未算 → 总计单元格显示 "—"
  - 若部分未算 → 成本单元格追加 "(不含未算 M 个)" 小字
  - 样式：深底色 `#1f2937` + 白字，粗体，与表头视觉呼应
- **内链**：方案名单元格仍保留（跳到方案封面页）。总计行不加内链。

## 成本透视页渲染

新增函数：

```js
async function _renderCostBreakdown(canvas, ctx, plan, cost)
// 返回渲染的页数（1..N）；调用方负责在每页之间调 _addCanvasPage
```

**未算成本（cost === null）**：整页只画方案名 + 副标题"成本透视" + 居中提示 "未算成本，请到成本页选择板材/五金后再导出"。占 1 页。

**已算成本**：从上往下堆叠以下"块"，每块视为不可切割单元。当剩余空间放不下下一块时新开一页。

块内容顺序（复刻 cost 页 UI）：

1. **页眉**（每页重复）：方案名标题（左上）+ "成本透视" 副标题
2. **成本&配件汇总卡片**（每个柜子一张）：
   - 卡头：`{label} {code}-{w}-{h}`（左）+ `¥{total}`（右）
   - 4 格网格：`板材合计 ¥{panelCost}` / `五金配件 ¥{hardwareCost}` / `运输费用 ¥{transport}` / `安装费用 ¥{install}`
   - **板材明细表**：5 列 `名称 | 尺寸 | 面积 | 单价 | 小计`，数据来自 `cost.modules[i].detail.panels`
   - **五金配件明细表**：5 列 `部件 | 规格 | 数量 | 单价 | 小计`，数据来自 `cost.modules[i].detail.hardware`
   - 空明细表 → 表头 + "无数据"占位行
3. **收口条卡片**（如有 `cost.sk`）：卡头 + 单行 "面积 {area}㎡ × 单价 ¥{unit}"
4. **总成本预估**：卡片形态，粗体大字 `¥ {grandTotal}`

**分页策略**："柜子卡（卡头 + 4 格 + 板材表 + 五金表）"视为一个整体，不切割。**特殊情况**：单张卡片超过一整页 → 允许切割明细表内的行（表头在每页重复）。

**估算**：一张柜子卡（4 格 + 两个空/短明细表）约占 A4 的 1/2；明细表每行约 30pt。10 个柜子的方案约 3-5 页。

## 页面回调与 UI

### wxml 改动 (`plan-list/index.wxml`)

在现有 `.export-btn-wrap` 之后追加：

```xml
<view class="export-btn-wrap-cost">
  <view class="export-btn" bindtap="onTapExportCost">导出方案成本</view>
</view>
```

复用两个 modal（新增新的实例）：

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

### wxss 改动 (`plan-list/index.wxss`)

```css
.export-btn-wrap-cost {
  padding: 0 32rpx 40rpx;
}
.export-btn-wrap-cost .export-btn {
  width: 100%;
}
```

### index.js 改动

- `data` 新增：`costExportSelectOpen: false`, `costExportNameOpen: false`, `_costSelectedIds: []`
- 新增回调：
  - `onTapExportCost` → 打开 `costExportSelectOpen`（若 `plans` 为空则直接返回）
  - `onCostExportSelectCancel` / `onCostExportSelectConfirm` → 保存选中 id，切到命名弹窗
  - `onCostExportNameCancel`
  - `onCostExportNameConfirm(e)` → 清理文件名，取选中的 plans → `showLoading` → `getPdfCanvas` → `pdfExporter.exportPlansWithCost({ canvas, plans, fileName })` → `openDocument`

行为与现有 `onExportNameConfirm` 一致（同样的 try/catch、hideLoading、openDocument fail 回退到 showModal）。

## 错误处理

| 场景 | 处理 |
|---|---|
| 单个 plan 的 `costEngine.calc` 抛错 | `_computeCostFor` 返回 null，该 plan 视为"未算成本"，整体导出继续 |
| `plan.materials` 缺失 | 视为"未算成本"（同上） |
| 明细数组 `detail.panels` / `detail.hardware` 为空/undefined | 表格显示"无数据"占位行 |
| `getPdfCanvas` / `exportPlansWithCost` 抛错 | `hideLoading` + `wx.showToast('生成失败', 3s)` + `console.error` |
| `openDocument` 失败 | `wx.showModal` 显示文件路径 + errMsg（与现有一致） |

**不做的事**：
- 不对未算方案自动调 `calc` 补算（用户明确要求"用标志判断"）
- 不做进度显示（与现有 UX 一致，简单 `showLoading` 即可）
- 不做重试

## 影响到的现有代码

### 修改

- `miniprogram/utils/pdf-exporter.js`
  - `_renderOverviewTable(ctx, plans)` → `_renderOverviewTable(ctx, plans, options)`，可选参数控制成本列
  - `module.exports` 新增 `exportPlansWithCost`
  - 新增 `_renderCostBreakdown`（可能约 200 行）
  - 新增 `_computeCostFor` helper
- `miniprogram/pages/plan-list/index.js`
  - `require` 顶部新增：`const costEngine = require('../../cabinet/utils/cost-engine.js');`
  - `data` 新增 3 项
  - 新增 4 个回调
- `miniprogram/pages/plan-list/index.wxml`
  - 新增 export-btn-wrap-cost 块
  - 新增 2 个 modal 实例
- `miniprogram/pages/plan-list/index.wxss`
  - 新增 `.export-btn-wrap-cost` 样式

### 保留不动

- `utils/cost-engine.js`（读取，不修改）
- 现有 `exportPlans`（保持 4 列 UI，因为它没传 `showCostColumn`）
- 其他导出流程（"导出方案信息"、"导出五金/尺寸"）

### 新增

- 无独立新文件；改动在现有文件内

## 测试要点

小程序无标准单元测试框架，手动验收清单：

1. **混合选择**：选 2 个已算 + 1 个未算 → 总表显示金额和"未算成本"，总计行显示 SUM(2 个已算) + "(不含未算 1 个)"
2. **全部未算**：选 2 个都未算 → 总计单元格显示"—"，两个方案的成本透视页均为占位提示
3. **全部已算**：选 3 个已算 → 总表末行总计 = 各方案 grandTotal 之和（数值一致）
4. **多柜子分页**：单个方案含 10+ 柜子 → 成本透视自然分多页，柜子卡片不被中间切开
5. **内链**：总表方案名可跳到对应方案封面页；总计行无内链
6. **失败提示**：`getPdfCanvas` 或 exporter 抛错 → 显示"生成失败" toast
7. **向后兼容**：`导出方案信息` 按钮生成的 PDF 与改造前一致（4 列，无成本列，无总计行）

## 未来可能的扩展（本次不做）

- 未算方案的自动补算入口（在选择弹窗里提示"含 M 个未算方案，是否用默认板材计算？"）
- PDF 里带二维码链接到线上成本页
- 成本透视页横向布局适配柜子多的方案
