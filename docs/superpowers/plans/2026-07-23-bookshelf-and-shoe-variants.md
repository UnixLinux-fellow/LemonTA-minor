# 书柜与鞋柜变体（150B/C/D）执行计划

## Context

小程序现有衣柜与鞋柜（150A）两个品类，需要：

1. **新增书柜品类**：plan-list 下拉新增"书柜"，复用 space-setup + design 流程，走 120cm 目录 GLB，柜内三段布局（下 800/中 1200/上=totalH-2000），中段为玻璃门
2. **鞋柜变体扩展**：150B（左右分柜）/150C（=B+左下抽屉）/150D（=A+下柜抽屉排）
3. **深度契约统一**：`DEPTH_INNER` 从 384 → 382（柜体本体 400 - 背板 18 = 382）
4. **玻璃门材质**：`userData.material='glass'` + `_applyMaterial` 分支覆盖为透明

所有变体的 GLB 壳由云端提供（120cm/120A.glb、150cm/150B|C|D.glb），代码只按壳内已划分的分区参数化生成门/抽/层/竖隔。

## 关键约定（深度契约）

- `DEPTH_BODY = 400` 柜体本身
- 门板外挂 20mm（18 门厚 + 2 缝）
- `DEPTH_TOTAL = 420`
- `DEPTH_INNER = 382`（原 384，需修正）
- Z 坐标：柜正面 Z=0，背面 Z=-400，门中心 Z=9，层/隔中心 Z = -18 - 382/2 = -209

## 实施阶段

### 阶段 1：基础重构（先做，确保回归通过）

**目标**：抽取 shoe 的通用工具，统一深度契约，为变体与书柜做铺垫。

**1.1 新建 `miniprogram/cabinet/utils/cabinet-common.js`**

从 `shoe-cabinet-parts.js` 抽出共享工具，导出：
- `SIDE_PANEL_THICK = 18`、`GAP = 2`、`WIDTH_MIN = 800`、`WIDTH_MAX = 3000`
- `_clampW(w)`
- `getDoorCount(totalWidth)`（原逻辑：≤1100→2, ≤1600→3, ≤2100→4, ≤2600→5, else 6）
- `calcDoorSizeAndX(totalWidth, doorCount)` → `{ doorWidths[], xOffsets[] }`
- `getDoorGroups(doorCount)`（奇数 `[1,2,2,...]`，偶数 `[2,2,...]`）

**1.2 改 `miniprogram/cabinet/utils/shoe-cabinet-parts.js`**

- `require('./cabinet-common.js')`，删除本文件内的重复定义
- `DEPTH_INNER = DEPTH_TOTAL - 38`（400 - 18 = 382）— 原为 `DEPTH_TOTAL - 36`（384）
- 主入口签名扩展：`generateCabinetDynamicParts(THREE, w, h, geometries, opts = { variant: 'a' })`
- 未传 opts 时兜底 'a'，保证老调用兼容

**1.3 更新测试**

- 新增 `tests/cabinet-common.test.js`（门数/门宽/门分组边界）
- 改 `tests/shoe-cabinet-parts.test.js`：断言 `DEPTH_INNER === 382`；同步修正 Z 坐标相关期望值
- 如 `tests/cost-engine.test.js` 有 384 断言，同步改 382

### 阶段 2：鞋柜变体 150B/C/D

在 `shoe-cabinet-parts.js` 内按 variant 分发：

```js
switch (variant) {
  case 'b': return _generate150B(...);
  case 'c': return _generate150C(...);
  case 'd': return _generate150D(...);
  default:  return _generate150A(...); // 现有逻辑封装
}
```

**族坐标共享常量**：`SKIRT_H=150`、`LOWER_CABINET_H=850`、`COUNTER_THICK=50`、`VOID_H=450`、`FIXED_H=1500`

