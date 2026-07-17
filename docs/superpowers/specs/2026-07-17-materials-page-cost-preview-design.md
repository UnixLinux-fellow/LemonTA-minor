# 板材五金选择页 · 费用预览改造 · 设计

- 日期: 2026-07-17
- 需求文档: `docs/superpowers/板材五金选择页面改造需求.txt`
- 目标页面: `miniprogram/cabinet/pages/materials/index.*`
- 依赖模块: `miniprogram/utils/cost-engine.js`, `bootstrap.js`, `materials-options.js`

## 1. 目标

在板材五金选择页（`cabinet/pages/materials/`）加入**实时费用预览**能力，让用户在选择配置时即时看到总成本与分项费用，并在每组分类右上角展示该分类的费用与占总价比例。

选择完成后跳到 `cabinet/pages/cost/` 页看详情（现有流程不变）。

## 2. 需求要点（原文映射）

| # | 需求原文摘要 | 落地位置 |
|---|---|---|
| 1 | 总成本 = 板材合计 + 五金配件 + 运输费用 + 安装费用，默认最低配置 | `cost-engine.calc()` 返回值（`grandTotal / panelTotal / hardwareTotal / transport / install`，均已存在） |
| 2 | 费用预览位于墙体尺寸与柜子数量下方；总成本占一行，其余 2 项两两一行 | `.cost-preview` 布局 |
| 3 | 页面下滑时，费用预览始终显示在页面上方 | `position: sticky; top: 0` |
| 4 | 切换配置时，费用预览实时更新 | `_pick()` 触发 `_computeCost()` → `setData({ cost })` |
| 5 | 每组分类右上方实时显示"费用 + 占总价比例"，例：`国产灯带 费用 ¥453.25  占总价比例 5.3%` | `.cat-cost` 挂在每组 `.section > .title` 行 |

## 3. 架构与数据流

```
materials/index.js
  ├─ onLoad(query)
  │    ├─ 复用现有：读 plan / bottomRow / topRow / materials
  │    ├─ ensureCostDataReady() → _computeCost()
  │    └─ 若字典未就绪：cost=null, dataReady=false, dataNotice="价格数据未就绪，请重试"
  │
  ├─ _pick(key, id)            // 每次点选
  │    └─ setData({ materials }) → _computeCost()
  │
  ├─ _computeCost()
  │    ├─ 若 !bootstrap.isAllReady(): cost=null, dataReady=false
  │    └─ 否则：cost = costEngine.calc({cabinets, materials, wall})
  │                setData({ cost, dataReady: true, dataNotice: '' })
  │
  ├─ onRetryDataFetch()        // 复用 cost 页的重试样式与语义
  │    └─ ensureCostDataReady({ force: true }) → _computeCost()
  │
  └─ onCalc()                  // 不动，跳转到 cost 页
```

### 3.1 `cost-engine.calc()` 改动

在返回值追加一个新字段（不改现有字段、不 break 现有 UI）：

```js
{
  modules, sk, transport, install,
  panelTotal, hardwareTotal, grandTotal,   // 现有
  categoryCost: {                          // 新增
    panel:     Number,   // 板材品牌   = Σ (bodyArea + doorArea) × panelUnit
    doorPanel: Number,   // 门板材质   = Σ doorArea × doorMatUnit
    doorCraft: Number,   // 门板工艺   = Σ doorArea × doorCraftUnit
    hardware:  Number,   // 五金品牌   = Σ 非 LED 五金小计
    lighting:  Number,   // 照明系统   = Σ LED 三项小计（none → 0）
  },
}
```

**分类归属定义（口径）：**

- `panel` = 所有 `modules[*].totalBodyArea + modules[*].totalDoorArea` 之和 × 板材单价。含柜身板和门板基材两部分（因为门板的复合单价里 `panelUnit` 出现一次）。
- `doorPanel` = 所有 `totalDoorArea` × 门材单价（门板材质加价项）。
- `doorCraft` = 所有 `totalDoorArea` × 门艺单价（门板工艺加价项）。
- `hardware` = `Σ modules[*].detail.hardware` 中所有 `LED_KEYS` 以外行的 `total` 之和。
- `lighting` = `Σ modules[*].detail.hardware` 中所有属于 `LED_KEYS`（`led_light_strip / led_light_power / led_light_switch`）的 `total` 之和；lighting=none 时这三项 qty=0，自然为 0。

