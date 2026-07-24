const test = require('node:test');
const assert = require('node:assert/strict');
const parts = require('../miniprogram/cabinet/utils/shoe-cabinet-parts.js');

function makeThreeMock() {
  const disposed = [];
  class BoxGeometry {
    constructor(x, y, z) {
      this.parameters = { width: x, height: y, depth: z };
      this._disposed = false;
    }
    clone() {
      return new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth);
    }
    dispose() { this._disposed = true; disposed.push(this); }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material || null;
      this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.name = '';
      this.userData = {};
      this.isMesh = true;
      this.parent = null;
      this.children = [];
    }
    add(child) { child.parent = this; this.children.push(child); }
    remove(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
    }
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

function findByName(root, name) {
  let hit = null;
  root.traverse((n) => { if (n.isMesh && n.name === name) hit = n; });
  return hit;
}

function findAllByCode(root, prefix) {
  const out = [];
  root.traverse((n) => {
    if (n.isMesh && n.userData && n.userData.panel &&
        n.userData.panel.code && n.userData.panel.code.indexOf(prefix) === 0) {
      out.push(n);
    }
  });
  return out;
}

function gen(variant, w, h) {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  return parts.generateCabinetDynamicParts(THREE, w, h, geos, { variant });
}

// ----------------- 150B --------------------

test('150B: root.userData.variant = "b"', () => {
  const r = gen('b', 1500, 2400);
  assert.equal(r.root.userData.variant, 'b');
});

test('150B: 主分割板 main_divider_LR 存在, X = xOffsets[2]-GAP/2, Y 贯穿 [SKIRT_H, totalH]', () => {
  const r = gen('b', 1500, 2400);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const md = findByName(r.root, 'main_divider_LR');
  assert.ok(md, 'main_divider_LR 未生成');
  assert.equal(md.position.x, sizeAndX.xOffsets[2] - parts.GAP / 2);
  const bottom = md.position.y - md.scale.y / 2;
  const top = md.position.y + md.scale.y / 2;
  assert.equal(bottom, parts.SKIRT_H);
  assert.equal(top, 2400);
  assert.equal(md.scale.x, 18);
  assert.equal(md.scale.z, parts.DEPTH_INNER);
});

test('150B: 左柜 2 扇门 + 右柜 doorCount 门 (上下一致)', () => {
  const r = gen('b', 2000, 2400);
  const leftDoors = findAllByCode(r.root, 'door_lower_L_');
  assert.equal(leftDoors.length, 2);
  const rightLowerDoors = findAllByCode(r.root, 'door_lower_R_');
  assert.ok(rightLowerDoors.length >= 1);
  const rightUpperDoors = findAllByCode(r.root, 'door_upper_R_');
  assert.equal(rightUpperDoors.length, rightLowerDoors.length);
});

test('150B: 左台面 countertop_L 存在 (底面 1000, 顶面 1050), 右柜无台面', () => {
  const r = gen('b', 1800, 2400);
  const lc = findByName(r.root, 'countertop_L');
  assert.ok(lc, 'countertop_L 未生成');
  assert.equal(lc.scale.y, parts.COUNTER_THICK);
  const bottom = lc.position.y - lc.scale.y / 2;
  const top = lc.position.y + lc.scale.y / 2;
  assert.equal(bottom, parts.SKIRT_H + parts.LOWER_CABINET_H);
  assert.equal(top, parts.SKIRT_H + parts.LOWER_CABINET_H + parts.COUNTER_THICK);
  assert.equal(findByName(r.root, 'countertop_R'), null);
});

test('150B: 左开放区 (台面以上) 无层板 — 保持镂空 (totalH=2400)', () => {
  const r = gen('b', 1500, 2400);
  const openShelves = findAllByCode(r.root, 'shelf_open_L_');
  assert.equal(openShelves.length, 0);
});

test('150B: 左开放区 (台面以上) 无层板 — 保持镂空 (totalH=2200)', () => {
  const r = gen('b', 1500, 2200);
  const openShelves = findAllByCode(r.root, 'shelf_open_L_');
  assert.equal(openShelves.length, 0);
});

test('150B: 左下柜 3 层活动板', () => {
  const r = gen('b', 1500, 2400);
  const s = findAllByCode(r.root, 'shelf_lower_L_');
  assert.equal(s.length, 3);
});