**2.1 `_generate150D`**（=150A + 下柜抽屉排）
- 抽屉行 Y=[150, 350]（高 200mm）
- 下柜门 Y 下界抬到 352；下门 h = 980 - 352 = 628
- `getDrawerLayout(doorCount)`：奇数 N → `[1,2,2,...]`（抽屉数 = (N+1)/2）；偶数 N → `[2,2,...]`（抽屉数 = N/2）
- 抽屉 X/W：从 shoe 门 `xOffsets` 按分组合并
- 抽面命名 `drawer_front_NN`（无 `_18` 后缀）
- 抽屉盒 5 板：`drawer_box_left_NN_18` / `right` / `back` / `bottom`
- 层板下柜由 3 层减为 2 层

**2.2 `_generate150B`**（左右分柜；需 `doorCount ≥ 3`，totalW ≥ 1101mm）
- 主分割板 `main_divider_LR`：X 中心 = `xOffsets[2] - GAP/2`；厚 18，Y=[SKIRT_H, totalH]
- 左柜外宽 `leftW = xOffsets[2] - GAP/2`
- 左柜结构：踢脚 150 + 下柜 850 + 台面 50 + 台面以上开放区（无门无层板）
  - 下柜 2 门：`door_lower_L_{1,2}`
  - 下柜活动层板 3 块：`shelf_lower_L_{1..3}`
  - 下柜顶板：`shelf_fixed_down_L`
  - 台面：`countertop_L`
  - 台面以上：无 `shelf_fixed_up_L`、无门、无层板；一整块 18mm 背板 `back_panel_upper_L`（Y=[1000, h-18]）
- 右柜结构：踢脚 150 + 下柜 900（顶板顶面 Y=1050，与左柜台面顶面齐平）+ 上柜（totalH - 1050）；**无台面**
  - `getDoorCount(rightInnerW)` 独立算门数
  - 下柜：`door_lower_R_N` + 3 层 `shelf_lower_R_{1..3}`
  - 上柜：`door_upper_R_N` + 1~2 层
  - 中侧板 `mid_divider_{lower,upper}_R_K`：`getDoorGroups(rightDoorCount)` 分组，奇数首门配中侧板
- **边界兜底**：`doorCount=2` 时降级为 1:1 均分（picker 层建议禁用 B/C）

**2.3 `_generate150C`**（=150B + 左下柜抽屉）
- 左柜下柜：踢脚 150 + 门 650（=850-200）+ 抽屉 200 + 台面 50
- 抽屉宽 = 左柜 2 门宽合计；`drawer_front_L_01`
- 抽屉盒：`drawer_box_left_01_18` / `right_01_18` / `back_01_18` / `bottom_01_18`
- 其余（右柜、主分割板、左开放区）同 150B

**2.4 测试**
- 新增 `tests/shoe-cabinet-parts-variants.test.js`：B/C/D 各断言主分割板存在、抽屉数、门 Y 范围

### 阶段 3：书柜 `bookshelf-parts.js`（新）

**族坐标**（mm）
- `SKIRT_H_BS = 60`（书柜踢脚更矮）
- `LOWER_H = 800`（含踢脚）
- `MIDDLE_H = 1200`
- `UPPER_H = totalH - 2000`
- `fixed_divider_down`：Y=800 顶（中心 791）
- `fixed_divider_up`：Y=2000 顶（中心 1991）

**门**（三段共享 `xOffsets`，同一门数 N）
- 下：Y=[62, 798] → h=736，命名 `door_lower_N`
- 中：Y=[820, 1998] → h=1178，命名 `door_middle_N`，`userData.material='glass'`
- 上：Y=[2020, totalH-2]，命名 `door_upper_N`

**层板**
- 下段 1 块：Y = 430，`shelf_lower_1`
- 中段 3 块：等分 1200mm，`shelf_middle_{1..3}`
- 上段 0 块

**中侧板**（复用 `getDoorGroups`）
- `mid_divider_lower_N` / `mid_divider_middle_N` / `mid_divider_upper_N`