**恒等性质（用于测试断言）：**

```
categoryCost.panel + categoryCost.doorPanel + categoryCost.doorCraft
  ≈ Σ modules[*].panelCost                       // "板材合计"
categoryCost.hardware + categoryCost.lighting
  ≈ Σ modules[*].hardwareCost                    // "五金配件"
```

`≈` 是因为逐块 `round2` 求和与总面积 × 单价求和之间存在四舍五入尾差，属于既有代码的设计如此，测试用 `Math.abs(diff) < 1` 断言。

**收口条（sk）不计入任一 category**：sk 是"额外一条"，与 5 组材料选项不完全对应（依赖 wall 尺寸，不依赖用户选项之外的字段）。避免用户看到"我改了板材品牌但 categoryCost.panel 里还混着 sk 的钱"的困惑。

## 4. UI 变化

### 4.1 新增 · 顶部费用预览（吸顶）

位置：`.space-info` 之后、第一个 `.section` 之前。

```
┌─────────────────────────────────────┐
│  总成本            ¥ 12,345.67       │  ← 一行
├──────────────────┬──────────────────┤
│ 板材合计  ¥ 8,000 │ 运输费用  ¥ 500   │  ← 一行 2 列
├──────────────────┼──────────────────┤
│ 五金配件  ¥ 2,800 │ 安装费用  ¥ 1,045 │  ← 一行 2 列
└──────────────────┴──────────────────┘
```

- CSS：`position: sticky; top: 0; z-index: 10`
- 数据绑定：`cost.grandTotal / cost.panelTotal / cost.transport / cost.hardwareTotal / cost.install`
- 未就绪：所有金额显示 `——`，下方一行小字 `价格数据未就绪` + `重试` 链接（点击触发 `onRetryDataFetch`）

### 4.2 修改 · 每组分类头右上角费用条

对每个 `.section`（5 组），把原来的 `.title / .sub` 结构改成：

```
┌───────────────────────────────────────────────────────────┐
│ 衣柜板材品牌                       费用 ¥ 234.56  占 3.2%    │  ← .title-row (flex)
│ 板材品牌决定柜体环保等级与寿命                                  │
│ [E2 国产板]  [兔宝宝]  [国产克诺斯帮]  …                       │
└───────────────────────────────────────────────────────────┘
```

- 5 组的分类 key 与 `categoryCost` 映射：
  - 衣柜板材品牌 → `panel`
  - 门板材质 → `doorPanel`
  - 门板工艺 → `doorCraft`
  - 五金品牌 → `hardware`
  - 照明系统 → `lighting`
- 显示格式：`费用 ¥ {金额,保留 2 位}  占 {占比,保留 1 位}%`
- `grandTotal = 0` 时占比取 `0.0%`（避免除零）
- 未就绪（`dataReady=false`）时右上角费用条整体不渲染

## 5. 组件与文件改动清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `miniprogram/utils/cost-engine.js` | 追加字段 | `calc()` 返回值新增 `categoryCost` |
| `miniprogram/cabinet/pages/materials/index.js` | 修改 | 新增 `data.cost / dataReady / dataNotice`；新增 `_computeCost / onRetryDataFetch`；`_pick` 后调 `_computeCost`；`onLoad` 中 `ensureCostDataReady` 后触发一次 |
| `miniprogram/cabinet/pages/materials/index.wxml` | 修改 | 新增 `.cost-preview` 块与未就绪提示；每组 `.section` 顶部 `.title` 改为 `.title-row`（flex），右侧塞 `.cat-cost` |
| `miniprogram/cabinet/pages/materials/index.wxss` | 修改 | 新增 `.cost-preview / .cp-grand / .cp-item / .cat-cost` 等样式；`.title` 改为 `.title-row` flex 布局 |
| `tests/cost-engine.category-cost.test.js` | 新增 | 验证 `categoryCost` 5 项定义与恒等性质 |

