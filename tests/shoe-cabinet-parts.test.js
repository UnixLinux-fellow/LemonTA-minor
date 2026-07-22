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
  assert.equal(parts.DEPTH_TOTAL, 420);
  assert.equal(parts.DEPTH_INNER, 384);
  // DEPTH_INNER = DEPTH_TOTAL - 前预留 18 - 背板 18
  assert.equal(parts.DEPTH_INNER, parts.DEPTH_TOTAL - 36);
});

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
  class MeshStandardMaterial {
    constructor(opts) { Object.assign(this, opts || {}); this.isMaterial = true; }
  }
  return { THREE: { Mesh, Group, BoxGeometry, MeshStandardMaterial }, disposed };
}

function makeGeometries(THREE) {
  return {
    doorGeometry: new THREE.BoxGeometry(450, 846, 18),
    shelfGeometry: new THREE.BoxGeometry(1, 1, 1),
    dividerGeometry: new THREE.BoxGeometry(1, 1, 1),
  };
}

test('createDoorGroup: 1500×2400 3扇 → 下门 3 + 上门 3 = 6 Mesh, Y 遵守下盖/离台面规则', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDoorGroup(THREE, 1500, 2400, sizeAndX, geos.doorGeometry);
  assert.equal(g.children.length, 6);
  // 下门: 底 = SKIRT_H + GAP = 152, 顶 = 台面底部 - 20 = 1000 - 20 = 980, 高 = 828, 中心 = 566
  const lowerYBottom = parts.SKIRT_H + parts.GAP;
  const lowerYTop = parts.SKIRT_H + parts.LOWER_CABINET_H - parts.LOWER_DOOR_TOP_GAP;
  const lowerYCenter = (lowerYBottom + lowerYTop) / 2;
  // 上门: 底 = FIXED_H - 28 = 1472 (下盖 28mm), 顶 = totalH - GAP = 2398, 高 = 926, 中心 = 1935
  const upperYBottom = parts.FIXED_H - parts.UPPER_DOOR_BOTTOM_OVERLAP;
  const upperYTop = 2400 - parts.GAP;
  const upperYCenter = (upperYBottom + upperYTop) / 2;
  const lowerDoors = g.children.filter((m) => m.userData.role === 'lower');
  const upperDoors = g.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lowerDoors.length, 3);
  assert.equal(upperDoors.length, 3);
  lowerDoors.forEach((m) => assert.equal(m.position.y, lowerYCenter));
  upperDoors.forEach((m) => assert.equal(m.position.y, upperYCenter));
  const first = lowerDoors[0];
  assert.equal(first.position.x, sizeAndX.xOffsets[0] + sizeAndX.doorWidths[0] / 2);
});

test('createDoorGroup: 下门顶面 Y=980, 距 50mm 台面底部 (Y=1000) 恰好 20mm', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDoorGroup(THREE, 1500, 2400, sizeAndX, geos.doorGeometry);
  const lower = g.children.find((m) => m.userData.role === 'lower');
  // 门 base geometry 846mm, mesh.scale.y = doorH / 846, mesh Y 是几何中心
  // 门顶 Y = center + (846 * scale.y) / 2 = center + doorH/2
  const doorTop = lower.position.y + (846 * lower.scale.y) / 2;
  assert.equal(doorTop, 980);
  const counterBottom = parts.SKIRT_H + parts.LOWER_CABINET_H;
  assert.equal(counterBottom - doorTop, 20);
});

test('createDoorGroup: 上门底面 Y=1472, 比上柜底面 (Y=FIXED_H=1500) 低 28mm', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  // 三种墙高: 上门底应始终 = FIXED_H - 28 = 1472, 不随墙高变化
  [2200, 2400, 2700].forEach((totalH) => {
    const g = parts.createDoorGroup(THREE, 1500, totalH, sizeAndX, geos.doorGeometry);
    const upper = g.children.find((m) => m.userData.role === 'upper');
    const doorBottom = upper.position.y - (846 * upper.scale.y) / 2;
    assert.equal(doorBottom, 1472);
    assert.equal(parts.FIXED_H - doorBottom, 28);
  });
});

