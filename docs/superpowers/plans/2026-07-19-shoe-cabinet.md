# 鞋柜功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小程序内新增独立的鞋柜设计模式,与衣柜在入口分岔;鞋柜复用 space-setup 和 design 两个页面,墙面尺寸区间收紧,3D 场景里放一个占满整墙的参数化鞋柜(门/隔板/层板按 totalWidth/totalHeight 参数化生成)。

**Architecture:** 入口 `plan-list` 弹 ActionSheet 选衣柜/鞋柜,写入 `draftPlan.mode`;`space-setup` 和 `cabinet/pages/design` 两页按 `mode` 分支切换 UI 和数据流。150S.glb 内部节点命名规范完备(有 `side_/back_/countertop_/baseboard_/door_sample/shelf_sample/mid_panel_sample`),加载后提取三个 `_sample` geometry 作模板、剔除所有具体门/隔/层节点,拉伸剩余壳,再用 `shoe-cabinet-parts.js` 参数化生成正确数量的门/隔/层追加。

**Tech Stack:** 微信小程序(JS), Three.js(threejs-miniprogram), node:test(单测), 现有 model-sync / cabinet-rules / layout-engine / three-renderer 管线。

**Design Spec:** `docs/superpowers/specs/2026-07-19-shoe-cabinet-design.md`

**150S.glb 已存在于:** `tests/150S.glb`(54KB),节点命名清单参见 spec 与 Task 5。

---

## File Structure

**新增文件:**
- `miniprogram/cabinet/utils/shoe-cabinet-parts.js` — 参数化门/隔板/层板生成 + 清理(纯 mm 单位,注入 THREE)
- `tests/shoe-cabinet-parts.test.js` — 上述模块单测
- `tests/cabinet-rules.test.js` — cabinet-rules 单测(若已存在则扩展)

**修改文件:**
- `miniprogram/utils/cabinet-rules.js` — 增 `WALL_LIMIT_SHOE`, `MODE`, `validateWall(w, h, mode)` 支持 mode 参数
- `miniprogram/pages/plan-list/index.js` — `onTapStart` 改成弹 ActionSheet
- `miniprogram/pages/space-setup/index.js` + `.wxml` + `.wxss` — 按 mode 切 placeholder / 隐藏转角块 / 传 mode 给校验
- `miniprogram/cabinet/pages/design/index.js` + `.wxml` — 按 `plan.mode` 分支:shoe 时 modelList/state/UI 全部改造
- `miniprogram/cabinet/utils/three-renderer.js` — 新增 `kind === 'shoe'` 分支:加载 150S.glb → 剔除 → 拉伸壳 → 追加代码生成部件

---

## Task 1: 扩展 cabinet-rules(mode + 鞋柜 wall limit)

**Files:**
- Modify: `miniprogram/utils/cabinet-rules.js`
- Create/扩展: `tests/cabinet-rules.test.js`

- [ ] **Step 1: 检查 tests/cabinet-rules.test.js 是否存在**

Run: `ls "D:/工程/柠檬塔/程序/LemonTA-minor/tests/cabinet-rules.test.js" 2>&1`

如果不存在(输出 "No such file"),按 Step 2 建;如果存在,按 Step 2 内容 append。

- [ ] **Step 2: 写 shoe mode 的失败测试**

Create/append 到 `tests/cabinet-rules.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../miniprogram/utils/cabinet-rules.js');

test('validateWall wardrobe: 兼容旧行为(无 mode 参数)', () => {
  assert.equal(rules.validateWall(44, 232).ok, true);
  assert.equal(rules.validateWall(1000, 1000).ok, true);
  assert.equal(rules.validateWall(43, 232).ok, false);
  assert.equal(rules.validateWall(44, 231).ok, false);
});

test('validateWall shoe: 边界内 ok', () => {
  assert.equal(rules.validateWall(80, 220, 'shoe').ok, true);
  assert.equal(rules.validateWall(300, 270, 'shoe').ok, true);
  assert.equal(rules.validateWall(150, 240, 'shoe').ok, true);
});

test('validateWall shoe: 宽度低于 80 报错', () => {
  const r = rules.validateWall(79, 240, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /80cm/);
});

test('validateWall shoe: 宽度高于 300 报错', () => {
  const r = rules.validateWall(301, 240, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /300cm/);
});

test('validateWall shoe: 高度低于 220 报错', () => {
  const r = rules.validateWall(150, 219, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /220cm/);
});

test('validateWall shoe: 高度高于 270 报错', () => {
  const r = rules.validateWall(150, 271, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /270cm/);
});

test('MODE 常量导出', () => {
  assert.equal(rules.MODE.WARDROBE, 'wardrobe');
  assert.equal(rules.MODE.SHOE, 'shoe');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run(在项目根目录):
```
node --test tests/cabinet-rules.test.js
```

Expected: 6 个 shoe 测试 fail(validateWall 不接受 mode 参数,MODE 未导出)。

- [ ] **Step 4: 修改 cabinet-rules.js 实现 mode 支持**

Edit `miniprogram/utils/cabinet-rules.js`:

在 `WALL_LIMIT` 常量后加:
```js
const WALL_LIMIT_SHOE = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 };
const MODE = { WARDROBE: 'wardrobe', SHOE: 'shoe' };
```

替换 `validateWall`:
```js
function validateWall(width, height, mode) {
  const limit = mode === MODE.SHOE ? WALL_LIMIT_SHOE : WALL_LIMIT;
  if (!isPositiveInt(width) || !isPositiveInt(height)) {
    return { ok: false, message: '墙体尺寸需为正整数' };
  }
  if (width < limit.wMin || width > limit.wMax) {
    return {
      ok: false,
      message: `墙体宽度需在 ${limit.wMin}cm ~ ${limit.wMax}cm 之间`,
    };
  }
  if (height < limit.hMin || height > limit.hMax) {
    return {
      ok: false,
      message: `墙体高度需在 ${limit.hMin}cm ~ ${limit.hMax}cm 之间`,
    };
  }
  return { ok: true };
}
```

在 `module.exports` 里增加 `MODE`, `WALL_LIMIT_SHOE`:
```js
module.exports = {
  CORNER,
  MODE,
  WALL_LIMIT,
  WALL_LIMIT_SHOE,
  validateName,
  validateWall,
  validateCorner,
  validateRaise,
  cornerCount,
  computeStandardRange,
  computeNonStandardWidth,
};
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/cabinet-rules.test.js`

Expected: 全部 pass。

- [ ] **Step 6: Commit**

```
git add miniprogram/utils/cabinet-rules.js tests/cabinet-rules.test.js
git commit -m "feat(rules): 增加鞋柜模式墙面尺寸限制 80-300 / 220-270"
```

---

## Task 2: shoe-cabinet-parts 常量与门数计算

**Files:**
- Create: `miniprogram/cabinet/utils/shoe-cabinet-parts.js`
- Create: `tests/shoe-cabinet-parts.test.js`

- [ ] **Step 1: 写 getDoorCount 失败测试**

Create `tests/shoe-cabinet-parts.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const parts = require('../miniprogram/cabinet/utils/shoe-cabinet-parts.js');