test('150B: 右下柜 3 层板 + 右柜上柜按 upperH 判分层数 (totalH=2400 → 2)', () => {
  const r = gen('b', 2000, 2400);
  const low = findAllByCode(r.root, 'shelf_lower_R_');
  assert.equal(low.length, 3);
  const up = findAllByCode(r.root, 'shelf_upper_R_');
  assert.equal(up.length, 2);
});

test('150B: 右柜下柜门 Y=[152, 1030], 高 878 (下柜顶板顶面与左柜台面顶面齐平 1050)', () => {
  const r = gen('b', 2000, 2400);
  const d = findByName(r.root, 'door_lower_R_1');
  assert.ok(d);
  const doorH = 846 * d.scale.y;
  const bottom = d.position.y - doorH / 2;
  const top = d.position.y + doorH / 2;
  assert.equal(bottom, 152);
  assert.equal(top, 1030);
  assert.equal(doorH, 878);
});

test('150B: 右柜最左门 R_1 左沿覆盖主分割板 (左移 18mm, 宽+18mm)', () => {
  const r = gen('b', 2000, 2400);
  const md = findByName(r.root, 'main_divider_LR');
  const dLower = findByName(r.root, 'door_lower_R_1');
  const dUpper = findByName(r.root, 'door_upper_R_1');
  assert.ok(md && dLower && dUpper);
  const mdLeftFace = md.position.x - md.scale.x / 2; // 主分割板左外面
  // 门左沿 = 主分割板左外面 + GAP(2mm)
  const lowerW = 450 * dLower.scale.x;
  const lowerLeft = dLower.position.x - lowerW / 2;
  assert.equal(lowerLeft, mdLeftFace + parts.GAP);
  const upperW = 450 * dUpper.scale.x;
  const upperLeft = dUpper.position.x - upperW / 2;
  assert.equal(upperLeft, mdLeftFace + parts.GAP);
});

test('150B: 右柜 R_2 门位置不受 R_1 覆盖影响', () => {
  // w=2000 → 右柜 2 门, R_2 是右侧那扇
  const r = gen('b', 2000, 2400);
  const d2 = findByName(r.root, 'door_lower_R_2');
  assert.ok(d2);
  // rightInnerXL = leftW + 9 = 999 + 9 = 1008
  // _calcDoorLayoutInCavity(974, 2): doorWidths=[484,484], xOffsets(cavity)=[2, 488]
  // R_2 全局 xOffset = 488 + 1008 = 1496, 门宽 484, 中心 = 1738
  const w2 = 450 * d2.scale.x;
  const left2 = d2.position.x - w2 / 2;
  assert.equal(w2, 484);
  assert.equal(left2, 1496);
});

test('150B: 右柜 shelf_fixed_R Y 中心=1041 (顶面 1050, 与左柜台面顶面齐平)', () => {
  const r = gen('b', 2000, 2400);
  const m = findByName(r.root, 'shelf_fixed_R');
  assert.ok(m);
  assert.equal(m.position.y, 150 + 900 - 9);
  assert.equal(m.scale.y, 18);
});

test('150B: 左柜台面以上一整块背板 back_panel_upper_L (Y=[1000, h-18], 无缝合)', () => {
  const r = gen('b', 1500, 2400);
  const m = findByName(r.root, 'back_panel_upper_L');
  assert.ok(m, 'back_panel_upper_L 未生成');
  const bottom = m.position.y - m.scale.y / 2;
  const top = m.position.y + m.scale.y / 2;
  assert.equal(bottom, 1000);
  assert.equal(top, 2400 - 18);
  assert.equal(m.scale.z, 18);
  // 不应再有 back_panel_middle_L / back_panel_open_L 的缝合背板
  assert.equal(findByName(r.root, 'back_panel_middle_L'), null);
  assert.equal(findByName(r.root, 'back_panel_open_L'), null);
});

test('150B: 每个 mesh 都挂 userData.panel.code', () => {
  const r = gen('b', 1800, 2400);
  const missing = [];
  r.root.traverse((n) => {
    if (n.isMesh) {
      if (!n.userData || !n.userData.panel || !n.userData.panel.code) {
        missing.push(n.name || '(no-name)');
      }
    }
  });
  assert.deepEqual(missing, []);
});

