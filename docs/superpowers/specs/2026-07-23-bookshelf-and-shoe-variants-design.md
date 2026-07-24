# 书柜与鞋柜变体（150B/C/D）设计

## 背景

现有小程序已有衣柜与鞋柜（150A）两个品类。本次需在 plan-list 下拉框新增第 3 类"书柜"，并给鞋柜增加 3 个内部变体：150B（左右分柜、左柜上部开放）、150C（=150B + 左下柜抽屉）、150D（=150A + 下柜底部抽屉排）。所有变体的 GLB 壳均由云端提供（120cm/120A.glb、150cm/150B|C|D.glb），代码只按壳内已划分的分区参数化生成门/抽/层/竖隔。

## 目标与非目标

**目标**
- plan-list 下拉框加"书柜"选项；书柜复用 space-setup + design 页面，行为镜像鞋柜
- 书柜设计页只显示 120cm tab，默认加载云端 120A.glb
- 书柜内部三段布局参数化：下 800mm（平开门 + 1 层）/ 中 1200mm（玻璃门 + 3 层）/ 上=总高-2000mm（平开门、无层板）
- 鞋柜 picker 新增 150B/C/D 三个变体，通过 `shoeItem.code` 切换即时重载
- 150D 下柜按门数奇偶生成抽屉排，抽屉盒按 `drawer_box_{方位}_{序号}_{厚度}` 命名
- 150B 左右分柜（左=2 门宽，右=剩余），中间主分割板贯穿全高
- 150C = 150B + 左下柜门板之上一排 200mm 抽屉
- 深度契约按需求书重算：柜体本体 400mm、门板 +20mm 外挂，`DEPTH_INNER` 全线统一为 382mm（鞋柜历史值 384 同步改）
- 玻璃门材质：`userData.material='glass'` 标记 + `_applyMaterial` 覆盖为透明材质
- 成本口不改逻辑，`panel-formulas.js` 补齐新板件 key，`price.json` 新增 `door_material_glass_middle` 占位

**非目标**
- 不改云函数 `listCabinetModels`（120cm/、150cm/ 子目录归类由现有实现完成）
- 不手写 GLB 元数据（`model_panel_hardware` 由云端配置）
- 不做书柜/鞋柜混排（1 面墙 = 1 个柜体，同鞋柜）
- 不做玻璃门单价的真实值确定（先占位），后续会在系噶个字典中新增
- 不做铰链数/灯带瓦数的可视化

## 架构

```
plan-list（modeOptions[]）
  ├─ wardrobe → space-setup(墙宽 44~1000 / 高 232~1000 / 显示转角块)
  ├─ shoe     → space-setup(墙宽 80~300  / 高 220~270  / 显示"是否靠墙")
  └─ bookshelf→ space-setup(墙宽 80~300  / 高 220~270  / 显示"是否靠墙")

space-setup（按 draftPlan.mode 分支）
  → redirectTo /cabinet/pages/design/index

cabinet/pages/design（按 plan.mode 分支）
  ├─ wardrobe：旧行为
  ├─ shoe：150cm tab、modelList 从 150cm/ 目录（含 A/B/C/D）
  └─ bookshelf：120cm tab、modelList 从 120cm/ 目录（含 A、后续可扩）

three-renderer（按 it.kind 分支）
  ├─ kind='shoe' → 加载 150{code}.glb、剔除动态部件、
  │                shoe-cabinet-parts.generateCabinetDynamicParts({ variant: code })
  └─ kind='bookshelf' → 加载 120{code}.glb、剔除动态部件、
                        bookshelf-parts.generateBookshelfDynamicParts()

cabinet/utils/
  ├─ cabinet-common.js  （新）  共享门数/门宽/常量
  ├─ shoe-cabinet-parts.js（改） 加 variant 分发 a/b/c/d
  └─ bookshelf-parts.js  （新）  三段几何 + 玻璃门标记
```

## 深度契约

需求书原文："柜体总深永远固定 400mm（不含门板厚度（门板占20mm，门板厚度18mm））"

统一约定：
- `DEPTH_BODY = 400`（柜体本身：侧板/顶板/底板/背板/层板包络）
- 门板占位在柜体正面**外加** 20mm（18mm 门厚 + 2mm 缝）
- `DEPTH_TOTAL = DEPTH_BODY + 20 = 420`（前后总跨度）
- `DEPTH_INNER = DEPTH_BODY - 18(背板) = 382`（层板/隔板深度）
- 渲染约定：柜体正面 Z=0，柜体背面 Z=-400，门中心 Z=9，层板/隔板中心 Z = -18 - 382/2 = -209
- 鞋柜历史值 `DEPTH_INNER=384` 同步改 382（差 2mm，需重跑鞋柜测试期望值）