test('getDoorCount: 区间边界', () => {
  assert.equal(parts.getDoorCount(800), 2);
  assert.equal(parts.getDoorCount(1100), 2);
  assert.equal(parts.getDoorCount(1101), 3);
  assert.equal(parts.getDoorCount(1600), 3);
  assert.equal(parts.getDoorCount(1601), 4);
  assert.equal(parts.getDoorCount(2100), 4);
  assert.equal(parts.getDoorCount(2101), 5);
  assert.equal(parts.getDoorCount(2600), 5);
  assert.equal(parts.getDoorCount(2601), 6);
  assert.equal(parts.getDoorCount(3000), 6);
});

test('getDoorCount: 边界外钳制', () => {
  assert.equal(parts.getDoorCount(799), 2);
  assert.equal(parts.getDoorCount(3001), 6);
  assert.equal(parts.getDoorCount(0), 2);
  assert.equal(parts.getDoorCount(-5), 2);
});

test('常量导出', () => {
  assert.equal(parts.SIDE_PANEL_THICK, 18);
  assert.equal(parts.GAP, 2);
  assert.equal(parts.LOWER_CABINET_H, 850);
  assert.equal(parts.SKIRT_H, 150);
  assert.equal(parts.COUNTER_THICK, 50);
  assert.equal(parts.VOID_H, 450);
  assert.equal(parts.FIXED_H, 1500);
  assert.equal(parts.DEPTH_TOTAL, 400);
  assert.equal(parts.DEPTH_INNER, 364);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: Cannot find module 错误(文件还没建)。

- [ ] **Step 3: 建 shoe-cabinet-parts.js 初版**

Create `miniprogram/cabinet/utils/shoe-cabinet-parts.js`:

```js
// 鞋柜参数化几何生成器。所有尺寸单位 mm。
// 依赖注入 THREE 便于 Node 测试环境 mock。
// 生成的 Group 由调用方 (three-renderer) 缩放到场景 cm 单位。

const SIDE_PANEL_THICK = 18;
const GAP = 2;
const LOWER_CABINET_H = 850;
const SKIRT_H = 150;
const COUNTER_THICK = 50;
const VOID_H = 450;
const FIXED_H = SKIRT_H + LOWER_CABINET_H + COUNTER_THICK + VOID_H; // 1500
const DEPTH_TOTAL = 400;
const DEPTH_INNER = 364;

const WIDTH_MIN = 800;
const WIDTH_MAX = 3000;

function _clampW(w) {
  if (typeof w !== 'number' || !isFinite(w)) return WIDTH_MIN;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, w));
}

// 硬编码区间匹配。临界值严格:1100=2, 1101=3
function getDoorCount(totalWidth) {
  const w = _clampW(totalWidth);
  if (w <= 1100) return 2;
  if (w <= 1600) return 3;
  if (w <= 2100) return 4;
  if (w <= 2600) return 5;
  return 6;
}

module.exports = {
  SIDE_PANEL_THICK,
  GAP,
  LOWER_CABINET_H,
  SKIRT_H,
  COUNTER_THICK,
  VOID_H,
  FIXED_H,
  DEPTH_TOTAL,
  DEPTH_INNER,
  getDoorCount,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: 3 个测试全 pass。

- [ ] **Step 5: Commit**

```
git add miniprogram/cabinet/utils/shoe-cabinet-parts.js tests/shoe-cabinet-parts.test.js
git commit -m "feat(shoe): 鞋柜常量与门数计算(区间 800~3000)"
```

---

## Task 3: 门宽均分 + X 偏移计算

**Files:**
- Modify: `miniprogram/cabinet/utils/shoe-cabinet-parts.js`
- Modify: `tests/shoe-cabinet-parts.test.js`

- [ ] **Step 1: 写 calcDoorSizeAndX 失败测试**

Append 到 `tests/shoe-cabinet-parts.test.js`:

```js
test('calcDoorSizeAndX (1500, 3): 内宽=1464,均分 485,余 1 补最后', () => {
  const r = parts.calcDoorSizeAndX(1500, 3);
  assert.deepEqual(r.doorWidths, [485, 485, 486]);
  assert.deepEqual(r.xOffsets, [20, 507, 994]);
});

test('calcDoorSizeAndX (1101, 3): 内宽=1065,均分 352,余 1 补最后', () => {
  const r = parts.calcDoorSizeAndX(1101, 3);
  assert.deepEqual(r.doorWidths, [352, 352, 353]);
  assert.deepEqual(r.xOffsets, [20, 374, 728]);
});

test('calcDoorSizeAndX (800, 2): 均分完整无余', () => {
  const r = parts.calcDoorSizeAndX(800, 2);
  assert.deepEqual(r.doorWidths, [379, 379]);
  assert.deepEqual(r.xOffsets, [20, 401]);
});

test('calcDoorSizeAndX (3000, 6)', () => {
  const r = parts.calcDoorSizeAndX(3000, 6);
  assert.deepEqual(r.doorWidths, [491, 491, 491, 491, 491, 495]);
  assert.deepEqual(r.xOffsets, [20, 513, 1006, 1499, 1992, 2485]);
});

test('calcDoorSizeAndX 边缝严格 2mm: 内宽 = 侧板*2 + xOffset[0]-侧板 = SIDE + GAP', () => {
  const r = parts.calcDoorSizeAndX(1500, 3);
  const first = r.xOffsets[0];
  assert.equal(first, parts.SIDE_PANEL_THICK + parts.GAP);
  const last = r.xOffsets[r.xOffsets.length - 1] + r.doorWidths[r.doorWidths.length - 1];
  assert.equal(1500 - last, parts.SIDE_PANEL_THICK + parts.GAP);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: 5 个新测试 fail(函数未定义)。

- [ ] **Step 3: 实现 calcDoorSizeAndX**

在 `shoe-cabinet-parts.js` 中,`getDoorCount` 后加:

```js
// 输入 totalWidth (mm), doorCount, 输出 doorWidths[] 与 xOffsets[]
// 内宽 = totalWidth - SIDE_PANEL_THICK*2
// 总缝 = GAP * (doorCount + 1)
// baseW = floor((内宽 - 总缝) / doorCount)
// 余量 = 内宽 - 总缝 - baseW*doorCount, 全部加到最后一扇
// xOffsets[0] = SIDE_PANEL_THICK + GAP
// xOffsets[i] = xOffsets[i-1] + doorWidths[i-1] + GAP
function calcDoorSizeAndX(totalWidth, doorCount) {
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const totalGap = GAP * (doorCount + 1);
  const usable = innerW - totalGap;
  const baseW = Math.floor(usable / doorCount);
  const remainder = usable - baseW * doorCount;
  const doorWidths = new Array(doorCount).fill(baseW);
  doorWidths[doorCount - 1] += remainder;
  const xOffsets = [];
  let cursor = SIDE_PANEL_THICK + GAP;
  for (let i = 0; i < doorCount; i++) {
    xOffsets.push(cursor);
    cursor += doorWidths[i] + GAP;
  }
  return { doorWidths, xOffsets };
}
```

在 module.exports 里加 `calcDoorSizeAndX`。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: 全部 pass。

- [ ] **Step 5: Commit**

```
git add miniprogram/cabinet/utils/shoe-cabinet-parts.js tests/shoe-cabinet-parts.test.js
git commit -m "feat(shoe): 门宽均分算法(余量补末扇, 边缝严格 2mm)"
```

---

## Task 4: 门 / 隔板 / 层板 Group 生成(mock THREE 单测)

**Files:**
- Modify: `miniprogram/cabinet/utils/shoe-cabinet-parts.js`
- Modify: `tests/shoe-cabinet-parts.test.js`

- [ ] **Step 1: 写 mock THREE 和 group 生成的失败测试**

Append 到 `tests/shoe-cabinet-parts.test.js`:

```js
// 最小 THREE mock: 只提供 Mesh/Group/BoxGeometry/Vector3
function makeThreeMock() {
  const disposed = [];
  class BoxGeometry {
    constructor(x, y, z) { this.parameters = { width: x, height: y, depth: z }; this._disposed = false; }
    clone() { const g = new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth); return g; }
    dispose() { this._disposed = true; disposed.push(this); }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material || null;
      this.position = { x: 0, y: 0, z: 0, set(x,y,z){this.x=x;this.y=y;this.z=z;} };
      this.scale = { x: 1, y: 1, z: 1, set(x,y,z){this.x=x;this.y=y;this.z=z;} };
      this.name = '';
      this.userData = {};
      this.isMesh = true;
      this.parent = null;
      this.children = [];
    }
    add(child) { child.parent = this; this.children.push(child); }
    remove(child) { const i = this.children.indexOf(child); if (i>=0) { this.children.splice(i,1); child.parent = null; } }
    traverse(cb) { cb(this); this.children.forEach((c) => c.traverse && c.traverse(cb)); }
  }
  class Group extends Mesh {
    constructor() { super(null, null); this.isGroup = true; this.isMesh = false; }
  }
  return { THREE: { Mesh, Group, BoxGeometry }, disposed };
}

// 基准 geometry: 与 GLB 中 door_sample 尺寸约定 450 × 846 × 18
function makeGeometries(THREE) {
  return {
    doorGeometry: new THREE.BoxGeometry(450, 846, 18),
    shelfGeometry: new THREE.BoxGeometry(1, 1, 1),
    dividerGeometry: new THREE.BoxGeometry(1, 1, 1),
  };
}

test('createDoorGroup: 1500×2400 3扇 → 下门 3 + 上门 3 = 6 Mesh', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDoorGroup(THREE, 1500, 2400, sizeAndX, geos.doorGeometry);
  assert.equal(g.children.length, 6);
  // 下门 Y 底 = 152, Y 中心 = 152 + 846/2 = 575
  const lowerYCenter = 152 + 846 / 2;
  // 上门高 = totalH - FIXED_H - 4 = 2400 - 1500 - 4 = 896, Y 底 = 1502, Y 中心 = 1502 + 896/2 = 1950
  const upperH = 2400 - 1500 - 2 * 2;
  const upperYCenter = 1502 + upperH / 2;
  const lowerDoors = g.children.filter((m) => m.userData.role === 'lower');
  const upperDoors = g.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lowerDoors.length, 3);
  assert.equal(upperDoors.length, 3);
  lowerDoors.forEach((m) => assert.equal(Math.round(m.position.y), lowerYCenter));
  upperDoors.forEach((m) => assert.equal(Math.round(m.position.y), upperYCenter));
  // 第 1 扇下门 X 中心 = xOffsets[0] + doorWidths[0]/2 = 20 + 485/2 = 262.5
  const first = lowerDoors[0];
  assert.equal(first.position.x, sizeAndX.xOffsets[0] + sizeAndX.doorWidths[0] / 2);
});

test('createDoorGroup: 上下门 X 完全对齐', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDoorGroup(THREE, 1500, 2400, sizeAndX, geos.doorGeometry);
  const lower = g.children.filter((m) => m.userData.role === 'lower').map((m) => m.position.x);
  const upper = g.children.filter((m) => m.userData.role === 'upper').map((m) => m.position.x);
  assert.deepEqual(lower, upper);
});

test('createDividerGroup: 3 门 → 2 隔板, 每块分上下 = 4 Mesh', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDividerGroup(THREE, 1500, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 4);
  // 每块隔板 X = 相邻两门中缝中心 = xOffsets[i+1] - GAP/2
  const lowerDividers = g.children.filter((m) => m.userData.role === 'lower');
  assert.equal(lowerDividers.length, 2);
  assert.equal(lowerDividers[0].position.x, sizeAndX.xOffsets[1] - parts.GAP / 2);
});

test('createShelfGroup: 上柜高 900 (totalH=2400) → 下柜 3 + 上柜 2 = 5 Mesh', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createShelfGroup(THREE, 1500, 2400, geos.shelfGeometry);
  const lower = g.children.filter((m) => m.userData.role === 'lower');
  const upper = g.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lower.length, 3);
  assert.equal(upper.length, 2);
});

test('createShelfGroup: 上柜高 700 (totalH=2200) → 上柜 1 层板', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createShelfGroup(THREE, 1500, 2200, geos.shelfGeometry);
  const upper = g.children.filter((m) => m.userData.role === 'upper');
  assert.equal(upper.length, 1);
});

test('generateCabinetDynamicParts: 组合 3 个 group', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos);
  assert.equal(r.root.children.length, 3);
  assert.ok(r.doors);
  assert.ok(r.dividers);
  assert.ok(r.shelves);
});

test('clearOldParts: 递归 dispose + 从 parent 移除', () => {
  const { THREE, disposed } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos);
  const meshCount = r.root.children.reduce((s, g) => s + g.children.length, 0);
  parts.clearOldParts(r.root);
  assert.equal(r.root.children.length, 0);
  assert.equal(disposed.length, meshCount);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: 7 个新测试 fail(函数未定义)。

- [ ] **Step 3: 实现 4 个 group 生成函数**

在 `shoe-cabinet-parts.js` 中,`calcDoorSizeAndX` 后加:

```js
// 内部工具:克隆基准 geometry, 用 scale 调到目标尺寸
function _cloneScaledMesh(THREE, baseGeometry, baseW, baseH, baseD, w, h, d) {
  const mesh = new THREE.Mesh(baseGeometry, null);
  mesh.scale.set(w / baseW, h / baseH, d / baseD);
  return mesh;
}

// 门 group: 下门 + 上门, 每扇独立 Mesh, 位置为几何中心 (Three.js 约定)
// baseGeometry 尺寸约定 450 × 846 × 18 (来自 GLB door_sample)
function createDoorGroup(THREE, totalWidth, totalHeight, sizeAndX, doorGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'doors' };
  const upperH = totalHeight - FIXED_H;
  const lowerDoorH = LOWER_CABINET_H - GAP * 2; // 846
  const upperDoorH = upperH - GAP * 2;
  const lowerYBottom = SKIRT_H + GAP; // 152
  const upperYBottom = FIXED_H + GAP; // 1502
  // 门 Z 中心: 柜体正面外, Z 中心 = 门厚/2 = 9
  const doorZ = 9;
  sizeAndX.xOffsets.forEach((xOff, i) => {
    const w = sizeAndX.doorWidths[i];
    // 下门
    const lower = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, lowerDoorH, 18);
    lower.position.set(xOff + w / 2, lowerYBottom + lowerDoorH / 2, doorZ);
    lower.userData = { role: 'lower', index: i };
    lower.name = `lower_door_${i + 1}`;
    group.add(lower);
    // 上门 (X 与下门一致)
    const upper = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, upperDoorH, 18);
    upper.position.set(xOff + w / 2, upperYBottom + upperDoorH / 2, doorZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `upper_door_${i + 1}`;
    group.add(upper);
  });
  return group;
}

// 中隔板 group: 每两扇门之间 1 块, 分上下段
// 隔板 X 中心 = xOffsets[i+1] - GAP/2 (中缝中央)
// 隔板厚 18, 深 DEPTH_INNER (364), Z 藏在门后 -18
function createDividerGroup(THREE, totalWidth, totalHeight, sizeAndX, dividerGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'dividers' };
  const upperH = totalHeight - FIXED_H;
  const lowerYBottom = SKIRT_H + GAP;
  const upperYBottom = FIXED_H + GAP;
  const lowerH = LOWER_CABINET_H;
  const doorCount = sizeAndX.doorWidths.length;
  const dividerZ = -18;
  for (let i = 0; i < doorCount - 1; i++) {
    const xCenter = sizeAndX.xOffsets[i + 1] - GAP / 2;
    const lower = new THREE.Mesh(dividerGeometry, null);
    lower.scale.set(18, lowerH, DEPTH_INNER);
    lower.position.set(xCenter, lowerYBottom + lowerH / 2 - GAP, dividerZ);
    lower.userData = { role: 'lower', index: i };
    lower.name = `mid_divider_lower_${i + 1}`;
    group.add(lower);
    const upper = new THREE.Mesh(dividerGeometry, null);
    upper.scale.set(18, upperH, DEPTH_INNER);
    upper.position.set(xCenter, upperYBottom + upperH / 2 - GAP, dividerZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `mid_divider_upper_${i + 1}`;
    group.add(upper);
  }
  return group;
}

// 层板 group:
// - 下柜固定 3 层, 内空 = LOWER_CABINET_H - 18*2 = 814, 4 等分, Y = 底板顶(SKIRT_H+18) + 814*[0.25, 0.5, 0.75]
// - 上柜: upperH ≤ 800 → 1 层居中; > 800 → 2 层 3 等分
// - 层板宽度 = totalWidth - SIDE_PANEL_THICK*2, 厚 18, 深 DEPTH_INNER, Z = -18
function createShelfGroup(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'shelves' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const shelfZ = -18;
  // 下柜
  const lowerFloorTop = SKIRT_H + 18; // 168, 下柜底板顶部
  const lowerInner = LOWER_CABINET_H - 18 * 2; // 814
  [0.25, 0.5, 0.75].forEach((frac, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, null);
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, lowerFloorTop + lowerInner * frac, shelfZ);
    mesh.userData = { role: 'lower', index: i };
    mesh.name = `shelf_lower_${i + 1}`;
    group.add(mesh);
  });
  // 上柜
  const upperH = totalHeight - FIXED_H;
  const upperFloorTop = FIXED_H + 18;
  const upperInner = upperH - 18 * 2;
  const upperFracs = upperH <= 800 ? [0.5] : [1 / 3, 2 / 3];
  upperFracs.forEach((frac, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, null);
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, upperFloorTop + upperInner * frac, shelfZ);
    mesh.userData = { role: 'upper', index: i };
    mesh.name = `shelf_upper_${i + 1}`;
    group.add(mesh);
  });
  return group;
}