test('150B: 材质非 null', () => {
  const r = gen('b', 1800, 2400);
  const nulls = [];
  r.root.traverse((n) => { if (n.isMesh && !n.material) nulls.push(n.name); });
  assert.deepEqual(nulls, []);
});

test('150B: 右柜偶数门 (rightDoorCount=2) 无中侧板 - 对开门', () => {
  // w=2100 → outerDoorCount=4, 左柜占前 2 扇, 右柜 doorCount=getDoorCount(rightInnerW+36),
  // rightInnerW+36 大约在 [800, 1100] 区间 → 右柜 2 门, 偶数 → 中侧板 0 块.
  const r = gen('b', 2100, 2400);
  const rDivsLower = findAllByCode(r.root, 'mid_divider_lower_R_');
  const rDivsUpper = findAllByCode(r.root, 'mid_divider_upper_R_');
  assert.equal(rDivsLower.length, 0);
  assert.equal(rDivsUpper.length, 0);
});

test('150B: 右柜奇数门 (rightDoorCount=3) → 中侧板下段 1 上段 1', () => {
  // w=2600 → outerDoorCount=5, 左柜 2 扇, 右柜 doorCount=3 (奇数), 中侧板边界 1 组.
  const r = gen('b', 2600, 2400);
  const rDivsLower = findAllByCode(r.root, 'mid_divider_lower_R_');
  const rDivsUpper = findAllByCode(r.root, 'mid_divider_upper_R_');
  assert.equal(rDivsLower.length, 1);
  assert.equal(rDivsUpper.length, 1);
  // 下段中侧板 Y 覆盖 [SKIRT_H, SKIRT_H + RIGHT_LOWER_H - 18] = [150, 1032]
  const dl = rDivsLower[0];
  const bottom = dl.position.y - dl.scale.y / 2;
  const top = dl.position.y + dl.scale.y / 2;
  assert.equal(bottom, 150);
  assert.equal(top, 1032);
});

test('150B: 兜底 doorCount<3 (w=1000) 不崩溃, 主分割板在中点', () => {
  const r = gen('b', 1000, 2400);
  const md = findByName(r.root, 'main_divider_LR');
  assert.ok(md);
  assert.equal(md.position.x, 500);
});

test('150B: 背板 X 铺满各柜内宽, 后表面 Z=-DEPTH_TOTAL, 板厚 18', () => {
  const r = gen('b', 1800, 2400);
  const backs = [];
  r.root.traverse((n) => {
    if (n.isMesh && n.name && n.name.indexOf('back_panel_') === 0) backs.push(n);
  });
  assert.ok(backs.length >= 4, '预期至少 4 段背板 (左下 + 左上整块 + 右下 + 右上), 实际: ' + backs.length);
  backs.forEach((m) => {
    const back = m.position.z - m.scale.z / 2;
    assert.equal(back, -parts.DEPTH_TOTAL, m.name + ' 背面 Z 不是 -DEPTH_TOTAL');
    assert.equal(m.scale.z, 18);
  });
});

// ----------------- 150C --------------------

test('150C: root.userData.variant = "c"', () => {
  const r = gen('c', 1500, 2400);
  assert.equal(r.root.userData.variant, 'c');
});

test('150C: 左下柜门 h=630, Y=[152, 782] (门顶离抽面底 20mm 开门空间)', () => {
  const r = gen('c', 1500, 2400);
  const d = findByName(r.root, 'door_lower_L_1');
  assert.ok(d);
  const doorH = 846 * d.scale.y;
  assert.equal(doorH, 630);
  const bottom = d.position.y - doorH / 2;
  const top = d.position.y + doorH / 2;
  assert.equal(bottom, 152);
  assert.equal(top, 782);
});

test('150C: 门顶与抽面底之间正好 20mm 让位 (LOWER_DOOR_TOP_GAP)', () => {
  const r = gen('c', 1500, 2400);
  const d = findByName(r.root, 'door_lower_L_1');
  const df = findByName(r.root, 'drawer_front_L_01');
  assert.ok(d && df);
  const doorTop = d.position.y + (846 * d.scale.y) / 2;
  const drawerBottom = df.position.y - (846 * df.scale.y) / 2;
  assert.equal(drawerBottom - doorTop, parts.LOWER_DOOR_TOP_GAP);
});

