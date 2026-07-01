# 方案 PDF 导出改版设计

日期：2026-06-28
影响文件：`miniprogram/utils/pdf-exporter.js`（唯一）

## 1. 背景与目标

「我的方案」页（`pages/plan-list`）支持勾选多个方案导出 PDF。当前 PDF 第 1 页是「方案目录」（方案名 + 页码 + 内链），每个方案再展开 3 类页（总览、线框图、成本明细）。本次改版要解决三件事：

1. 首页改为信息表格，便于用户一眼对比多个方案
2. 总览页右侧加上板材五金，与已有空间信息文字续接对齐
3. 线框图页不再用 canvas 临时手画，直接使用 `plan.wireframeImage`（即成本透视页用的那张图）；未计算成本的方案没有 wireframeImage，给提示语指引用户去计算

需求范围严格限定在 PDF 输出端，不修改「我的方案」页面 UI、不改方案数据结构、不改线框图生成时机。

## 2. 改版前后 PDF 结构对比

改版前：

```
P.1  方案目录（方案名 + 页码 + 内链）
P.2  方案 1 总览（照片 + 空间信息 + 大演示图 previewImage）
P.3  方案 1 线框图与板材五金（canvas 手画线框图 + 5 行板材五金）
P.4+ 方案 1 成本明细 1 或多页
P.k  separator（方案 2 / N）
P.k+1 方案 2 总览
...
```

改版后：

```
P.1  方案总览表（4 列：名称 | 空间尺寸 | 衣柜个数 | 成本透视；名称可点击内链）
P.2  方案 1 总览（照片 + 空间信息 + 板材五金 + 大演示图 previewImage）
P.3  方案 1 布局线框图（贴 wireframeImage，或占位框 + 提示语；不再含板材五金）
P.4+ 方案 1 成本明细 1 或多页
P.k  separator（方案 2 / N）
P.k+1 方案 2 总览
...
```

每个方案占用的页数与改版前相同（总览 + 线框图 + 成本页若干），因此 `_tocPage` 的预计算逻辑保持原样。

## 3. 详细改动（pdf-exporter.js）

### 3.1 抽出共用纯函数：`_countCabinets(plan)`

输入 plan 对象，返回衣柜个数（数字）。

规则：
- 遍历 `plan.layout.items`
- 下排：`kind ∈ {standard, corner, nonstandard}` 计 1
- 加高排：当 `plan.hasRaise && plan.wall.h > 250` 时，对每个下排柜体（即上述三种 kind）再各计 1

该函数纯计算、不依赖 canvas 或 wx，方便后续在 Node 下独立 sanity check。

### 3.2 新增 `_renderOverviewTable(ctx, plans)` 取代 `_renderToc(ctx, plans)`

返回值结构保持不变：返回 `tocEntries` 数组，每个元素 `{ pageNumber, x, y, w, h }`（pt 坐标），供 `exportPlans` 调用 `doc.link()` 添加内链。

布局（画布 1191×1684、SCALE=2、MARGIN=40pt）：

- 顶部标题「方案总览」（粗体 28pt × SCALE，与原目录页同款）
- 标题下方 16pt 间距处一行副文（14pt × SCALE，灰）：「点击方案名跳转到对应方案页」
- 表格区域起点：`MARGIN + 100*SCALE`，与原目录页 `startY` 一致
- 表头行（高 30pt × SCALE，深灰 `#1f2937` 背景，白字 14pt × SCALE 粗体）：4 列宽度比例 **28% / 22% / 15% / 35%**
  - 名称
  - 空间尺寸
  - 衣柜个数
  - 成本透视
- 数据行（高 36pt × SCALE，文字 14pt × SCALE，垂直居中）：
  - 偶数行（0、2…）白底；奇数行（1、3…）浅灰 `#f3f4f6` 底（zebra）
  - 名称：蓝色 `#2563eb`、下划线，整行水平区域作为内链 hit-box
  - 空间尺寸：`${wall.w}×${wall.h}cm`
  - 衣柜个数：`_countCabinets(plan)` 的结果
  - 成本透视：`plan.cost && plan.cost.grandTotal != null` 时显示 `¥${grandTotal}`，否则显示 `未计算`
- 内链 hit-box：覆盖整行（从表格左缘到右缘），高度 36pt（数据行整高）。与现有目录页一样，记录 PDF 坐标系（`x/SCALE, y/SCALE, w/SCALE, h/SCALE`）
- 行超出单页：以「能容纳的最大行数」截断，下方加灰色提示「… 还有 N 个方案未在表格中列出」（与现有 `_renderToc` 截断逻辑一致）

