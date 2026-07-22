# 鞋柜功能设计

## 背景

现有小程序只支持衣柜设计,用户从 plan-list 页"开始新设计"进入 space-setup(空间设置)填墙宽/墙高/转角,再进设计页排列 50/100/150cm 柜子。150cm 一档实际用途是鞋柜(GLB 名 `150S.glb`),但目前只能作为整墙上"一格 150cm 宽"的柜子,与文档要求的"填满整墙的可参数化鞋柜"相差甚远。

本次新增独立鞋柜模式,和衣柜模式在入口分岔:选鞋柜进入的空间设置页收紧墙面尺寸区间、隐藏转角选项;进入的设计页只显示 150cm tab、只放一个占满整墙的鞋柜、隐藏加高开关。鞋柜由代码生成门/中隔板/层板叠加到简化后的 150S.glb 壳上。

## 目标与非目标

**目标:**
- plan-list 新建入口分"衣柜/鞋柜"两选项,复用现有 space-setup / design 两个页面
- 鞋柜空间设置墙宽区间 80~300cm、墙高 220~270cm,隐藏"是否有转角衣柜"整块
- 鞋柜设计页只显示 150cm tab,隐藏"需要加高模块"开关,3D 场景放一个占满整墙的参数化鞋柜
- 鞋柜的门板/中隔板/层板按文档参数化生成(门数 2~6 扇,门宽均分余量补最后一扇,上下门 X 对齐,层板按上柜高分 1/2 块,下柜固定 4 层)
- 侧板厚度永远 18mm 不缩放;踢脚 150 / 下柜 850 / 台面 50 / 悬空 450 高度固定,只上柜高随总高变化;深度永远 400mm

**非目标:**
- 不改导出/成本/材料页(鞋柜先复用衣柜的成本模型,由后续 PR 单独处理)
- 不改云函数 / cloudfunctions/listCabinetModels(150S.glb 仍从 150cm/ 目录拉)
- 不做"衣柜和鞋柜混排"(选鞋柜就独占整墙)
- 不做多个鞋柜并排(1 面墙 = 1 个鞋柜)
- 不做铰链/灯带的可视化(文档说的可变配置里,铰链数、灯带瓦数仅用于后续物料计算,本期不落地)

## 架构

```
plan-list
  └─ 点 "+ 开始新设计"
     └─ wx.showActionSheet(['衣柜', '鞋柜'])
        ├─ 衣柜: draftPlan = { mode: 'wardrobe' }
        └─ 鞋柜: draftPlan = { mode: 'shoe' }
     → wx.navigateTo /pages/space-setup/index

space-setup (共用,按 draftPlan.mode 分支)
  ├─ mode=wardrobe: 墙宽 44~1000 / 墙高 232~1000 / 显示转角块 (旧行为)
  └─ mode=shoe:     墙宽 80~300  / 墙高 220~270  / 隐藏转角块
  → wx.redirectTo /cabinet/pages/design/index (plan.mode 随 draftPlan 带过去)

cabinet/pages/design (共用,按 plan.mode 分支)
  ├─ mode=wardrobe: 旧行为
  └─ mode=shoe:
     - picker 只显示 150cm tab, modelList = [{ 鞋柜 }]
     - 隐藏 "需要加高模块" 开关 (.raise-row)
     - "上一模块" 按钮隐藏
     - "下一模块" 按钮显示为 "确认布局"
     - _state 直接构造 items=[{ kind:'shoe', w:wallW, h:wallH }], isFull=true (不走 layoutEngine 排队)
     - three-renderer 加载: kind='shoe' 触发新分支

three-renderer (新增分支)
  kind='shoe' 时:
    1. 加载 150S.glb
    2. traverse: door / shelf / vertical|divider 节点全部 remove
    3. 保留 shell (side/top/bottom/back/side/counter/skirt 等) 按 X/Y 独立缩放,
       侧板 (X 位置在两端) 单独保持 18mm 不做 X 缩放
    4. 调 shoeCabinetParts.generateCabinetDynamicParts(THREE, w*10, h*10)
       返回 Group (mm 单位) → scale 0.1 → add 到 GLB group
    5. 材质走现有 _applyMaterial

utils/cabinet-rules.js (扩展)
  - WALL_LIMIT_SHOE = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 }
  - validateWall(w, h, mode='wardrobe') 按 mode 用不同 limit

cabinet/utils/shoe-cabinet-parts.js (新增)
  - 纯几何+计算,单位全 mm
  - 依赖注入 THREE 便于 Node 单测 mock

tests/shoe-cabinet-parts.test.js (新增)
  - getDoorCount 区间边界
  - calcDoorSizeAndX 门宽均分+余量补最后一扇
  - createDoorGroup / createShelfGroup / createDividerGroup 输出 Group 结构与位置数值
```

