const test = require('node:test');
const assert = require('node:assert/strict');
const bs = require('../miniprogram/cabinet/utils/bookshelf-parts.js');

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

function collectByRole(root, kind) {
  const out = [];
  root.traverse((n) => {
    if (n.isMesh && n.parent && n.parent.userData && n.parent.userData.kind === kind) {
      out.push(n);
    }
  });
  return out;
}

test('常量导出: 三段坐标 + 深度契约', () => {
  assert.equal(bs.SKIRT_H_BS, 60);
  assert.equal(bs.LOWER_H, 800);
  assert.equal(bs.MIDDLE_H, 1200);
  assert.equal(bs.LOWER_TOP_Y, 800);
  assert.equal(bs.MIDDLE_TOP_Y, 2000);
  assert.equal(bs.DEPTH_TOTAL, 420);
  assert.equal(bs.DEPTH_INNER, 382);
  assert.equal(bs.SIDE_PANEL_THICK, 18);
  assert.equal(bs.GAP, 2);
});

test('createDoorGroup: 1200×2400 → 每列 3 门 (下+中+上)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const sizeAndX = require('../miniprogram/cabinet/utils/cabinet-common.js').calcDoorSizeAndX(1200, 3);
  const g = bs.createDoorGroup(THREE, 1200, 2400, sizeAndX, geos.doorGeometry);
  assert.equal(g.children.length, 9);
});

test('下门 Y=[62, 798], h=736', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const d = findByName(r.root, 'door_lower_1');
  assert.ok(d);
  const h = 846 * d.scale.y;
  assert.equal(h, 736);
  assert.equal(d.position.y - h / 2, 62);
  assert.equal(d.position.y + h / 2, 798);
});

test('中门 Y=[820, 1998], h=1178, userData.material="glass"', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const d = findByName(r.root, 'door_middle_1');
  assert.ok(d);
  const h = 846 * d.scale.y;
  assert.equal(h, 1178);
  assert.equal(d.position.y - h / 2, 820);
  assert.equal(d.position.y + h / 2, 1998);
  assert.equal(d.userData.material, 'glass');
});

test('上门 Y=[2020, totalH-2] (随 totalH 变化)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  [2200, 2400, 2700].forEach((totalH) => {
    const r = bs.generateBookshelfDynamicParts(THREE, 1200, totalH, geos);
    const d = findByName(r.root, 'door_upper_1');
    assert.ok(d);
    const h = 846 * d.scale.y;
    assert.equal(d.position.y - h / 2, 2020);
    assert.equal(d.position.y + h / 2, totalH - 2);
  });
});

test('三段门 X 完全对齐 (共享 xOffsets)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  for (let i = 1; i <= 3; i++) {
    const l = findByName(r.root, `door_lower_${i}`);
    const m = findByName(r.root, `door_middle_${i}`);
    const u = findByName(r.root, `door_upper_${i}`);
    assert.equal(l.position.x, m.position.x);
    assert.equal(m.position.x, u.position.x);
  }
});

test('层板: 下段 1 块 (Y=430) + 中段 3 块 + 上段 0 块', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const shelves = r.shelves.children;
  const lower = shelves.filter((m) => m.userData.role === 'lower');
  const middle = shelves.filter((m) => m.userData.role === 'middle');
  const upper = shelves.filter((m) => m.userData.role === 'upper');
  assert.equal(lower.length, 1);
  assert.equal(middle.length, 3);
  assert.equal(upper.length, 0);
  assert.equal(lower[0].position.y, 430);
});

test('中段 3 层板: 中段内空 [818, 2000] 4 等分 (1/4=1113.5, 1/2=1409, 3/4=1704.5)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const middle = r.shelves.children
    .filter((m) => m.userData.role === 'middle')
    .sort((a, b) => a.position.y - b.position.y);
  const midInner = 2000 - 818; // 1182
  assert.ok(Math.abs(middle[0].position.y - (818 + midInner * 0.25)) < 1e-6);
  assert.ok(Math.abs(middle[1].position.y - (818 + midInner * 0.5)) < 1e-6);
  assert.ok(Math.abs(middle[2].position.y - (818 + midInner * 0.75)) < 1e-6);
});