## 6. 错误与边界处理

### 6.1 首屏字典未就绪
- `_computeCost` 内先 `await bootstrap.ensureCostDataReady()`，再 `bootstrap.isAllReady()` 判断
- 未就绪：`setData({ cost: null, dataReady: false, dataNotice: '价格数据未就绪，请重试' })`
- 预览区所有金额显示 `——`；分类右上角费用条隐藏
- 用户仍可点选（只是费用不刷新），但底部"计算成本"按钮点了跳转到 cost 页，由 cost 页面负责再次提示

### 6.2 就绪后切换选项
- 每次 `_pick` 同步调 `_computeCost`（`calc` 是纯同步计算，毫秒级），无需 debounce
- `calc` 抛错（理论不应，防御性）：try/catch → 设 `cost=null / dataNotice='计算失败'`

### 6.3 `grandTotal === 0`
- 占比公式：`percent = grandTotal > 0 ? (categoryCost[k] / grandTotal * 100) : 0`
- 输出：`0.0%`（不 NaN、不 Infinity）

### 6.4 `lighting = none`
- `categoryCost.lighting = 0`，右上角显示 `费用 ¥ 0.00  占 0.0%`

## 7. 测试策略

### 7.1 单元测试 `tests/cost-engine.category-cost.test.js`

需要以下 fixture（复用现有测试基础设施：`price-dict / panel-dict / model-meta-cache` 的 mock）：

- **case A：默认最低配置**（`DEFAULT_MATERIALS`）
  - `categoryCost.doorPanel === 0`（door_material_same_as_cabinet 单价 = 0）
  - `categoryCost.doorCraft === 0`（door_craft_none 单价 = 0）
  - `categoryCost.lighting === 0`（lighting=none）
  - `categoryCost.hardware > 0`
  - `categoryCost.panel > 0`
- **case B：全高配**（爱格 + 钢琴烤漆 + 欧式 + import + led_import）
  - 所有 5 项 > 0
  - `categoryCost.lighting > 0`
- **case C：恒等性质**
  - `|categoryCost.panel + categoryCost.doorPanel + categoryCost.doorCraft - Σ modules[*].panelCost| < 1`
  - `|categoryCost.hardware + categoryCost.lighting - Σ modules[*].hardwareCost| < 1`
- **case D：hardware 品牌切换**
  - `import > domestic`（同一 fixture 换 hardware）

### 7.2 手动验收清单

- [ ] 进入板材五金选择页看到费用预览，默认最低配置下总成本 = 板材+运输+五金+安装
- [ ] 切换任一组选项：总成本 + 板材合计/五金配件/运输/安装 + 该分类右上角费用条 都实时刷新
- [ ] 页面下滑，费用预览吸顶（"空间衣柜布置预览"和空间信息卡随滑动隐藏）
- [ ] 选照明系统 = 无 → 照明右上角显示 `¥ 0.00 / 0.0%`
- [ ] 门板材质选"与柜体相同" → 门板材质右上角显示 `¥ 0.00 / 0.0%`
- [ ] 强制清空 price-dict 本地缓存后进入页面：所有金额显示 `——`、提示"价格数据未就绪"、有重试链接；点重试成功后恢复
- [ ] 点"计算成本"跳转到 cost 页看到相同的 grandTotal（口径一致性回归）

## 8. 非目标（Non-goals）

- 不改变 cost 页面的展示
- 不改动 PDF 导出对 `plan.materials` 的消费方式
- 不引入新的字典或价格 code
- 不为 `sk`（收口条）分类归属到任何 category（见 §3.1 说明）
- 不做 debounce/节流（`calc` 是纯同步毫秒级）

## 9. 兼容性风险

- `cost-engine.calc()` 只**追加**字段，不改现有字段，`cost` 页 / `pdf-exporter` / `plan-list` 全部零影响
- 若未来有下游读 `categoryCost` 的代码，需保证 5 个 key 都存在（即使为 0）—— engine 内先初始化再累加即可