## 模块契约

### `miniprogram/cabinet/utils/shoe-cabinet-parts.js`(新增)

单位全部 mm。所有函数接受 THREE 依赖注入,便于测试。

**常量**
```js
const SIDE_PANEL_THICK = 18;
const GAP = 2;
const LOWER_CABINET_H = 850;
const SKIRT_H = 150;
const COUNTER_THICK = 50;
const VOID_H = 450;
const DEPTH_INNER = 364;
const FIXED_H = SKIRT_H + LOWER_CABINET_H + COUNTER_THICK + VOID_H; // 1500
```

**函数**

- `getDoorCount(totalWidth: number) -> number`
  - 钳制到 [800, 3000]
  - 区间表:
    - [800, 1100] → 2
    - [1101, 1600] → 3
    - [1601, 2100] → 4
    - [2101, 2600] → 5
    - [2601, 3000] → 6

- `calcDoorSizeAndX(totalWidth: number, doorCount: number) -> { doorWidths: number[], xOffsets: number[] }`
  - 内宽 = totalWidth - SIDE_PANEL_THICK*2
  - 总缝 = GAP * (doorCount + 1)
  - baseW = Math.floor((内宽 - 总缝) / doorCount)
  - 余量 = 内宽 - 总缝 - baseW * doorCount 全部加到最后一扇
  - doorWidths = [baseW, baseW, ..., baseW + 余量]
  - xOffsets[i] = 第 i 扇门左侧 X (以柜体左端为 0),xOffsets[0] = SIDE_PANEL_THICK + GAP
  - xOffsets[i] = xOffsets[i-1] + doorWidths[i-1] + GAP

- `createDoorMesh(THREE, widthMm: number, heightMm: number, doorGeometry) -> Mesh`
  - 克隆 doorGeometry(基准 450 × 846 × 18)
  - scale.x = widthMm / 450, scale.y = heightMm / 846, scale.z = 1
  - 返回 mesh(位置留给调用方设置)

- `createDoorGroup(THREE, totalWidth: number, totalHeight: number, sizeAndX, doorGeometry) -> Group`
  - 上柜高 upperH = totalHeight - FIXED_H
  - 下门高 lowerDoorH = LOWER_CABINET_H - GAP*2 = 846
  - 下门 Y 基准 = SKIRT_H + GAP = 152 (门底部)
  - 上门高 upperDoorH = upperH - GAP*2
  - 上门 Y 基准 = FIXED_H + GAP = 1502 (门底部)
  - 每扇门用同 xOffsets:下门 doorCount 个 + 上门 doorCount 个 = 2*doorCount 个 Mesh
  - 门 Z 位置 = 柜体正面(见"坐标系"节)
  - 返回 group,userData.kind='doors'

- `createDividerGroup(THREE, totalWidth: number, totalHeight: number, sizeAndX, dividerGeometry) -> Group`
  - 隔板数 = doorCount - 1
  - 每块隔板 X = xOffsets[i+1] - GAP/2 (两扇门中缝对齐)
  - 分上下两段:下段高 850,上段高 upperH
  - 藏在门后 Z=-18(相对门板 z 偏移 -18)
  - 返回 group,userData.kind='dividers'