## 模块契约

### `miniprogram/cabinet/utils/cabinet-common.js`（新）

抽出鞋柜/书柜共享的门数与门宽算法。单位 mm。

```js
const SIDE_PANEL_THICK = 18;
const GAP = 2;
const WIDTH_MIN = 800;
const WIDTH_MAX = 3000;

function _clampW(w) { ... }
function getDoorCount(totalWidth) {
  // ≤1100→2, ≤1600→3, ≤2100→4, ≤2600→5, else 6
}
function calcDoorSizeAndX(totalWidth, doorCount) {
  // 均分内宽，余量补最后一扇；返回 { doorWidths[], xOffsets[] }
}
function getDoorGroups(doorCount) {
  // 奇数：[1, 2, 2, ...]；偶数：[2, 2, ...]
}
module.exports = { SIDE_PANEL_THICK, GAP, WIDTH_MIN, WIDTH_MAX,
                   _clampW, getDoorCount, calcDoorSizeAndX, getDoorGroups };
```

### `miniprogram/cabinet/utils/shoe-cabinet-parts.js`（改）

- 从 `cabinet-common.js` `require` 共享工具，删除本文件内的重复定义
- `DEPTH_INNER` 从 384 改为 382
- `generateCabinetDynamicParts(THREE, w, h, geometries, opts = { variant: 'a' })` 加 opts
- 内部按 variant 分发：
  - `variant='a'`：现有逻辑不变
  - `variant='b'`：调用 `_generate150B(...)`
  - `variant='c'`：调用 `_generate150C(...)`
  - `variant='d'`：调用 `_generate150D(...)`
- 未传 opts 时兜底 'a'，保证老调用兼容

**族坐标**（150A/B/C/D 共享）
- 踢脚 `SKIRT_H = 150`、下柜 `LOWER_CABINET_H = 850`、台面 `COUNTER_THICK = 50`、悬空 `VOID_H = 450`、`FIXED_H = 1500`

**150D 变体**
- 抽屉行 Y=[SKIRT_H, SKIRT_H + 200]=[150, 350]
- 下柜门 Y 下界抬到 350 + GAP = 352；下门 h = 980 - 352 = 628（原 828 - 200）
- 抽屉分列 `getDrawerLayout(doorCount)`：
  - 奇数 N：`[1, 2, 2, ...]`，抽屉数=(N+1)/2
  - 偶数 N：`[2, 2, ...]`，抽屉数=N/2
- 抽屉 X/W：从 shoe 门 xOffsets 累加合并
- 抽屉盒（内部 5 板）参数化：`drawer_box_left_NN_18`、`drawer_box_right_NN_18`、`drawer_box_back_NN_18`、`drawer_box_bottom_NN_18`；抽面 `drawer_front_NN`（无 _18 后缀，视觉件）
- 层板下柜由 3 层减为 2 层（受抽屉挤占空间；均分门内空间）

**150B 变体**（要求 `getDoorCount(totalW) ≥ 3`，即 totalW ≥ 1101mm；否则 150B/C 在 picker 上应禁用或按 2 门时兜底为 1:1 均分）
- 主分割板中心 X = `xOffsets[2] - GAP/2`（第 3 扇门起点前的缝隙中线）
- 左柜外宽 `leftW = xOffsets[2] - GAP/2`
- 右柜外宽 `rightW = totalW - leftW`（右柜内宽再扣主分割板 18mm 与右侧板 18mm）
- 主分割板 `main_divider_LR`：厚 18mm，X 中心 = `xOffsets[2] - GAP/2`，Y=[SKIRT_H, totalH]，全高贯穿
- 左柜：踢脚 150 + 下柜 850 + 台面 50 + 台面以上开放区（悬空 + 上柜段）
  - 下柜：2 扇门 `door_lower_L_{1,2}`，3 块活动层板 `shelf_lower_L_{1..3}`，顶部 `shelf_fixed_down_L`（下柜顶板）
  - 台面 50mm：`countertop_L`
  - 台面以上：无门、无 `shelf_fixed_up_L`（不再生成上柜底板）、无层板，一整块 18mm 背板 `back_panel_upper_L`（Y=[1000, h-18]）
- 右柜：踢脚 150 + 下柜 900（顶板顶面 Y=1050，与左柜台面顶面齐平）+ 上柜 =（totalH - 1050）；**右柜无台面**，下柜顶板直接接上柜底板
  - 下柜：门 `door_lower_R_N`（右柜内宽走 `getDoorCount(rightInnerW)` 独立算门数）、层板 3 块 `shelf_lower_R_{1..3}`
  - 上柜：门 `door_upper_R_N`；层板：≤800→1 块、>800→2 块
  - 中侧板：按 `getDoorGroups(rightDoorCount)` 分组 → 奇数门 [1,2,2,...] 首扇单门配中侧板；偶数门 [2,2,...] 全对开无中侧板。命名 `mid_divider_lower_R_{K}` / `mid_divider_upper_R_{K}`