test('层板深度 = DEPTH_INNER, 宽度 = totalW - 36', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  r.shelves.children.forEach((m) => {
    assert.equal(m.scale.z, bs.DEPTH_INNER);
    assert.equal(m.scale.x, 1200 - 36);
    assert.equal(m.scale.y, 18);
  });
});

// 书柜规则: 每扇门一格 (支撑性要求, 不允许对开), 中侧板数 = doorCount - 1, 分三段各一份.
test('中侧板: N=3 门 → 每门一格 → 每段 2 块中侧板, 共 6 块', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  assert.equal(r.dividers.children.length, 6);
  const lowers = r.dividers.children.filter((m) => m.userData.role === 'lower');
  const middles = r.dividers.children.filter((m) => m.userData.role === 'middle');
  const uppers = r.dividers.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lowers.length, 2);
  assert.equal(middles.length, 2);
  assert.equal(uppers.length, 2);
});

test('中侧板: N=2 门 → 每门一格 → 每段 1 块中侧板, 共 3 块', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1000, 2400, geos);
  assert.equal(r.dividers.children.length, 3);
  const lowers = r.dividers.children.filter((m) => m.userData.role === 'lower');
  const middles = r.dividers.children.filter((m) => m.userData.role === 'middle');
  const uppers = r.dividers.children.filter((m) => m.userData.role === 'upper');
  assert.equal(lowers.length, 1);
  assert.equal(middles.length, 1);
  assert.equal(uppers.length, 1);
});

test('中侧板: N=4 门 → 每门一格 → 每段 3 块中侧板, 共 9 块', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1800, 2400, geos);
  assert.equal(r.dividers.children.length, 9);
});

// 中侧板必须无缝贴合固定水平板 / 踢脚 / 顶板 —— 板件之间不允许有缝隙.
test('中侧板 Y 范围贴合水平结构: 下段[60,782] 中段[800,1982] 上段[2000,totalH-18]', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const totalH = 2400;
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, totalH, geos);
  const lower = r.dividers.children.find((m) => m.userData.role === 'lower');
  const middle = r.dividers.children.find((m) => m.userData.role === 'middle');
  const upper = r.dividers.children.find((m) => m.userData.role === 'upper');
  // 下段: 踢脚顶面 60 -> fixed_divider_down 底面 782
  assert.equal(lower.position.y - lower.scale.y / 2, 60);
  assert.equal(lower.position.y + lower.scale.y / 2, 782);
  // 中段: fixed_divider_down 顶面 800 -> fixed_divider_up 底面 1982
  assert.equal(middle.position.y - middle.scale.y / 2, 800);
  assert.equal(middle.position.y + middle.scale.y / 2, 1982);
  // 上段: fixed_divider_up 顶面 2000 -> top_plate 底面 totalH-18
  assert.equal(upper.position.y - upper.scale.y / 2, 2000);
  assert.equal(upper.position.y + upper.scale.y / 2, totalH - 18);
});

test('中侧板三段 X 完全对齐', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 2400, 2400, geos);
  const lows = r.dividers.children.filter((m) => m.userData.role === 'lower').map((m) => m.position.x).sort();
  const mids = r.dividers.children.filter((m) => m.userData.role === 'middle').map((m) => m.position.x).sort();
  const ups = r.dividers.children.filter((m) => m.userData.role === 'upper').map((m) => m.position.x).sort();
  assert.deepEqual(lows, mids);
  assert.deepEqual(mids, ups);
});

test('固定水平板: fixed_divider_down 顶面 Y=800, fixed_divider_up 顶面 Y=2000', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const down = findByName(r.root, 'fixed_divider_down');
  const up = findByName(r.root, 'fixed_divider_up');
  assert.ok(down && up);
  assert.equal(down.position.y + down.scale.y / 2, 800);
  assert.equal(down.position.y, 791);
  assert.equal(up.position.y + up.scale.y / 2, 2000);
  assert.equal(up.position.y, 1991);
});