// 总入口: 组装门 + 隔板 + 层板
// geometries = { doorGeometry, shelfGeometry, dividerGeometry }
// 返回 { root: Group, doors, dividers, shelves }
function generateCabinetDynamicParts(THREE, totalWidth, totalHeight, geometries) {
  const w = _clampW(totalWidth);
  const h = totalHeight;
  const doorCount = getDoorCount(w);
  const sizeAndX = calcDoorSizeAndX(w, doorCount);
  const doors = createDoorGroup(THREE, w, h, sizeAndX, geometries.doorGeometry);
  const dividers = createDividerGroup(THREE, w, h, sizeAndX, geometries.dividerGeometry);
  const shelves = createShelfGroup(THREE, w, h, geometries.shelfGeometry);
  const root = new THREE.Group();
  root.userData = { kind: 'shoeCabinetParts', totalWidth: w, totalHeight: h };
  root.add(doors);
  root.add(dividers);
  root.add(shelves);
  return { root, doors, dividers, shelves };
}

// 递归销毁: 每个 mesh geometry dispose, 从 parent 移除
function clearOldParts(root) {
  const toRemove = [];
  root.traverse((n) => {
    if (n === root) return;
    if (n.isMesh && n.geometry && typeof n.geometry.dispose === 'function') {
      n.geometry.dispose();
    }
    toRemove.push(n);
  });
  // 从底向上移除
  while (root.children.length > 0) {
    const child = root.children[0];
    root.remove(child);
    if (child.children) child.children.length = 0;
  }
}
```

在 module.exports 里加 `createDoorGroup`, `createDividerGroup`, `createShelfGroup`, `generateCabinetDynamicParts`, `clearOldParts`。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/shoe-cabinet-parts.test.js`