**背板**（三段独立）
- `back_panel_lower` / `back_panel_middle` / `back_panel_upper`

**导出**
```js
module.exports = {
  LOWER_H, MIDDLE_H, SKIRT_H_BS,
  DEPTH_BODY, DEPTH_INNER, DEPTH_TOTAL,
  createDoorGroup, createShelfGroup, createDividerGroup,
  createFixedDividerGroup, createBackPanelGroup,
  generateBookshelfDynamicParts,
  clearOldParts,
};
```

**测试**：新增 `tests/bookshelf-parts.test.js`（三段几何、玻璃 userData、层板数、门 Y 对齐）

### 阶段 4：three-renderer 集成

**4.1 `_resolveTarget(it)` 新增书柜分支**
```js
if (it.kind === 'bookshelf') {
  const letter = (it.code || 'a').charAt(0).toLowerCase();
  return { subdir: '120cm', name: `120${letter.toUpperCase()}.glb` };
}
```

**4.2 主渲染分支**
- `isBookshelf = it.kind === 'bookshelf'`
- 走类似 shoe 的路径：
  1. `_prepareBookshelfShellAndSamples(mesh)`：剔除 door / shelf / mid_divider / fixed_divider / back_panel
  2. `bookshelfParts.generateBookshelfDynamicParts(THREE, w*10, h*10, sampleGeometries)`
  3. mm → cm scale=0.1，挂到 mesh 平级 group

**4.3 shoe 路径传 variant**
```js
_dynShoe = shoeCabinetParts.generateCabinetDynamicParts(
  THREE, targetWmm, targetHmm, sampleGeometries,
  { variant: (it.code || 'a').toLowerCase() }
);
```

**4.4 `_applyMaterial` 玻璃分支**（在现有 traverse 首段插入）
```js
if (n.userData && n.userData.material === 'glass') {
  n.material = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.28,
    roughness: 0.1, metalness: 0.0,
  });
  n.material.needsUpdate = true;
  return;
}
```

### 阶段 5：前端流程（plan-list / space-setup / rules / design）

**5.1 `miniprogram/pages/plan-list/index.js`**
```js
modeOptions: [
  { id: 'wardrobe',  label: '衣柜' },
  { id: 'shoe',      label: '鞋柜' },
  { id: 'bookshelf', label: '书柜' },
]
```

**5.2 `miniprogram/pages/space-setup/index.js`**
- `isBookshelf = mode === 'bookshelf'`；将 `isShoe || isBookshelf` 统一处理墙面/转角
- 墙宽 80~300、墙高 220~270（同鞋柜）
- 复用 `CORNER_OPTIONS_SHOE`（BKQ/ZKQ/YKQ/ZYKQ）
- `cornerSectionLabel = '是否靠墙'`
- `defaultCorner = 'BKQ'`
- `wall.d = 50`
- `validate()` 中 `mode === 'bookshelf'` 与 `mode === 'shoe'` 同分支（跳过转角/标准段校验）

**5.3 `miniprogram/utils/cabinet-rules.js`**
```js
const MODE = { WARDROBE: 'wardrobe', SHOE: 'shoe', BOOKSHELF: 'bookshelf' };
const WALL_LIMIT_BOOKSHELF = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 };

function validateWall(width, height, mode) {
  const limit = mode === MODE.SHOE ? WALL_LIMIT_SHOE
              : mode === MODE.BOOKSHELF ? WALL_LIMIT_BOOKSHELF
              : WALL_LIMIT;
  // ... 原有逻辑
}
```

**5.4 `miniprogram/cabinet/utils/cabinet-model.js`**
- `categorize()` 新增 `bookshelf` 桶（120cm/ 目录）

**5.5 `miniprogram/cabinet/pages/design/index.js`**（结构镜像 shoe）