test('新增门板 Y 常量: LOWER_DOOR_TOP_GAP=20, UPPER_DOOR_BOTTOM_OVERLAP=28', () => {
  assert.equal(parts.LOWER_DOOR_TOP_GAP, 20);
  assert.equal(parts.UPPER_DOOR_BOTTOM_OVERLAP, 28);
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

// 分组规则: N 奇 → [1, 2, 2, ...] (单开门在最左, 其余对开); N 偶 → [2, 2, ...] (全对开)
// 中侧板只放在分组边界, 数量 = groups.length - 1
test('getDoorGroups: 奇数 → 左单开 + 其余对开', () => {
  assert.deepEqual(parts.getDoorGroups(3), [1, 2]);
  assert.deepEqual(parts.getDoorGroups(5), [1, 2, 2]);
});

test('getDoorGroups: 偶数 → 全对开', () => {
  assert.deepEqual(parts.getDoorGroups(2), [2]);
  assert.deepEqual(parts.getDoorGroups(4), [2, 2]);
  assert.deepEqual(parts.getDoorGroups(6), [2, 2, 2]);
});

test('createDividerGroup: N=2 (对开) → 0 隔板', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1000, 2);
  const g = parts.createDividerGroup(THREE, 1000, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 0);
});

test('createDividerGroup: N=3 (左单开+对开) → 1 隔板, X 在第 1/2 扇门之间', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDividerGroup(THREE, 1500, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 2); // 上下各 1 块
  const lowers = g.children.filter((m) => m.userData.role === 'lower');
  const uppers = g.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lowers.length, 1);
  assert.equal(uppers.length, 1);
  // 分组 [1, 2]: 边界在门 1 (第 2 扇) 左侧, 即 xOffsets[1] - GAP/2
  assert.equal(lowers[0].position.x, sizeAndX.xOffsets[1] - parts.GAP / 2);
  assert.equal(uppers[0].position.x, sizeAndX.xOffsets[1] - parts.GAP / 2);
});

test('createDividerGroup: N=4 (对开对开) → 1 隔板, X 在第 2/3 扇门之间', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1800, 4);
  const g = parts.createDividerGroup(THREE, 1800, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 2);
  const lowers = g.children.filter((m) => m.userData.role === 'lower');
  assert.equal(lowers.length, 1);
  // 分组 [2, 2]: 边界在门 2 (第 3 扇) 左侧, 即 xOffsets[2] - GAP/2
  assert.equal(lowers[0].position.x, sizeAndX.xOffsets[2] - parts.GAP / 2);
});

test('createDividerGroup: N=5 (左单开+对开+对开) → 2 隔板, X 在第 1/2 与第 3/4 扇门之间', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(2400, 5);
  const g = parts.createDividerGroup(THREE, 2400, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 4);
  const lowers = g.children.filter((m) => m.userData.role === 'lower');
  const xs = lowers.map((m) => m.position.x).sort((a, b) => a - b);
  assert.equal(lowers.length, 2);
  assert.deepEqual(xs, [
    sizeAndX.xOffsets[1] - parts.GAP / 2,
    sizeAndX.xOffsets[3] - parts.GAP / 2,
  ]);
});

test('createDividerGroup: N=6 (三组对开) → 2 隔板, X 在第 2/3 与第 4/5 扇门之间', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(2800, 6);
  const g = parts.createDividerGroup(THREE, 2800, 2400, sizeAndX, geos.dividerGeometry);
  assert.equal(g.children.length, 4);
  const lowers = g.children.filter((m) => m.userData.role === 'lower');
  const xs = lowers.map((m) => m.position.x).sort((a, b) => a - b);
  assert.equal(lowers.length, 2);
  assert.deepEqual(xs, [
    sizeAndX.xOffsets[2] - parts.GAP / 2,
    sizeAndX.xOffsets[4] - parts.GAP / 2,
  ]);
});