Expected: 全部 pass。

- [ ] **Step 5: Commit**

```
git add miniprogram/cabinet/utils/shoe-cabinet-parts.js tests/shoe-cabinet-parts.test.js
git commit -m "feat(shoe): 门/隔板/层板 group 参数化生成 + 清理"
```

---

## Task 5: plan-list 入口 ActionSheet

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js:69-77`

- [ ] **Step 1: 替换 onTapStart**

Edit `miniprogram/pages/plan-list/index.js`,把:
```js
  onTapStart() {
    const app = getApp();
    if ((app.globalData.designs || []).length >= MAX_DESIGNS) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    app.globalData.draftPlan = null;
    wx.navigateTo({ url: '/pages/space-setup/index' });
  },
```

改为:
```js
  onTapStart() {
    const app = getApp();
    if ((app.globalData.designs || []).length >= MAX_DESIGNS) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    wx.showActionSheet({
      itemList: ['衣柜', '鞋柜'],
      success: (res) => {
        const mode = res.tapIndex === 0 ? 'wardrobe' : 'shoe';
        app.globalData.draftPlan = { mode };
        wx.navigateTo({ url: '/pages/space-setup/index' });
      },
      fail: (err) => {
        // 用户取消 (errMsg 含 cancel), 静默
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
        console.warn('[plan-list] showActionSheet fail', err);
      },
    });
  },