**150C 变体**（= 150B + 左下柜抽屉）
- 左柜下柜结构改为：踢脚 150 + 门 650（=850-200）+ 抽屉 200 + 台面 50
  - 抽屉宽度 = 左柜 2 门宽的合计
  - 抽面 `drawer_front_L_01`
  - 抽屉盒：`drawer_box_left_01_18` / `right_01_18` / `back_01_18` / `bottom_01_18`
- 其余（右柜、主分割板、左开放区）同 150B

### `miniprogram/cabinet/utils/bookshelf-parts.js`（新）

单位 mm，依赖注入 THREE。

**族坐标**
- `LOWER_H = 800`（含踢脚 60）
- `MIDDLE_H = 1200`
- `UPPER_H = totalH - 2000`
- 段间水平板厚 18mm（`fixed_divider_down` 位于 Y=800、`fixed_divider_up` 位于 Y=2000）
- 无台面、无悬空区

**门**
- `createDoorGroup`：三段门共享 xOffsets（同一门数 N）
  - 下门 Y=[SKIRT_H_BS=60 + GAP, 800 - GAP] → h = 800-60-2*GAP = 736
  - 中门 Y=[800 + 18 + GAP, 2000 - GAP] → h = 2000-818-2*GAP = 1178（玻璃）
  - 上门 Y=[2000 + 18 + GAP, totalH - GAP]
  - 命名：`door_lower_N`、`door_middle_N`、`door_upper_N`
  - 中门 mesh `userData.material = 'glass'`

**层板**
- 下段 1 块：Y = (60 + 800) / 2 = 430，命名 `shelf_lower_1`
- 中段 3 块：等分 1200mm 高，命名 `shelf_middle_{1..3}`
- 上段无层板

**中侧板**
- `mid_divider_lower_N` / `mid_divider_middle_N` / `mid_divider_upper_N`
- X 由 `getDoorGroups` 分组边界决定，与 shoe 完全对齐

**固定水平板 / 背板**
- `fixed_divider_down`：Y=800 顶（中心 Y=791）
- `fixed_divider_up`：Y=2000 顶（中心 Y=1991）
- 背板三段：`back_panel_lower`、`back_panel_middle`、`back_panel_upper`

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

### `miniprogram/cabinet/utils/three-renderer.js`（改）

**`_resolveTarget(it)` 新增分支**
```js
if (it.kind === 'bookshelf') {
  const letter = (it.code || 'a').charAt(0).toLowerCase();
  return { subdir: '120cm', name: `120${letter.toUpperCase()}.glb` };
}
```

**主渲染分支**
- 判断 `isBookshelf = it.kind === 'bookshelf'`
- `isBookshelf` 时走类似 `isShoe` 的路径：
  1. `_prepareBookshelfShellAndSamples(mesh)` 剔除动态部件（door / shelf / mid_divider / fixed_divider / back_panel）
  2. `bookshelfParts.generateBookshelfDynamicParts(THREE, w*10, h*10, sampleGeometries)`
  3. mm→cm scale=0.1，挂到 mesh 平级 group，位置对齐 shell 正面

**`_applyMaterial(group, color, it)` 扩展**
```js
group.traverse((n) => {
  if (!n.isMesh) return;
  if (n.userData && n.userData.material === 'glass') {
    n.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.28,
      roughness: 0.1, metalness: 0.0,
    });
    return;
  }
  // 原有着色逻辑
});
```

**`isShoe` 分支扩展**：传 `variant`
```js
_dynShoe = shoeCabinetParts.generateCabinetDynamicParts(
  THREE, targetWmm, targetHmm, sampleGeometries,
  { variant: (it.code || 'a').toLowerCase() }
);
```

### `miniprogram/pages/plan-list/index.js`（改）

`modeOptions` 增加 bookshelf：
```js
modeOptions: [
  { id: 'wardrobe',  label: '衣柜' },
  { id: 'shoe',      label: '鞋柜' },
  { id: 'bookshelf', label: '书柜' },
]
```

### `miniprogram/pages/space-setup/index.js`（改）

- `isBookshelf = mode === 'bookshelf'`
- 墙宽 80~300、墙高 220~270（同鞋柜）
- 转角选项复用 `CORNER_OPTIONS_SHOE`（BKQ/ZKQ/YKQ/ZYKQ）
- `cornerSectionLabel = '是否靠墙'`
- `defaultCorner = 'BKQ'`
- `wall.d = 50`（同鞋柜的 cm 场景深度）
- `validate()`：`mode === 'bookshelf'` 与 `mode === 'shoe'` 一样跳过转角与标准段校验