test('createDividerGroup: 上下段 X 完全对齐', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(2400, 5);
  const g = parts.createDividerGroup(THREE, 2400, 2400, sizeAndX, geos.dividerGeometry);
  const lowerXs = g.children.filter((m) => m.userData.role === 'lower').map((m) => m.position.x).sort((a, b) => a - b);
  const upperXs = g.children.filter((m) => m.userData.role === 'upper').map((m) => m.position.x).sort((a, b) => a - b);
  assert.deepEqual(lowerXs, upperXs);
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

test('generateCabinetDynamicParts: 组合 7 个 group (+ counter + upper/fixed backPanels)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos);
  assert.equal(r.root.children.length, 7);
  assert.ok(r.doors);
  assert.ok(r.dividers);
  assert.ok(r.shelves);
  assert.ok(r.fixedDividers);
  assert.ok(r.counter);
  assert.ok(r.upperBackPanel);
  assert.ok(r.fixedBackPanels);
});

test('createFixedBackPanelGroup: 下柜背板 [168,982], 中间背板 [1000,1500], 无缝贴合上下水平板', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createFixedBackPanelGroup(THREE, 1500, geos.shelfGeometry);
  assert.equal(g.children.length, 2);
  const lower = g.children.find((m) => m.userData.role === 'lower_back');
  const middle = g.children.find((m) => m.userData.role === 'middle_back');
  assert.ok(lower && middle);

  // 下柜背板: 下贴 bottom_plate 顶 (=168), 上贴 shelf_fixed_down 底 (=982)
  const lb = lower.position.y - lower.scale.y / 2;
  const lt = lower.position.y + lower.scale.y / 2;
  assert.equal(lb, parts.SKIRT_H + 18);
  assert.equal(lt, parts.SKIRT_H + parts.LOWER_CABINET_H - 18);

  // 中间背板: 下贴 shelf_fixed_down 顶 (=1000), 上贴 shelf_fixed_up 底 (=1500)
  const mb = middle.position.y - middle.scale.y / 2;
  const mt = middle.position.y + middle.scale.y / 2;
  assert.equal(mb, parts.SKIRT_H + parts.LOWER_CABINET_H);
  assert.equal(mt, parts.FIXED_H);

  // 都靠背, 板厚 18mm, 后表面 Z=-DEPTH_TOTAL
  [lower, middle].forEach((m) => {
    assert.equal(m.scale.z, 18);
    assert.equal(m.position.z - m.scale.z / 2, -parts.DEPTH_TOTAL);
    // X 铺满内宽
    assert.equal(m.scale.x, 1500 - parts.SIDE_PANEL_THICK * 2);
  });
});

test('createCounterGroup: 台面底面 Y=1000 顶面 Y=1050, 中心 Y=1025', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createCounterGroup(THREE, 1500, geos.shelfGeometry);
  assert.equal(g.children.length, 1);
  const m = g.children[0];
  assert.equal(m.position.y, parts.SKIRT_H + parts.LOWER_CABINET_H + parts.COUNTER_THICK / 2);
  assert.equal(m.scale.y, parts.COUNTER_THICK);
  const bottom = m.position.y - m.scale.y / 2;
  const top = m.position.y + m.scale.y / 2;
  assert.equal(bottom, 1000);
  assert.equal(top, 1050);
  // 台面顶部无缝对齐 shelf_fixed_down 顶面 (=1000)
  assert.equal(bottom, parts.SKIRT_H + parts.LOWER_CABINET_H);
});