```

- [ ] **Step 2: 微信开发者工具中验证**

在开发者工具中:
1. 点击 "+ 开始新设计"
2. 应该看到 ActionSheet 弹起,列出"衣柜"、"鞋柜"
3. 选"衣柜" → 进入 space-setup,`console.log(getApp().globalData.draftPlan)` 应显示 `{ mode: 'wardrobe' }`
4. 返回再选"鞋柜" → 应显示 `{ mode: 'shoe' }`

- [ ] **Step 3: Commit**

```
git add miniprogram/pages/plan-list/index.js
git commit -m "feat(plan-list): 新建设计入口分衣柜/鞋柜(ActionSheet)"
```

---

## Task 6: space-setup 按 mode 分支

**Files:**
- Modify: `miniprogram/pages/space-setup/index.js`
- Modify: `miniprogram/pages/space-setup/index.wxml`

- [ ] **Step 1: 修改 space-setup index.js 支持 mode**

Edit `miniprogram/pages/space-setup/index.js`:

替换 `data`:
```js
  data: {
    photoPath: '',
    name: '',
    wallW: '',
    wallH: '',
    cornerType: 'WZJ',
    errorMsg: '',
    canSubmit: false,
    mode: 'wardrobe',
    wallHint: { w: '44 ~ 1000 cm', h: '232 ~ 1000 cm' },
    cornerOptions: [
      { id: 'WZJ',  name: '无转角' },
      { id: 'ZZJ',  name: '左转角柜' },
      { id: 'YZJ',  name: '右转角柜' },
      { id: 'ZYZJ', name: '双侧转角柜' },
    ],
  },
```

替换 `onLoad`:
```js
  onLoad() {
    require('../../utils/bootstrap.js').ensureUiDescReady();

    const draft = getApp().globalData.draftPlan;
    const mode = (draft && draft.mode) || 'wardrobe';
    const isShoe = mode === 'shoe';
    const wallHint = isShoe
      ? { w: '80 ~ 300 cm', h: '220 ~ 270 cm' }
      : { w: '44 ~ 1000 cm', h: '232 ~ 1000 cm' };
    this.setData({
      mode,
      wallHint,
      photoPath: (draft && draft.photoPath) || '',
      name: (draft && draft.name) || '',
      wallW: draft && draft.wall && draft.wall.w ? String(draft.wall.w) : '',
      wallH: draft && draft.wall && draft.wall.h ? String(draft.wall.h) : '',
      cornerType: isShoe ? 'WZJ' : ((draft && draft.cornerType) || 'WZJ'),
    });
    if (draft && draft.wall) this.validate();
  },
```

替换 `validate`:
```js
  validate() {
    const { name, wallW, wallH, cornerType, mode } = this.data;
    const w = parseInt(wallW, 10);
    const h = parseInt(wallH, 10);

    const draft = getApp().globalData.draftPlan;
    const editingId = draft && draft.id;
    const existingNames = (getApp().globalData.designs || [])
      .filter((p) => p.id !== editingId)
      .map((p) => p.name);

    let errorMsg = '';
    let ok = true;

    const nameCheck = rules.validateName(name, existingNames);
    if (!nameCheck.ok) {
      ok = false;
      errorMsg = nameCheck.message;
    }
    if (ok && wallW && wallH) {
      const wallCheck = rules.validateWall(w, h, mode);
      if (!wallCheck.ok) {
        ok = false;
        errorMsg = wallCheck.message;
      }
    }
    // 鞋柜模式跳过转角与标准段校验
    if (ok && wallW && mode !== 'shoe') {
      const cornerCheck = rules.validateCorner(w, cornerType);
      if (!cornerCheck.ok) {
        ok = false;
        errorMsg = cornerCheck.message;
      }
    }
    if (ok && wallW && mode !== 'shoe') {
      const range = rules.computeStandardRange(w, cornerType);
      if (!range.valid || range.x < 50) {
        ok = false;
        errorMsg = '当前墙体宽度不足以摆放任何标准衣柜，请调整宽度或转角设置';
      }
    }
    const required = name && wallW && wallH;
    this.setData({
      errorMsg,
      canSubmit: !!(ok && required),
    });
  },