- `createShelfGroup(THREE, totalWidth: number, totalHeight: number, shelfGeometry) -> Group`
  - 下柜:固定 3 块层板,把 850-18*2=814mm 内空 4 等分,层板 Y 分别在 152 + 814*[0.25, 0.5, 0.75] 处
  - 上柜:upperH ≤ 800 → 1 块层板(居中);> 800 → 2 块层板(3 等分)
  - 层板 X 铺满内宽 (totalWidth - 36),Z 藏在门后 -18
  - 返回 group,userData.kind='shelves'

- `generateCabinetDynamicParts(THREE, totalWidth: number, totalHeight: number, geometries) -> { root: Group, shell: Group, doors: Group, dividers: Group, shelves: Group }`
  - geometries = { doorGeometry, shelfGeometry, dividerGeometry }
  - shell 目前留空 Group(壳由 three-renderer 拉伸 GLB 提供);占位便于后续替换成纯代码壳
  - root 包含 doors, dividers, shelves

- `clearOldParts(root: Group) -> void`
  - 递归 traverse,对每个 Mesh: dispose geometry (若被 root 独占)、清空 material 引用
  - 从 parent remove 每个 child
  - 不处理材质(材质在 renderer 管)

**基准 geometry 由调用方注入**(测试可以 mock,renderer 在 init 时用 THREE.BoxGeometry 创建一次并缓存)。

### `miniprogram/utils/cabinet-rules.js`(扩展)

```js
const WALL_LIMIT = { wMin: 44, wMax: 1000, hMin: 232, hMax: 1000 };
const WALL_LIMIT_SHOE = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 };
const MODE = { WARDROBE: 'wardrobe', SHOE: 'shoe' };

function validateWall(width, height, mode) {
  const limit = mode === MODE.SHOE ? WALL_LIMIT_SHOE : WALL_LIMIT;
  // 其余同旧实现,消息里用 limit.wMin / wMax / hMin / hMax
}
```

`validateWall` 无 mode 参数时默认走衣柜 limit(保留向后兼容,老测试不必改)。

### `miniprogram/pages/plan-list/index.js`

```js
onTapStart() {
  // 上限检查照旧
  wx.showActionSheet({
    itemList: ['衣柜', '鞋柜'],
    success: (res) => {
      const mode = res.tapIndex === 0 ? 'wardrobe' : 'shoe';
      getApp().globalData.draftPlan = { mode };
      wx.navigateTo({ url: '/pages/space-setup/index' });
    },
  });
}
```

### `miniprogram/pages/space-setup/index.js` + `.wxml`

- `onLoad` 读 `draft.mode`,`setData({ mode })`
- data 里增加 `wallLimits`,按 mode 从 rules 里取,用于 placeholder 文本
- `validate()` 里 `rules.validateWall(w, h, this.data.mode)`
- 鞋柜模式:跳过 `validateCorner` 与 `computeStandardRange` 校验(不适用),`draft.cornerType` 直接强制 `'WZJ'`
- `onConfirm` 里 `plan = { ..., mode: this.data.mode, cornerType: mode==='shoe' ? 'WZJ' : cornerType }`

wxml:
- input placeholder 用 `{{wallLimits.wMin}}~{{wallLimits.wMax}} cm`
- 转角块用 `wx:if="{{mode !== 'shoe'}}"` 隐藏

### `miniprogram/cabinet/pages/design/index.js` + `.wxml`

- `onLoad` 里读 `plan.mode`:
  - `mode === 'shoe'`:跳过 `layoutEngine.init`,直接构造 `this._state = { items: [{ id, kind:'shoe', w: plan.wall.w, h: plan.wall.h }], meta: { isFull: true, standardWidth: 0, standardUsed: 0, nonStandardWidth: 0, wall: plan.wall, hasRaise: false, cornerType: 'WZJ', color: 'white' } }`
  - modelList = `[{ name: '150S.glb', kind: 'shoe', code: 's', descText: '鞋柜' }]`
  - `sizeTab = 150`
  - `show50 = false, show100 = false, show150 = true`