新增 bookshelf 分支：
- `modelList = enrichWithDesc(grouped.bookshelf || [])`；兜底 `[{ subdir:'120cm', name:'120A.glb', w:120, h:220, code:'a', kind:'bookshelf', descText:'书柜' }]`
- `items = [{ id:'bookshelf-0', kind:'bookshelf', code, w:wallW, h:wallH }]`（含左右靠墙 sk 兜底同 shoe）
- data: `sizeTab: 120`, `show50/100/150 = false`, `show120 = true`
- `cornerLabel: '书柜'`, `nextBtnText: '确认布局'`
- `onPickModel`：改 `bookshelfItem.code`，重载 renderer

`design.wxml` 新增 `show120` tab，布局同 150cm。

### 阶段 6：成本与价格

**6.1 运行时板件尺寸提取（成本核心改造）**

原路径：cost-engine 读 GLB 元数据的 `board_list` → panel-formulas 按 W/H 反推尺寸。
新路径：**代码运行时生成的每个 mesh 已经带有精确的 name + scale × baseGeometry**，直接从这些 mesh 提取实际板件尺寸，喂给 cost-engine，不再依赖云端 GLB 元数据里的 `board_list`（元数据仅保留 shell 侧板/顶板/背板等静态板件）。

具体做法：
- `shoe-cabinet-parts.js` / `bookshelf-parts.js` 每个 `create*Group` 生成的 mesh 都要挂 `userData.panel = { code, length, width, thickness }`（单位 mm，length = 长边，width = 短边，thickness 通常 18）
- 抽屉盒/隔板/门板/层板/主分割板/背板/台面全部按此约定
- 新增 `miniprogram/utils/parts-to-board-list.js`：遍历 `_dynShoe.root` / `_dynBookshelf.root`，收集 `userData.panel`，按 code 汇总 → 输出 `board_list` 结构（`node_name`、`length`、`width`、`thickness`、`area`），单位换算 mm → cm，与 cost-engine 现有 `board_list` 格式一致
- three-renderer 在 `_prepareCostBoardList(it)` 时，若 `it.kind === 'shoe' | 'bookshelf'`，用运行时板件列表替换 GLB 元数据的对应项（合并策略：静态板件走元数据，动态板件走运行时）
- cost-engine 侧无需改动 —— 它只关心传入的 `board_list`

**6.2 `miniprogram/utils/panel-formulas.js`**（保留兜底，不再是主路径）

当 GLB 元数据里若仍有旧的动态板件条目，公式表用于回填缺失字段。新增 key：
- `door_middle_18`（玻璃门，公式同 `door_single_18`）
- `fixed_divider_up_18`、`fixed_divider_down_18`（同 `top_panel_18`）
- `mid_divider_middle_18`（同 `w1_side_left_panel_18`）
- `main_divider_LR_18`（150B/C 主分割板，同侧板公式）
- `drawer_front_L_01_18`（同 `drawer_box_front_01_18`）

**6.3 `docs/price.json`** — 新增：
```json
{"code":"door_material_glass_middle","price":0,"category":"door_material","desc":"书柜中段玻璃门（占位）"}
```

**6.4 测试**
- 新增 `tests/parts-to-board-list.test.js`：给一个 mock 的 `_dynShoe.root`（含 door/shelf/divider/drawer_box），断言输出的 `board_list` 每项 `length/width/thickness/area` 与 mesh scale 一致
- 扩展 `tests/cost-engine.test.js`：混合 GLB 元数据的静态板 + 运行时 board_list，验证成本正确汇总

## 关键复用点

- `getDoorCount` / `calcDoorSizeAndX` / `getDoorGroups`：从 shoe 抽到 cabinet-common，书柜与鞋柜变体共享
- GLB 缓存（`GLB_BUFFER_CACHE`、`_loaderCache`）、`_stripNonGeometryNodes`、mm→cm scale=0.1、场景 Z 对齐：完全复用 shoe 现有路径
- `_applyMaterial` 主循环：在最前面加玻璃 early return，不影响原有颜色分支