```

替换 `onConfirm`:
```js
  onConfirm() {
    const { name, wallW, wallH, cornerType, photoPath, mode } = this.data;
    if (!this.data.canSubmit) return;
    if ((getApp().globalData.designs || []).length >= 30) {
      wx.showToast({ title: '设计库已满30条', icon: 'none' });
      return;
    }
    const draft = getApp().globalData.draftPlan || {};
    const now = new Date();
    const plan = Object.assign({}, draft, {
      id: draft.id || planStore.makeId(),
      name,
      wall: { w: parseInt(wallW, 10), h: parseInt(wallH, 10), d: 150 },
      cornerType: mode === 'shoe' ? 'WZJ' : cornerType,
      mode,
      photoPath,
      photoName: photoPath ? planStore.photoName(name, now) : '',
      timestamp: planStore.timestamp(now),
      createdAt: draft.createdAt || now.getTime(),
    });
    getApp().globalData.draftPlan = plan;
    wx.redirectTo({ url: '/cabinet/pages/design/index' });
  },
```

- [ ] **Step 2: 修改 wxml 隐藏转角块 + 动态 placeholder**

Edit `miniprogram/pages/space-setup/index.wxml`:

- 第 20 行 input placeholder 改为 `placeholder="{{wallHint.w}}"`
- 第 25 行 input placeholder 改为 `placeholder="{{wallHint.h}}"`
- 找到包含"是否有转角衣柜"的 view 块(约 33-38 行),整块外层加 `wx:if="{{mode !== 'shoe'}}"`。用 Read 拿到完整块的具体缩进后再做 Edit。

示例(具体位置以 Read 结果为准):
```xml
<view class="section" wx:if="{{mode !== 'shoe'}}">
  <view class="label">是否有转角衣柜</view>
  ...
</view>
```

- [ ] **Step 3: 开发者工具验证**

1. 从 plan-list 选"衣柜"进入 → placeholder 显示 `44 ~ 1000 cm` / `232 ~ 1000 cm`,转角块显示
2. 输入 44/232 → 无错;输入 43 → 报错含 "44cm"
3. 返回选"鞋柜"进入 → placeholder 显示 `80 ~ 300 cm` / `220 ~ 270 cm`,转角块隐藏
4. 输入 80/220 → 无错;输入 79/220 → 报错含 "80cm";输入 80/219 → 报错含 "220cm"
5. 鞋柜模式点确认 → draftPlan.mode === 'shoe'

- [ ] **Step 4: Commit**

```
git add miniprogram/pages/space-setup/index.js miniprogram/pages/space-setup/index.wxml
git commit -m "feat(space-setup): 按 mode 切墙面区间, 鞋柜模式隐藏转角块"
```

---

## Task 7: design 页 shoe 模式最小骨架(先不接 renderer)

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js`
- Modify: `miniprogram/cabinet/pages/design/index.wxml`

先让 design 页在 shoe 模式下能进入,不加高开关、只显示 150 tab、"上一模块"隐藏、"下一模块"改"确认布局";3D 场景暂时用现有 150cm 加载(下 Task 才接参数化)。

- [ ] **Step 1: 在 design/index.js 增加 mode 分支**

Read `miniprogram/cabinet/pages/design/index.js` 的 onLoad(约 66-112 行),在其中读取 plan.mode 并存 data:

修改 `data` 加一行 `mode: 'wardrobe'`。

在 onLoad 的 `_loadReady` async 函数体末尾 setData 里加 `mode: plan.mode || 'wardrobe'`。

在 onLoad 里,如果 `plan.mode === 'shoe'`,不调用 `layoutEngine.init`,直接构造 state:
```js
      let state;
      const mode = plan.mode || 'wardrobe';
      if (mode === 'shoe') {
        state = {
          items: [{
            id: 'shoe-0',
            kind: 'shoe',
            code: 's',
            w: plan.wall.w,
            h: plan.wall.h,
          }],
          meta: {
            wall: plan.wall,
            cornerType: 'WZJ',
            isFull: true,
            standardWidth: 0,
            standardUsed: 0,
            nonStandardWidth: 0,
            hasRaise: false,
            color: 'white',
          },
        };
      } else {
        state = layoutEngine.init({
          wall: plan.wall,
          cornerType: plan.cornerType,
          hasRaise: plan.hasRaise,
        });
      }
      this._state = state;
```

修改末尾的 setData:
```js
      await new Promise((resolve) => {
        const initialModelList = mode === 'shoe'
          ? [{ subdir: '150cm', name: '150S.glb', w: 150, h: 240, code: 's', kind: 'shoe', descText: '鞋柜' }]
          : enrichWithDesc(grouped.s100);
        this.setData({
          plan,
          mode,
          cornerLabel: CORNER_LABEL[plan.cornerType] || (mode === 'shoe' ? '鞋柜' : ''),
          modelList: initialModelList,
          items: state.items,
          meta: state.meta,
          standardWidth: state.meta.standardWidth,
          standardUsed: state.meta.standardUsed,
          nonStandardWidth: state.meta.nonStandardWidth,
          sizeTab: mode === 'shoe' ? 150 : this.data.sizeTab,
          show50: mode === 'shoe' ? false : true,
          show100: mode === 'shoe' ? false : true,
          show150: true,
          nextBtnText: mode === 'shoe' ? '确认布局' : '下一模块',
        }, () => {
          this._updateScrollIndicator();
          resolve();
        });
      });
```

- [ ] **Step 2: recompute 里对 shoe 模式短路**

Read recompute 定位(around line 340~410)。在函数首行加:
```js
    if (this.data.mode === 'shoe') {
      // 鞋柜模式: state 恒为单件 isFull, picker 只显 150 tab 且只有 1 项
      this.setData({
        items: this._state.items,
        meta: this._state.meta,
        selectedModelIdx: 0,
        nextBtnText: '确认布局',
        remainingStd: 0,
      });
      return;
    }
```

- [ ] **Step 3: onSwitchSize / onPickModel / onNext / onPrev 加 shoe 短路**

在 `onSwitchSize` 首行:
```js
    if (this.data.mode === 'shoe') return;
```

在 `onPickModel` 首行:
```js
    if (this.data.mode === 'shoe') return;
```

在 `onNext` 首行:
```js
    if (this.data.mode === 'shoe') { this.onConfirmLayout(); return; }
```

在 `onPrev` 首行:
```js
    if (this.data.mode === 'shoe') return;
```

- [ ] **Step 4: 修改 design/index.wxml 隐藏加高开关 + 上一模块按钮**

Read `miniprogram/cabinet/pages/design/index.wxml`,找到:
- 24-27 行 `.raise-row` 整块,外层加 `wx:if="{{mode !== 'shoe'}}"`
- 78 行 `<view class="action-btn" bindtap="onPrev">上一模块</view>`,加 `wx:if="{{mode !== 'shoe'}}"`

- [ ] **Step 5: layout-engine 防御鞋柜误调用**