字段缺失兜底：
- `wall.w` / `wall.h` 缺失：显示 `?`（与现有 `_renderOverview` 行为一致）
- `_countCabinets` 出错或为 0：显示 `0`

### 3.3 修改 `_renderOverview(canvas, ctx, plan)`：右侧信息区追加 5 行板材五金

当前右侧信息区（位于照片右侧、`infoX = MARGIN + photoW + 20*SCALE`）含 3 行：
- 墙体尺寸
- 转角类型
- 是否加高

改造后追加：
- 「是否加高」之后留一行间距（约 16pt × SCALE）
- 续接 5 行板材五金，字号 14pt × SCALE，与上方 3 行同列起始、同字号、行间距同样 30pt × SCALE：
  - `板材: ${m.panel || ''}`
  - `柜门面板: ${m.doorPanel || ''}`
  - `柜门工艺: ${m.doorCraft || ''}`
  - `五金: ${m.hardware || ''}`
  - `灯带: ${m.lighting || ''}`

合计右侧 8 行文字 + 1 行间距 ≈ 30pt × 9 = 270pt，高于照片 240pt 一些；视觉上「右侧续列」由起点对齐保证，底部不要求与照片对齐。

总览页下半段保留原有 `previewImage` 大演示图，不变。

### 3.4 修改 `_renderLayout(canvas, ctx, plan)`：贴 wireframeImage、删板材五金

- 顶部标题改为「布局线框图」（删去「与板材五金」后缀）
- 线框图区域起点 `wfY = MARGIN + 50*SCALE` 不变，宽度同前
- 高度扩展：原 `wfH = 520*SCALE`，删除底部板材五金区后扩到 `CANVAS_H - wfY - MARGIN` 减去一点底部留白（约 60pt × SCALE 留白），即占满整个余下页面
- 内容：调用 `_drawImageContain(canvas, ctx, plan.wireframeImage, MARGIN, wfY, wfW, wfH, '<提示语>')`
  - 有 `wireframeImage` → 直接贴图（按比例 contain，自动居中）
  - 无 `wireframeImage` → 现有 `_drawImageContain` 的 fallback 走 `_drawPlaceholder`，画灰底 + 中央文字
- 提示语文案（仅在占位时显示）：

  > 未计算成本，无线框图。请到「我的方案」选择该方案，选板材五金后点「计算成本」，在成本透视页即可看到线框图。

- 删除原 `_renderLayout` 末尾绘制「板材五金」标题 + 5 行 rows 的所有代码（这些信息已挪到 `_renderOverview` 右侧）

### 3.5 修改 `exportPlans({ canvas, plans, fileName })`

- 调用处：`_renderToc(ctx, plans)` → `_renderOverviewTable(ctx, plans)`
- 其余流程（`_tocPage` 预计算、separator、overview、layout、costPages、`doc.link()` 添加内链）保持不变
- 删除旧 `_renderToc` 函数（不再被引用）

## 4. 错误处理

- `wireframeImage` 路径无效或图片加载失败：`_drawImageContain` 已有 `img.onerror`，自动走占位逻辑显示提示语
- `grandTotal === 0`：仍视为已计算（`!= null` 判定），表格显示 `¥0`
- 总览表行数超出单页（罕见，>30 方案才可能）：截断 + 提示「还有 N 个未列出」，与现有目录页同
- 板材五金某项为空：在总览页右侧显示为空字符串（如 `灯带: `），与现有 `_renderLayout` 旧版行为一致
- 历史缓存中无 `wireframeImage` 的老方案：与「未计算成本」走同一占位分支，显示同一提示语

## 5. 测试策略

项目无单元测试框架。本次改动用人工触发 + 三个固定场景验证：

1. **3 个方案全部已计算成本** —— 检查首页表格 4 列对齐、行数、zebra、内链跳转；检查每个方案总览页右侧 8 行；检查线框图页显示 wireframeImage
2. **1 个方案未计算成本** —— 检查首页成本列显示「未计算」；检查线框图页占位框 + 提示文案
3. **混合：2 个已计算 + 1 个未计算** —— 验证表格混排，又验证两种线框图渲染分支

`_countCabinets(plan)` 抽成纯函数后，可在 Node 下写一个 sanity check 脚本（不要求加入 npm test），覆盖：
- 空 layout（0 柜）
- 仅下排标准柜
- 下排 + 加高排
- 下排含 corner / sk 混合（sk 不计数）

## 6. 不在范围内

- 不修改「我的方案」页面 UI
- 不修改方案数据结构（plan 字段、本地存储）
- 不修改线框图生成时机（仍在设计页 `onConfirmLayout` 时通过 three-renderer 生成）
- 不修改成本明细页结构
- 不修改其他 PDF 通用机制（页码、内链、临时文件输出）