## 关键文件清单

- 新建：`miniprogram/cabinet/utils/cabinet-common.js`
- 新建：`miniprogram/cabinet/utils/bookshelf-parts.js`
- 改：`miniprogram/cabinet/utils/shoe-cabinet-parts.js`（DEPTH_INNER + variant 分发 + B/C/D 实现）
- 改：`miniprogram/cabinet/utils/three-renderer.js`（bookshelf 分支 + variant 参数 + 玻璃材质）
- 改：`miniprogram/cabinet/pages/design/index.js` + `design.wxml`（bookshelf 状态机 + 120 tab）
- 改：`miniprogram/pages/plan-list/index.js`（modeOptions）
- 改：`miniprogram/pages/space-setup/index.js`（bookshelf 分支）
- 改：`miniprogram/utils/cabinet-rules.js`（MODE.BOOKSHELF + WALL_LIMIT_BOOKSHELF）
- 改：`miniprogram/cabinet/utils/cabinet-model.js`（categorize.bookshelf）
- 改：`miniprogram/utils/panel-formulas.js`（新 keys，兜底用）
- 新建：`miniprogram/utils/parts-to-board-list.js`（运行时 mesh → board_list）
- 改：`miniprogram/cabinet/utils/three-renderer.js`（`_prepareCostBoardList` 合并运行时板件）
- 改：`docs/price.json`（玻璃占位）
- 新建：`tests/cabinet-common.test.js`、`tests/bookshelf-parts.test.js`、`tests/shoe-cabinet-parts-variants.test.js`、`tests/parts-to-board-list.test.js`
- 改：`tests/shoe-cabinet-parts.test.js`（DEPTH_INNER 384→382）
- 改：`tests/cost-engine.test.js`（运行时 board_list 合并；如有 384 断言同步 382）

## 错误处理与已知遗留

- 云端 `120cm/` 目录为空：兜底一张 `120A.glb`
- `variant` 非 a/b/c/d：默认走 'a'
- 玻璃材质在 miniprogram three 环境不支持 `MeshPhysicalMaterial`：退化到 `MeshStandardMaterial({ transparent:true, opacity:0.28 })`
- GLB 元数据缺失新板件：cost-engine 现有 fallback（baseMeta 尺寸 + warn）
- 150B/C 在 totalW < 1101mm 时不适用（picker 层需按当前墙宽过滤，本 PR 不做，兜底 1:1 均分）
- 玻璃门单价 `door_material_glass_middle` 占位 0，待运营填真实值
- 铰链数、灯带瓦数可视化本次不做

## 验证方法

**单测**
```bash
node --test tests/cabinet-common.test.js
node --test tests/bookshelf-parts.test.js
node --test tests/shoe-cabinet-parts.test.js
node --test tests/shoe-cabinet-parts-variants.test.js
node --test tests/cost-engine.test.js
```

**手动端到端**
1. 微信开发者工具打开小程序，plan-list 应看到"书柜"选项
2. 选书柜 → space-setup（墙宽 80~300、墙高 220~270、靠墙选项）→ design
3. design 显示 120cm tab，加载 120A.glb，检查三段布局与玻璃门透明度
4. 切鞋柜 → picker 选 150B/C/D，检查主分割板、抽屉、门数
5. 切换颜色 / 显示门板，玻璃门保持透明
6. 打开设计详情，验证成本表包含新板件行（价格 0 时 warn 可接受）
7. 深度契约：肉眼检查门板与柜体正面对齐，无 2mm 前后错位

## 执行顺序

按阶段 1 → 2 → 3 → 4 → 5 → 6 推进。每阶段完成后跑对应测试，全绿再进入下一阶段。前 3 阶段可以先合并为一个功能分支的多次提交，后 3 阶段涉及 UI，建议在开发者工具中逐个手动验证。