Read `miniprogram/cabinet/utils/layout-engine.js` 找到 `addNext`, `replaceLast`, `removeLast` 三个导出函数的首行,分别加:
```js
  if (state && state.items && state.items[0] && state.items[0].kind === 'shoe') {
    return { ok: false, message: '鞋柜模式不支持排队式操作' };
  }
```

- [ ] **Step 6: 开发者工具验证**

1. plan-list → 选鞋柜 → space-setup 填 150×240 → 确认 → 进入 design 页
2. 页面显示:标题"150cm × 240cm · 鞋柜";加高开关**不显示**;picker 只显 150 tab 且只有一个卡片;"上一模块"按钮**不显示**;右侧按钮显示"确认布局"
3. 3D 场景暂时可能看到旧的鞋柜 GLB(如果 150S.glb 已经在本地)——这是 Task 8 要改的
4. 点"确认布局" → 走现有 onConfirmLayout,该弹的截图流程都要正常

- [ ] **Step 7: Commit**

```
git add miniprogram/cabinet/pages/design/index.js miniprogram/cabinet/pages/design/index.wxml miniprogram/cabinet/utils/layout-engine.js
git commit -m "feat(design): shoe 模式 UI 骨架, 只显 150 tab, 隐藏加高与上一模块"
```

---

## Task 8: three-renderer 剔除 GLB 动态部件 + 参数化生成叠加

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

150S.glb 已知节点清单(来自 `tests/150S.glb` 解析,节点命名规范严格):

**保留(壳)**: `side_left_panel_18`, `side_right_panel_18`, `bottom_panel_18`, `top_panel_18`, `baseboard_baseboard`, `countertop_countertop`, `back_panel_lower_*`, `back_panel_middle_*`, `back_panel_upper_*`, `shelf_fixed_down_*`(悬空区底板), `shelf_fixed_up_*`(悬空区顶板)

**剔除(sample 模板, geometry 复用后节点移除)**: `door_sample_*`, `shelf_sample_*`, `mid_panel_sample_*`

**剔除(参数化重生成)**: `lower_door_*`, `upper_door_*`, `mid_divider_*`, `shelf_fixed_L*`, `shelf_fixed_R*`, `shelf_upper_L*`, `shelf_upper_R*`

- [ ] **Step 1: Read renderer 找到 shoe 分支入口**

Read `miniprogram/cabinet/utils/three-renderer.js` 1330-1440 段,确认 `_placeRow` 已有的 shoe 逻辑(`isShoe` 分支,现有代码等比缩放整体)。**目标是替换这块 shoe 分支**,新增剔除+参数化。

- [ ] **Step 2: 在 renderer 顶部 require shoe-cabinet-parts**

在 `three-renderer.js` 顶部 require 区域加:
```js
const shoeCabinetParts = require('./shoe-cabinet-parts.js');
```

- [ ] **Step 3: 增加辅助方法 _prepareShoeShellAndSamples**

在 renderer 类中(建议放在 `_placeRow` 附近)增加:
```js
  // 从加载好的 150S GLB root 中:
  // 1. 抽取 door_sample / shelf_sample / mid_panel_sample 三个 mesh 的 geometry
  // 2. 剔除所有具体 door / divider / shelf_L*/R*_upper*/L*/R* 节点 + 三个 sample 节点
  // 3. 返回 { shellRoot, sampleGeometries: { doorGeometry, shelfGeometry, dividerGeometry } }
  // shellRoot 保留:侧板/顶板/底板/踢脚/台面/背板/悬空区固定板
  _prepareShoeShellAndSamples(root) {
    const sampleGeometries = { doorGeometry: null, shelfGeometry: null, dividerGeometry: null };
    const toRemove = [];
    root.traverse((n) => {
      if (!n.isMesh) return;
      const name = (n.name || '').toLowerCase();
      // 抽 sample geometry (只抽第一次遇到)
      if (name.indexOf('door_sample') >= 0) {
        if (!sampleGeometries.doorGeometry) sampleGeometries.doorGeometry = n.geometry.clone();
        toRemove.push(n);
        return;
      }
      if (name.indexOf('mid_panel_sample') >= 0) {
        if (!sampleGeometries.dividerGeometry) sampleGeometries.dividerGeometry = n.geometry.clone();
        toRemove.push(n);
        return;
      }
      if (name.indexOf('shelf_sample') >= 0) {
        if (!sampleGeometries.shelfGeometry) sampleGeometries.shelfGeometry = n.geometry.clone();
        toRemove.push(n);
        return;
      }
      // 剔除具体动态部件
      if (
        name.indexOf('lower_door') >= 0 ||
        name.indexOf('upper_door') >= 0 ||
        name.indexOf('mid_divider') >= 0 ||
        /shelf_upper_[lr]\d/.test(name) ||
        /shelf_fixed_[lr]\d/.test(name)
      ) {
        toRemove.push(n);
      }
    });
    toRemove.forEach((n) => {
      if (n.parent) n.parent.remove(n);
    });
    // sample geometry 若因 GLB 版本变化没找到, 用 BoxGeometry 兜底
    const THREE = this.THREE;
    if (!sampleGeometries.doorGeometry) sampleGeometries.doorGeometry = new THREE.BoxGeometry(450, 846, 18);
    if (!sampleGeometries.shelfGeometry) sampleGeometries.shelfGeometry = new THREE.BoxGeometry(1, 1, 1);
    if (!sampleGeometries.dividerGeometry) sampleGeometries.dividerGeometry = new THREE.BoxGeometry(1, 1, 1);
    return sampleGeometries;
  }
```

- [ ] **Step 4: 替换 _placeRow 的 isShoe 分支**

Read `_placeRow` 现有 isShoe 段(约 1354-1372 行,`if (isShoe) { ... } else { ... }`)。