- `recompute` 里对 `mode === 'shoe'` 跳过 `layoutEngine.applyColor` 之外的调用
- `onSwitchSize / onPickModel / onNext / onPrev`:
  - shoe 模式下 `onSwitchSize` no-op(只有一个 tab)
  - shoe 模式下 `onPickModel` no-op(只有一个卡)
  - shoe 模式下 `onNext` 直接调 `onConfirmLayout`
  - shoe 模式下 `onPrev` 隐藏(wxml 里 `wx:if`)
- `nextBtnText` shoe 模式恒为 `'确认布局'`

wxml:
- `.raise-row` 加 `wx:if="{{mode !== 'shoe'}}"`
- "上一模块" 按钮加 `wx:if="{{mode !== 'shoe'}}"`
- picker tabs 三个 view 保留原 `wx:if`(mode=shoe 时会因 show50/100=false 自然隐藏,150 显示)

### `miniprogram/cabinet/utils/three-renderer.js`(新增分支)

在现有 `_loadItemMesh` 或 `_placeRow` 里增加分支:

```js
if (it.kind === 'shoe') {
  const shoeParts = require('./shoe-cabinet-parts.js');
  const gltfRoot = await this._loadGlb('150cm/150S.glb'); // 复用现有 loader
  // 剔除动态部件 (代码生成会补回)
  const toRemove = [];
  gltfRoot.traverse((node) => {
    if (!node.isMesh) return;
    const name = (node.name || '').toLowerCase();
    if (/(^|[^a-z])door([^a-z]|$)/.test(name)) toRemove.push(node);
    else if (name.indexOf('shelf') >= 0) toRemove.push(node);
    else if (name.indexOf('vertical') >= 0 || name.indexOf('divider') >= 0 || name.indexOf('中隔') >= 0) toRemove.push(node);
  });
  toRemove.forEach((n) => n.parent && n.parent.remove(n));
  // 拉伸壳
  const bbox = new THREE.Box3().setFromObject(gltfRoot);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const targetWmm = it.w * 10;
  const targetHmm = it.h * 10;
  const kScene = 0.1;                    // mm → cm
  const kx = targetWmm / (size.x / kScene * 1) /* 已知 GLB 单位, 见下 */;
  // 侧板保持 18mm: 拉伸整个 group X 会同时拉侧板. 方案: 保留整体 XY 独立拉伸,
  // 门/隔/层已剔除, 剩下的 side/back/counter/skirt 里的侧板是"两端各 18mm 厚"的板,
  // 拉伸整体 X 会让它们变厚 → 需要额外把侧板单独 scale.x=1/kx 反向补偿.
  //
  // 判定侧板: bbox.min.x < 阈值 或 bbox.max.x > 阈值 (即 X 位于两端).
  // 见 renderer 实现细节.
  ...
  // 追加代码生成部件
  const geometries = this._ensureShoeGeometries();
  const parts = shoeParts.generateCabinetDynamicParts(THREE, targetWmm, targetHmm, geometries);
  parts.root.scale.set(kScene, kScene, kScene);
  gltfRoot.add(parts.root);
  return gltfRoot;
}
```

**关键点(留给实现阶段细化):**
- **单位**:150S.glb 里 1 单位是什么(m/cm/mm)未知,现有 `_placeRow` 用 `it.w/size.x` 反推 k。鞋柜路径继续用这个反推方式,与旧 shoe 路径行为一致(three-renderer.js:1362-1367)。
- **侧板不缩放**:GLB 里侧板是"X 位置在两端的 board"。整体 group 按 kx 缩放后侧板会变厚,需要遍历所有 Mesh:凡是 bbox.min.x 或 bbox.max.x 落在整体两端 18/GLB单位 范围内的 Mesh,单独 scale.x = 1/kx 抵消。**这块在实现阶段用 renderer 单测验证**(需要用真实 150S.glb 跑一次)。
- **基准 geometry 缓存**:renderer 首次进入 shoe 分支时创建 `_shoeGeometries = { doorGeometry: new BoxGeometry(450, 846, 18), shelfGeometry: new BoxGeometry(1, 1, 1), dividerGeometry: new BoxGeometry(1, 1, 1) }`(shelf/divider 由 shoe-cabinet-parts 拿去按 mm 尺寸 scale)。dispose 在 `dispose()` 时统一。