test('150C: 左柜下柜 2 扇门 (与 150B 门数一致)', () => {
  const r = gen('c', 1500, 2400);
  const leftDoors = findAllByCode(r.root, 'door_lower_L_');
  assert.equal(leftDoors.length, 2);
});

test('150C: 抽面 drawer_front_L_01 存在, Y=[802, 998], h=196', () => {
  const r = gen('c', 1500, 2400);
  const df = findByName(r.root, 'drawer_front_L_01');
  assert.ok(df, 'drawer_front_L_01 未生成');
  const frontH = 846 * df.scale.y;
  assert.equal(frontH, 196);
  const bottom = df.position.y - frontH / 2;
  const top = df.position.y + frontH / 2;
  assert.equal(bottom, 802);
  assert.equal(top, 998);
});

test('150C: 抽屉盒 4 板齐全 (left/right/back/bottom)', () => {
  const r = gen('c', 1500, 2400);
  ['drawer_box_left_01_18',
   'drawer_box_right_01_18',
   'drawer_box_back_01_18',
   'drawer_box_bottom_01_18'].forEach((code) => {
    const m = findByName(r.root, code);
    assert.ok(m, code + ' 未生成');
    assert.equal(m.userData.panel.code, code);
    assert.equal(m.userData.panel.thickness, 18);
  });
});

test('150C: 台面 Y 与 150B 一致 (底面 1000, 顶面 1050)', () => {
  const r = gen('c', 1500, 2400);
  const lc = findByName(r.root, 'countertop_L');
  assert.ok(lc);
  const bottom = lc.position.y - lc.scale.y / 2;
  const top = lc.position.y + lc.scale.y / 2;
  assert.equal(bottom, 1000);
  assert.equal(top, 1050);
});

test('150C: 主分割板与 150B 相同 (X 与 Y 贯穿)', () => {
  const rc = gen('c', 1500, 2400);
  const rb = gen('b', 1500, 2400);
  const mdc = findByName(rc.root, 'main_divider_LR');
  const mdb = findByName(rb.root, 'main_divider_LR');
  assert.ok(mdc && mdb);
  assert.equal(mdc.position.x, mdb.position.x);
  assert.equal(mdc.scale.y, mdb.scale.y);
});

test('150C: 抽面命名精确匹配 drawer_front_L_01, 无 _18 后缀', () => {
  const r = gen('c', 1500, 2400);
  const df = findByName(r.root, 'drawer_front_L_01');
  assert.ok(df);
  assert.equal(df.userData.panel.code, 'drawer_front_L_01');
  assert.ok(df.userData.panel.code.indexOf('_18') === -1);
});

test('150C: 每个 mesh 挂 userData.panel.code', () => {
  const r = gen('c', 1500, 2400);
  const missing = [];
  r.root.traverse((n) => {
    if (n.isMesh) {
      if (!n.userData || !n.userData.panel || !n.userData.panel.code) {
        missing.push(n.name || '(no-name)');
      }
    }
  });
  assert.deepEqual(missing, []);
});

// 抽屉盒 span (center-to-center) = boxOuterW - 18 = frontW - 40 - 18 = frontW - 58
// (侧板中心离抽屉外沿 9mm, 抵消 18mm 板厚, 让盒外宽 = 抽面宽 - 40mm 滑轨预留)
test('150C: 抽屉盒左右侧板中心距 = 抽面宽 - 58 (盒外宽 - 侧板厚)', () => {
  const r = gen('c', 1500, 2400);
  const df = findByName(r.root, 'drawer_front_L_01');
  const bl = findByName(r.root, 'drawer_box_left_01_18');
  const br = findByName(r.root, 'drawer_box_right_01_18');
  assert.ok(df && bl && br);
  const boxSpan = br.position.x - bl.position.x;
  const frontW = 450 * df.scale.x;
  assert.ok(Math.abs(boxSpan - (frontW - 58)) < 1e-6,
    `boxSpan=${boxSpan}, frontW-58=${frontW - 58}`);
});