替换为:
```js
        let sx, sy, sz, targetDepth;
        if (isShoe) {
          // 鞋柜: 加载 150S GLB 壳, 剔除动态部件, 追加参数化门/隔/层
          const sampleGeometries = this._prepareShoeShellAndSamples(mesh);
          const targetWmm = it.w * 10;
          const targetHmm = it.h * 10;
          // 壳按目标 mm 拉伸: 反推每轴缩放因子
          // 用剔除后的整体 bbox (剔除动态部件后 bbox 才准)
          const bbox3 = new THREE.Box3().setFromObject(mesh);
          const size3 = new THREE.Vector3();
          bbox3.getSize(size3);
          // GLB 单位: 用宽推 kScale(size3.x 对应目标 targetWmm),
          // 一步换算再按 target 尺寸缩放到目标 mm 空间
          const kToMm = size3.x > 0.001 ? 1500 / size3.x : 1; // 假设 GLB 原始等宽=1500mm
          const glbWmm = size3.x * kToMm;
          const glbHmm = size3.y * kToMm;
          const glbDmm = size3.z * kToMm;
          sx = targetWmm / glbWmm;
          sy = targetHmm / glbHmm;
          targetDepth = 400 / 10; // 场景 cm
          sz = 400 / glbDmm;
          // 整体缩放到 mm 目标 → 再乘 0.1 到 cm 场景
          const kSceneToCm = 0.1;
          sx *= kToMm * kSceneToCm;
          sy *= kToMm * kSceneToCm;
          sz *= kToMm * kSceneToCm;
          mesh.scale.set(sx, sy, sz);
          // 侧板不缩 X: 反补
          mesh.traverse((n) => {
            if (!n.isMesh) return;
            const nn = (n.name || '').toLowerCase();
            if (nn.indexOf('side_left_panel') >= 0 || nn.indexOf('side_right_panel') >= 0) {
              n.scale.x = 1 / (targetWmm / 1500);
            }
          });
          // 生成参数化部件 (mm 单位) 追加到 mesh
          const dyn = shoeCabinetParts.generateCabinetDynamicParts(THREE, targetWmm, targetHmm, sampleGeometries);
          // dyn.root 处于 mm 空间, 但 mesh 已被整体缩放到 cm scene, 追加到 mesh 内需要反缩放
          // 简化: dyn.root 直接乘 1/(kToMm*kSceneToCm) 的逆变换 = 无. 由于我们把 sample geometry 用了 GLB clone
          // 后本身单位与 GLB 一致, 参数化时 baseW=450 是 mm 假设, 需要把 dyn.root 单独按 (1 / (kToMm)) scale
          // 使其回到 GLB 本地空间, 再随 mesh 一起被拉伸
          const kInvToGlb = 1 / kToMm;
          dyn.root.scale.set(kInvToGlb, kInvToGlb, kInvToGlb);
          mesh.add(dyn.root);
        } else {
          sx = size.x > 0.001 ? it.w / size.x : 1;
          sy = size.y > 0.001 ? it.h / size.y : 1;
          targetDepth = isCornerLike ? 110 : CABINET_DEPTH_CM;
          sz = size.z > 0.001 ? targetDepth / size.z : 1;
          mesh.scale.set(sx, sy, sz);
        }
```

**注意:上面 isShoe 分支的单位换算比较绕,原因是 renderer 场景是 cm、GLB 是无单位、shoe-cabinet-parts 是 mm。实现时先按上面写,联调时用一根尺子:打印实际渲染后的 door mesh bbox,确认宽度 ≈ 500mm/10=50cm 量级即可,不对就调 sample geometry scale。**

- [ ] **Step 5: 在真机/开发者工具跑通**

在开发者工具:
1. 完整流程:plan-list → 选鞋柜 → space-setup 填 200×250 → 进入 design → 3D 场景应出现一个占满整墙的鞋柜
2. 目视:门缝对齐、上下门竖缝对齐、侧板厚度看起来一致、层板可见
3. 切换颜色:门/隔板/层板颜色应跟随 `_applyMaterial`
4. 切 "显示柜门" 开关:因为 `_isShoe` 分支跳过了 `_applyDoorVisibility`(three-renderer.js:1000),开关对鞋柜无效,这是既定行为

**如果尺寸严重错**:在浏览器 console 打 `this._cabinets.map(c=>c.item)` 和 mesh bbox,人工核对是 kToMm 假设错了还是侧板补偿方向错了,回来调 Step 4 的 scale 数值。

- [ ] **Step 6: Commit**

```
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(shoe): renderer 剔除 GLB 动态部件, 追加参数化门/隔/层"
```

---

## Task 9: 老 plan 兼容 + 联调收尾

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js`(如果需要)
- Modify: `miniprogram/pages/plan-list/index.js`(展示区)

- [ ] **Step 1: 确保老 plan 无 mode 字段自动降级为衣柜**

Grep `plan.mode` 与 `mode ===` 相关的读取处,确保每一处都有 `plan.mode || 'wardrobe'` fallback。

Run: `grep -rn "plan\.mode\|plan\?\?\.mode" miniprogram/`

对每处结果人工核对,给没有 fallback 的地方加上 `|| 'wardrobe'`。

- [ ] **Step 2: plan-list 卡片展示鞋柜标签(可选)**

Read `miniprogram/pages/plan-list/index.wxml:37-51`,在 plan-meta 里加一个鞋柜/衣柜标签:
```xml
<text wx:if="{{item.mode === 'shoe'}}">鞋柜</text>
<text wx:else>{{item.cornerLabel}}</text>
```

- [ ] **Step 3: 完整回归测试**

1. plan-list 新建衣柜 → space-setup → design → 保存 → 返回 plan-list,卡片显示衣柜转角标签
2. plan-list 新建鞋柜 → space-setup → design → 保存 → 返回 plan-list,卡片显示"鞋柜"
3. 从 plan-list 点开旧衣柜方案(可能没有 mode) → 应默认走衣柜流程
4. `node --test tests/shoe-cabinet-parts.test.js tests/cabinet-rules.test.js` 全绿

- [ ] **Step 4: Commit**

```
git add miniprogram/pages/plan-list/index.wxml miniprogram/cabinet/pages/design/index.js
git commit -m "feat(shoe): 老 plan 兼容 + plan-list 卡片显示鞋柜标签"
```

---

## Self-Review 结果

- **Spec 覆盖**:入口 ActionSheet(Task 5)、space-setup mode 分支(Task 6)、design 页 mode 分支(Task 7)、150S.glb 剔除+拉伸+参数化(Task 8)、单元测试(Task 1/2/3/4)、老 plan 兼容(Task 9)。全部覆盖。
- **Placeholder**:Task 8 里 `kToMm = 1500 / size3.x` 假设 GLB 原始等宽约等于 1500mm(150S.glb 的 S=1500)——这是从 `glb-metadata.expectedWidthCm('150S.glb') = 150cm` 反推的,真实 GLB 若单位不同,联调时会通过 mesh bbox 打印确认并微调。**这不是 placeholder,是实测才能确认的参数**,已在 Step 5 备注人工核对流程。
- **类型一致**:`generateCabinetDynamicParts` / `clearOldParts` / `getDoorCount` / `calcDoorSizeAndX` 在 Task 2/3/4 定义,Task 8 使用,签名一致。`plan.mode` 全流程用 `'wardrobe' | 'shoe'` 字符串,无别名。