### 坐标系约定(mm)

以柜体左底后为原点:
- X:0 → totalWidth (向右)
- Y:0 → totalHeight (向上)就绪
- Z:0 → -400 (向后)。柜体正面 Z=0,背板 Z=-400 - 18(靠背)

门板 Z 位置:柜体正面外侧,Z 中心 = 门厚/2 = 9(门在柜体正面外)。**GLB 壳的正面本身在哪里由 GLB 决定**,实现阶段可能需要把 shoe-cainet-parts 的 root 沿 Z 平移对齐。

**Mesh 位置约定**:shoe-cabinet-parts 生成的所有 Mesh 用 Three.js 默认约定,`mesh.position` 是几何体中心。所以门 mesh.position.x = `xOffsets[i] + doorWidths[i]/2`,mesh.position.y = 门 Y 底 + 门高/2 = `152 + 846/2 = 575`(下门)/`1502 + upperDoorH/2`(上门)。这里的 xOffsets 和 doorWidths 都由 `calcDoorSizeAndX` 输出,单位 mm。

## 数据流(用户操作)

1. 用户点 plan-list 的 "+ 开始新设计"
2. `wx.showActionSheet` 弹出 → 选"鞋柜" → `draftPlan = { mode: 'shoe' }`
3. 跳 space-setup:填墙名/墙宽/墙高,墙宽 placeholder 显示 `80~300 cm`,墙高 `220~270 cm`,转角块不显示
4. 点确认:`plan = { mode:'shoe', wall: {w,h,d:150}, cornerType:'WZJ', ... }` 存 draftPlan,跳 design 页
5. design 页:onLoad 读 mode=shoe,构造 shoe 单件 state,直接渲染
6. three-renderer 收到 items=[{ kind:'shoe', w:250, h:250 }] → 加载 150S.glb → 剔除动态部件 → 拉伸壳 → 追加代码生成的门/隔/层 → 材质
7. 用户切颜色/切显示门板/点确认布局 → 走现有 recompute/onConfirmLayout 流程

## 错误处理

- **150S.glb 云端不存在或下载失败**:renderer 的 `_loadGlb` 已经有 fallback(用 BoxGeometry 兜底)。鞋柜路径也走 fallback,场景显示一个纯白盒子,同时 console.warn `[shoe] 150S.glb 缺失, 退回 fallback`。这种情况下代码生成的门/隔/层仍会追加,视觉上是"盒子上贴了门"。
- **shoe-cabinet-parts.generateCabinetDynamicParts 内部计算异常**(理论上不应发生,输入已在 rules 校验区间):catch 后 console.warn,返回空 Group,不阻塞渲染。
- **space-setup 墙尺寸超区间**:`validateWall(w, h, 'shoe')` 返回 `{ ok:false, message:'墙体宽度需在 80cm ~ 300cm 之间' }`,复用现有 errorMsg 展示。
- **layoutEngine 收到 kind='shoe' 的 item**:layoutEngine 只在衣柜 mode 被调用,shoe mode 完全跳过。为防御未来误调用,在 layoutEngine.addNext / replaceLast / removeLast 首行判断 `if (state.items[0]?.kind === 'shoe') return { ok: false, message: 'shoe mode 不支持排队式操作' };`

## 单元测试

`tests/shoe-cabinet-parts.test.js`(node 环境,mock THREE 只提供 Mesh/Group/BoxGeometry):

**纯计算**
- `getDoorCount`:800→2 / 1100→2 / 1101→3 / 1600→3 / 1601→4 / 2100→4 / 2101→5 / 2600→5 / 2601→6 / 3000→6;边界外(799 钳到 800,3001 钳到 3000)
- `calcDoorSizeAndX`:
  - (1500, 3):内宽=1464,总缝=8,base=485,余=1,doorWidths=[485,485,486],xOffsets=[20,507,994]
  - (1101, 3):内宽=1065,总缝=8,base=352,余=1,doorWidths=[352,352,353],xOffsets=[20,374,728]
  - (800, 2):内宽=764,总缝=6,base=379,余=0,doorWidths=[379,379],xOffsets=[20,401]
  - (3000, 6):内宽=2964,总缝=14,base=Math.floor((2964-14)/6)=491,余=2950-491*6=4,doorWidths=[491,491,491,491,491,495]