### `miniprogram/utils/cabinet-rules.js`（改）

```js
const MODE = { WARDROBE: 'wardrobe', SHOE: 'shoe', BOOKSHELF: 'bookshelf' };
const WALL_LIMIT_BOOKSHELF = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 };

function validateWall(width, height, mode) {
  let limit;
  if (mode === MODE.SHOE) limit = WALL_LIMIT_SHOE;
  else if (mode === MODE.BOOKSHELF) limit = WALL_LIMIT_BOOKSHELF;
  else limit = WALL_LIMIT;
  // ...
}
```

### `miniprogram/cabinet/pages/design/index.js`（改）

新增 bookshelf 分支（结构上镜像 shoe）：
- `modelList = enrichWithDesc(grouped.bookshelf || [])`，兜底 `[{ subdir:'120cm', name:'120A.glb', w:120, h:220, code:'a', kind:'bookshelf', descText:'书柜' }]`
- `items = [{ id:'bookshelf-0', kind:'bookshelf', code, w:wallW, h:wallH }]`
- `sizeTab: 120`, `show50/100/150 = false`, `show120 = true`
- `cornerLabel: '书柜'`, `nextBtnText: '确认布局'`
- `onPickModel`：改 `bookshelfItem.code`，重载 renderer

`design.wxml` 增加 120cm tab（条件 `show120`），布局同 150cm。

### `miniprogram/utils/panel-formulas.js`（改）

新增 keys（尺寸公式与既有同类相同）：
- `door_middle_18`（玻璃门，公式同 `door_single_18`）
- `fixed_divider_up_18`、`fixed_divider_down_18`（同 `top_panel_18` 公式）
- `mid_divider_middle_18`（同 `w1_side_left_panel_18` 公式）
- `main_divider_LR_18`（150B/C 主分割板，同侧板公式）
- `drawer_front_L_01_18`（同 `drawer_box_front_01_18` 公式）

### `docs/price.json`（改）

新增 code：
```json
{ "code": "door_material_glass_middle", "price": 0, "desc": "书柜中段玻璃门（占位）" }
```

## 数据流

**书柜创建路径**：plan-list 下拉选"书柜" → draftPlan.mode='bookshelf' → space-setup 收集 wall+corner → redirectTo design → design 加载 120cm 目录 GLB → renderer 渲染。

**鞋柜变体切换**：design 页 `onPickModel` → `shoeItem.code = m.code` → `renderer.setItems()` → `_resolveTarget` 返回新 GLB 名 → `_prepareShoeShellAndSamples` 剔除 → `generateCabinetDynamicParts({ variant })` 参数化生成。

**成本计算**：cost-engine 不变，读 GLB 元数据的 `board_list`（云端已包含变体的板件清单）。新板件 code 在 `panel-formulas.js` 里有公式，未在表中的 fallback baseMeta。

## 错误处理

- 云端 `120cm/` 目录为空：兜底一张 120A.glb（同 shoe 的 150A 兜底思路）
- `variant` 传了非 a/b/c/d：`shoe-cabinet-parts._generate150X` 默认走 'a'
- 玻璃材质在 miniprogram three 环境不支持 `MeshPhysicalMaterial`：退化到 `MeshStandardMaterial({ transparent: true, opacity: 0.28 })`
- GLB 元数据里缺失新板件：`cost-engine` 保留现有 fallback（用 baseMeta 尺寸 + warn）

## 测试

**新增**
- `tests/cabinet-common.test.js`：`getDoorCount`、`calcDoorSizeAndX`、`getDoorGroups` 边界
- `tests/bookshelf-parts.test.js`：三段几何、玻璃门 userData 标记、层板数、门 Y 对齐
- `tests/shoe-cabinet-parts-variants.test.js`：150B/C/D 分支的门/抽/主分割板结构

**扩展**
- `tests/shoe-cabinet-parts.test.js`：`DEPTH_INNER` 从 384 → 382，同步更新期望值
- `tests/cost-engine.test.js`：如已断言 384，同步更新

## 已知遗留

- 玻璃门 `door_material_glass_middle` 单价占位为 0，需运营侧后续填真实值
- 150B/C/D 的 GLB 元数据 `board_list` / `hardware_list` 需云端上传（本 PR 前置依赖，若未上线则成本为 0 + warn）
- 铰链数、灯带瓦数的可视化仍延后（本次仅数据流联动）
- 150B/C 在 totalW < 1101mm（doorCount=2）时不适用，picker 层需按当前墙宽过滤可选变体
- 玻璃门在 miniprogram three 环境下的真实透明表现受 WebGL 上下文能力限制（透射/折射不保证）