test('背板三段: back_panel_lower [78,782] / middle [818,1982] / upper [2018, totalH-18]', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const lower = findByName(r.root, 'back_panel_lower');
  const middle = findByName(r.root, 'back_panel_middle');
  const upper = findByName(r.root, 'back_panel_upper');
  assert.ok(lower && middle && upper);

  assert.equal(lower.position.y - lower.scale.y / 2, 78);
  assert.equal(lower.position.y + lower.scale.y / 2, 782);

  assert.equal(middle.position.y - middle.scale.y / 2, 818);
  assert.equal(middle.position.y + middle.scale.y / 2, 1982);

  assert.equal(upper.position.y - upper.scale.y / 2, 2018);
  assert.equal(upper.position.y + upper.scale.y / 2, 2400 - 18);

  // 每块背板厚 18mm 靠背, 后表面 Z=-DEPTH_TOTAL
  [lower, middle, upper].forEach((m) => {
    assert.equal(m.scale.z, 18);
    assert.equal(m.position.z - m.scale.z / 2, -bs.DEPTH_TOTAL);
    assert.equal(m.scale.x, 1200 - 36);
  });
});

test('generateBookshelfDynamicParts: root 有 5 个 group', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  assert.equal(r.root.children.length, 5);
  assert.ok(r.doors);
  assert.ok(r.shelves);
  assert.ok(r.dividers);
  assert.ok(r.fixedDividers);
  assert.ok(r.backPanels);
});

test('root.userData.kind = "bookshelfParts", totalWidth/Height 记录', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  assert.equal(r.root.userData.kind, 'bookshelfParts');
  assert.equal(r.root.userData.totalWidth, 1200);
  assert.equal(r.root.userData.totalHeight, 2400);
});

test('每个 mesh 挂 userData.panel.code (成本计算前置条件)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
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

test('门 panel.thickness = 20 (含 2mm 缝), 层/隔/背板/水平板 = 18', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  r.doors.children.forEach((m) => {
    assert.equal(m.userData.panel.thickness, 20, `${m.name} 应 thickness=20`);
  });
  r.shelves.children.forEach((m) => {
    assert.equal(m.userData.panel.thickness, 18);
  });
  r.dividers.children.forEach((m) => {
    assert.equal(m.userData.panel.thickness, 18);
  });
  r.fixedDividers.children.forEach((m) => {
    assert.equal(m.userData.panel.thickness, 18);
  });
  r.backPanels.children.forEach((m) => {
    assert.equal(m.userData.panel.thickness, 18);
  });
});

test('材质非 null (three.js miniprogram projectObject 兼容)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  const nulls = [];
  r.root.traverse((n) => { if (n.isMesh && !n.material) nulls.push(n.name); });
  assert.deepEqual(nulls, []);
});

test('回归: 层板/中侧板 Z 范围全落在柜体内 [-DEPTH_TOTAL, 0]', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  [r.shelves, r.dividers, r.fixedDividers].forEach((g) => {
    g.children.forEach((m) => {
      const front = m.position.z + m.scale.z / 2;
      const back = m.position.z - m.scale.z / 2;
      assert.ok(front <= 0, `${m.name} 正面 ${front} 超出柜正面`);
      assert.ok(back >= -bs.DEPTH_TOTAL - 1e-6, `${m.name} 背面 ${back} 越过柜背`);
    });
  });
});

test('clearOldParts: 递归 dispose + 从 parent 移除', () => {
  const { THREE, disposed } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  let meshCount = 0;
  r.root.traverse((n) => { if (n.isMesh) meshCount += 1; });
  bs.clearOldParts(r.root);
  assert.equal(r.root.children.length, 0);
  assert.equal(disposed.length, meshCount);
});

test('中门 (玻璃) userData.material 只标 middle 段, lower/upper 不标', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  r.doors.children.forEach((m) => {
    if (m.userData.role === 'middle') {
      assert.equal(m.userData.material, 'glass');
    } else {
      assert.equal(m.userData.material, undefined);
    }
  });
});