test('createUpperBackPanelGroup: 底面 Y=1518 (紧贴 shelf_fixed_up 顶面), 顶面 Y=totalH-18', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  // 墙 260cm: 上柜段 1100mm, 后背板高度 1082mm
  const g = parts.createUpperBackPanelGroup(THREE, 1500, 2600, geos.shelfGeometry);
  assert.equal(g.children.length, 1);
  const m = g.children[0];
  const bottom = m.position.y - m.scale.y / 2;
  const top = m.position.y + m.scale.y / 2;
  assert.equal(bottom, 1518);
  assert.equal(top, 2582);
  // 无缝对齐 shelf_fixed_up 顶面 (=1518 = FIXED_H + 18)
  assert.equal(bottom, parts.FIXED_H + 18);
  // 内宽铺满 (两侧板之间)
  assert.equal(m.scale.x, 1500 - parts.SIDE_PANEL_THICK * 2);
  // 板厚 18mm 靠背
  assert.equal(m.scale.z, 18);
  const backFace = m.position.z - m.scale.z / 2;
  assert.equal(backFace, -parts.DEPTH_TOTAL);
});

test('createUpperBackPanelGroup: 墙 220cm 上柜最矮情形仍能贴合', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createUpperBackPanelGroup(THREE, 1500, 2200, geos.shelfGeometry);
  const m = g.children[0];
  const bottom = m.position.y - m.scale.y / 2;
  const top = m.position.y + m.scale.y / 2;
  assert.equal(bottom, 1518);
  assert.equal(top, 2182);
});

test('createFixedDividerGroup: 两块水平固定板, 底柜顶板顶面=1000, 上柜底板底面=1500', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createFixedDividerGroup(THREE, 1500, geos.shelfGeometry);
  assert.equal(g.children.length, 2);
  const lower = g.children.find((m) => m.userData.role === 'lower_top');
  const upper = g.children.find((m) => m.userData.role === 'upper_bottom');
  assert.ok(lower && upper);
  // 底柜顶板中心 = 991, 板厚 18, 顶面 = 1000 (= SKIRT_H + LOWER_CABINET_H)
  assert.equal(lower.position.y, parts.SKIRT_H + parts.LOWER_CABINET_H - 9);
  // 上柜底板中心 = 1509, 板厚 18, 底面 = 1500 (= FIXED_H)
  assert.equal(upper.position.y, parts.FIXED_H + 9);
});

test('回归: 隔板 Z 范围完全落在柜体内 [-DEPTH_TOTAL, 0] mm (正面 Z=0, 背板前面 Z=-400)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const g = parts.createDividerGroup(THREE, 1500, 2400, sizeAndX, geos.dividerGeometry);
  g.children.forEach((m) => {
    const front = m.position.z + m.scale.z / 2;
    const back = m.position.z - m.scale.z / 2;
    assert.ok(front <= 0, `隔板 ${m.name} 正面 ${front} 超出柜体正面 (>0)`);
    assert.ok(back >= -parts.DEPTH_TOTAL - 1e-6, `隔板 ${m.name} 背面 ${back} 越过柜体背面 (<-${parts.DEPTH_TOTAL})`);
  });
});

test('回归: 层板 Z 范围完全落在柜体内 [-DEPTH_TOTAL, 0] mm', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const g = parts.createShelfGroup(THREE, 1500, 2400, geos.shelfGeometry);
  g.children.forEach((m) => {
    const front = m.position.z + m.scale.z / 2;
    const back = m.position.z - m.scale.z / 2;
    assert.ok(front <= 0, `层板 ${m.name} 正面 ${front} 超出柜体正面 (>0)`);
    assert.ok(back >= -parts.DEPTH_TOTAL - 1e-6, `层板 ${m.name} 背面 ${back} 越过柜体背面 (<-${parts.DEPTH_TOTAL})`);
  });
});

test('回归: 生成的所有 Mesh 材质非 null (three.js miniprogram projectObject 会读 material.visible)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos);
  const nulls = [];
  r.root.traverse((n) => {
    if (n.isMesh && !n.material) nulls.push(n.name || '(no name)');
  });
  assert.deepEqual(nulls, [], `以下 mesh 材质为 null: ${nulls.join(', ')}`);
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