- `createDoorGroup`:输入 (1500,2400,sizeAndX),返回 group.children 数 = 6(2×3);验证下门 Y 底=152、上门 Y 底=1502;验证第 1 扇门 mesh.position.x = xOffset + doorW/2
- `createDividerGroup`:门数 3 → 隔板数 2;每块位置 = 中缝中心
- `createShelfGroup`:
  - upperH=900 (totalH=2400):上柜 2 块,下柜 3 块
  - upperH=700 (totalH=2200):上柜 1 块,下柜 3 块
  - 层板 X 尺寸 = totalWidth - 36
- `generateCabinetDynamicParts`:返回 root 包含 doors + dividers + shelves 三 group
- `clearOldParts`:root 内所有 Mesh 从 parent 移除,dispose 调用次数正确

**边界**
- `getDoorCount` 输入非数字/负数 → 钳到 800(用 Math.min/max)
- `calcDoorSizeAndX` 余量为 0 → 所有门宽相等

`tests/cabinet-rules.test.js`(若已存在则扩展,否则新建):
- `validateWall(80, 220, 'shoe')` → ok
- `validateWall(79, 220, 'shoe')` → 报错含 "80cm"
- `validateWall(300, 270, 'shoe')` → ok
- `validateWall(301, 220, 'shoe')` → 报错含 "300cm"
- `validateWall(80, 219, 'shoe')` → 报错含 "220cm"
- `validateWall(80, 271, 'shoe')` → 报错含 "270cm"
- `validateWall(44, 232, 'wardrobe')` → ok (老行为)
- `validateWall(44, 232)` → ok (无 mode 默认 wardrobe)

## 分阶段落地

1. **Rules + tests**:cabinet-rules.js 增 shoe limit;写 rules 单测。低风险,与 UI 解耦。
2. **shoe-cabinet-parts.js + tests**:纯几何+计算,单测覆盖。Node 环境即可跑通。
3. **plan-list 入口**:onTapStart 改 showActionSheet,存 mode。
4. **space-setup 分支**:按 mode 切 placeholder / 隐藏转角 / 传 mode 给 validate。
5. **design 页分支**:按 mode 构造 state、隐藏加高、隐藏上一模块、picker 只显示 150 tab。
6. **three-renderer 分支**:kind='shoe' 时加载 150S.glb → 剔除 → 拉伸 → 追加。
7. **联调**:模拟器跑完整流程;真机验证墙 250×240 / 300×270 / 100×220 三档尺寸。

每个阶段独立可跑,如果 6 遇到 150S.glb 缺失,前 5 步已经能让入口和参数化生成部分先跑通(壳走 fallback)。

## 风险

- **150S.glb 内部命名不遵循 glb-metadata 约定**:若真名字都是 Cube.001 类,traverse 剔除会失败(该剔的没剔、不该剔的剔掉)。**缓解**:阶段 6 联调时,先在 renderer 里加一次 `console.log('[shoe] mesh names:', names.join(','))`,人工核对一次;若真不符,回退到"整个 GLB 隐藏,只保留代码生成部件"的降级方案。
- **侧板缩放补偿**:如果 GLB 里"侧板"不是位于两端的独立 Mesh(比如整个柜体是单个大 Mesh),bbox 检测会失效。**缓解**:同上,联调时打日志核对;不符时侧板改为纯代码生成(shoe-cabinet-parts.shell 补一个 side panel group 就行)。
- **plan 数据结构增加 mode 字段影响云端序列化 / 历史方案回读**:老的 plan 记录没有 mode 字段。**缓解**:所有读取处 `plan.mode || 'wardrobe'`,老方案自动当衣柜。
