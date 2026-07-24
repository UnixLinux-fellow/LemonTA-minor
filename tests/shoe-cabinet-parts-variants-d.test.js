const test = require('node:test');
const assert = require('node:assert/strict');
const parts = require('../miniprogram/cabinet/utils/shoe-cabinet-parts.js');

function makeThreeMock() {
  class BoxGeometry {
    constructor(x, y, z) {
      this.parameters = { width: x, height: y, depth: z };
      this._disposed = false;
    }
    clone() {
      return new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth);
    }
    dispose() { this._disposed = true; }
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
  return { THREE: { Mesh, Group, BoxGeometry, MeshStandardMaterial } };
}

function makeGeometries(THREE) {
  return {
    doorGeometry: new THREE.BoxGeometry(450, 846, 18),
    shelfGeometry: new THREE.BoxGeometry(1, 1, 1),
    dividerGeometry: new THREE.BoxGeometry(1, 1, 1),
  };
}

function gen150D(w, h) {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  return parts.generateCabinetDynamicParts(THREE, w, h, geos, { variant: 'd' });
}

test('150D: root.userData.variant === "d" 且 kind 正确', () => {
  const r = gen150D(1500, 2400);
  assert.equal(r.root.userData.variant, 'd');
  assert.equal(r.root.userData.kind, 'shoeCabinetParts');
});

test('150D: group 总数 = 8 (150A 的 7 + drawers)', () => {
  const r = gen150D(1500, 2400);
  assert.equal(r.root.children.length, 8);
  assert.ok(r.drawers, 'drawers group 缺失');
});

test('150D: 奇数门 (3 门) → 抽屉分组 [1,2] → 2 个抽屉', () => {
  const r = gen150D(1500, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  assert.equal(fronts.length, 2);
  assert.equal(r.drawers.children.length, 10);
});

test('150D: 偶数门 (4 门) → 抽屉分组 [2,2] → 2 个抽屉', () => {
  const r = gen150D(1800, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  assert.equal(fronts.length, 2);
  assert.equal(r.drawers.children.length, 10);
});

test('150D: 2 门 (对开) → 分组 [2] → 1 个抽屉横跨双门', () => {
  const r = gen150D(1000, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  assert.equal(fronts.length, 1);
  assert.equal(r.drawers.children.length, 5);
  const sizeAndX = parts.calcDoorSizeAndX(1000, 2);
  const expectedW = sizeAndX.xOffsets[1] + sizeAndX.doorWidths[1] - sizeAndX.xOffsets[0];
  assert.equal(fronts[0].scale.x * 450, expectedW);
});

test('150D: 6 门 → 抽屉分组 [2,2,2] → 3 个抽屉, 15 mesh', () => {
  const r = gen150D(3000, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  assert.equal(fronts.length, 3);
  assert.equal(r.drawers.children.length, 15);
});

test('150D: 5 门 (奇) → 抽屉分组 [1,2,2] → 3 个抽屉', () => {
  const r = gen150D(2400, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  assert.equal(fronts.length, 3);
});

test('150D: 抽屉行 Y=[800, 1000] 贴台面底, 中心 Y=900, 高 200', () => {
  const r = gen150D(1500, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  fronts.forEach((m) => {
    assert.equal(m.position.y, 900);
    const bottom = m.position.y - (846 * m.scale.y) / 2;
    const top = m.position.y + (846 * m.scale.y) / 2;
    assert.equal(bottom, 800);
    assert.equal(top, 1000);
    assert.equal(top - bottom, 200);
  });
});

test('150D: 抽屉盒 5 板齐全 (front + left + right + back + bottom)', () => {
  const r = gen150D(1500, 2400);
  const roles = [
    'drawer_front',
    'drawer_box_left',
    'drawer_box_right',
    'drawer_box_back',
    'drawer_box_bottom',
  ];
  roles.forEach((role) => {
    const found = r.drawers.children.filter((m) => m.userData.role === role);
    assert.equal(found.length, 2, `role ${role} 每抽屉应有 1 块, 2 抽屉共 2 块`);
  });
});

test('150D: 下门 Y 底=152, 顶=780, 高=628 (顶被抽屉压低 200)', () => {
  const r = gen150D(1500, 2400);
  const lowers = r.doors.children.filter((m) => m.userData.role === 'lower');
  assert.ok(lowers.length > 0);
  lowers.forEach((m) => {
    const bottom = m.position.y - (846 * m.scale.y) / 2;
    const top = m.position.y + (846 * m.scale.y) / 2;
    assert.equal(bottom, 152);
    assert.equal(top, 780);
    assert.equal(top - bottom, 628);
  });
});

test('150D: 上门 Y 与 150A 一致 (不受抽屉影响)', () => {
  const r = gen150D(1500, 2400);
  const uppers = r.doors.children.filter((m) => m.userData.role === 'upper');
  uppers.forEach((m) => {
    const bottom = m.position.y - (846 * m.scale.y) / 2;
    assert.equal(bottom, parts.FIXED_H - parts.UPPER_DOOR_BOTTOM_OVERLAP);
  });
});

test('150D: 下柜层板数 = 2 (150A 是 3)', () => {
  const r = gen150D(1500, 2400);
  const lowerShelves = r.shelves.children.filter((m) => m.userData.role === 'lower');
  assert.equal(lowerShelves.length, 2);
});

test('150D: 上柜层板 (totalH=2400, upperH=900 > 800) → 2 层, 同 150A', () => {
  const r = gen150D(1500, 2400);
  const upperShelves = r.shelves.children.filter((m) => m.userData.role === 'upper');
  assert.equal(upperShelves.length, 2);
});

test('150D: 上柜矮情形 (totalH=2200, upperH=700 ≤ 800) → 1 层', () => {
  const r = gen150D(1500, 2200);
  const upperShelves = r.shelves.children.filter((m) => m.userData.role === 'upper');
  assert.equal(upperShelves.length, 1);
});

test('150D: 每个抽屉 mesh 有 userData.panel, code 匹配命名规范, thickness=18', () => {
  const r = gen150D(1500, 2400);
  const codeRe = /^(drawer_front|drawer_box_(left|right|back|bottom))_\d{2}(_18)?$/;
  r.drawers.children.forEach((m) => {
    assert.ok(m.userData.panel, `${m.name} 缺少 userData.panel`);
    assert.ok(codeRe.test(m.userData.panel.code), `code ${m.userData.panel.code} 命名不合规`);
    assert.equal(m.userData.panel.thickness, 18);
    assert.ok(
      m.userData.panel.length >= m.userData.panel.width,
      `${m.name}: length(${m.userData.panel.length}) 应 >= width(${m.userData.panel.width})`,
    );
  });
});

test('150D: drawer_front NN 从 01 起, 抽面无 _18 后缀', () => {
  const r = gen150D(1500, 2400);
  const fronts = r.drawers.children
    .filter((m) => m.userData.role === 'drawer_front')
    .sort((a, b) => a.userData.index - b.userData.index);
  assert.deepEqual(fronts.map((m) => m.name), ['drawer_front_01', 'drawer_front_02']);
  fronts.forEach((m) => {
    assert.equal(m.userData.panel.code, m.name);
    assert.ok(!m.userData.panel.code.endsWith('_18'), '抽面不应带 _18 后缀');
  });
});

test('150D: drawer_box_* 带 _18 后缀, code 与 name 一致', () => {
  const r = gen150D(1500, 2400);
  const boxes = r.drawers.children.filter((m) => m.userData.role !== 'drawer_front');
  boxes.forEach((m) => {
    assert.ok(m.name.endsWith('_18'), `${m.name} 缺 _18 后缀`);
    assert.equal(m.userData.panel.code, m.name);
  });
});

test('150D: 抽面 panel 长边=drawerW, 短边=200, 厚=18', () => {
  const r = gen150D(1500, 2400);
  const fronts = r.drawers.children.filter((m) => m.userData.role === 'drawer_front');
  fronts.forEach((m) => {
    const drawerW = m.scale.x * 450;
    assert.equal(m.userData.panel.length, Math.max(drawerW, 200));
    assert.equal(m.userData.panel.width, Math.min(drawerW, 200));
    assert.equal(m.userData.panel.thickness, 18);
  });
});

test('150D: 3 门抽屉 X 覆盖对应门组 (抽屉1=门1, 抽屉2=门2+3)', () => {
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const r = gen150D(1500, 2400);
  const fronts = r.drawers.children
    .filter((m) => m.userData.role === 'drawer_front')
    .sort((a, b) => a.userData.index - b.userData.index);
  const d1Left = sizeAndX.xOffsets[0];
  const d1Right = sizeAndX.xOffsets[0] + sizeAndX.doorWidths[0];
  assert.equal(fronts[0].position.x, (d1Left + d1Right) / 2);
  assert.equal(fronts[0].scale.x * 450, d1Right - d1Left);
  const d2Left = sizeAndX.xOffsets[1];
  const d2Right = sizeAndX.xOffsets[2] + sizeAndX.doorWidths[2];
  assert.equal(fronts[1].position.x, (d2Left + d2Right) / 2);
  assert.equal(fronts[1].scale.x * 450, d2Right - d2Left);
});

test('150D: 4 门抽屉 X 覆盖对应门组', () => {
  const sizeAndX = parts.calcDoorSizeAndX(1800, 4);
  const r = gen150D(1800, 2400);
  const fronts = r.drawers.children
    .filter((m) => m.userData.role === 'drawer_front')
    .sort((a, b) => a.userData.index - b.userData.index);
  const d1Left = sizeAndX.xOffsets[0];
  const d1Right = sizeAndX.xOffsets[1] + sizeAndX.doorWidths[1];
  assert.equal(fronts[0].position.x, (d1Left + d1Right) / 2);
  assert.equal(fronts[0].scale.x * 450, d1Right - d1Left);
  const d2Left = sizeAndX.xOffsets[2];
  const d2Right = sizeAndX.xOffsets[3] + sizeAndX.doorWidths[3];
  assert.equal(fronts[1].position.x, (d2Left + d2Right) / 2);
  assert.equal(fronts[1].scale.x * 450, d2Right - d2Left);
});

test('150D: 抽屉 mesh 材质非 null', () => {
  const r = gen150D(1500, 2400);
  r.drawers.children.forEach((m) => {
    assert.ok(m.material, `${m.name} material 为 null`);
  });
});

test('150D: 抽屉盒左侧板 X = 抽屉左沿 + 9, 高 200, 深 382', () => {
  const r = gen150D(1500, 2400);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const lefts = r.drawers.children
    .filter((m) => m.userData.role === 'drawer_box_left')
    .sort((a, b) => a.userData.index - b.userData.index);
  assert.equal(lefts[0].position.x, sizeAndX.xOffsets[0] + 9);
  assert.equal(lefts[0].scale.x, 18);
  assert.equal(lefts[0].scale.y, 200);
  assert.equal(lefts[0].scale.z, parts.DEPTH_INNER);
  assert.equal(lefts[1].position.x, sizeAndX.xOffsets[1] + 9);
});

test('150D: 抽屉盒右侧板 X = 抽屉右沿 - 9', () => {
  const r = gen150D(1500, 2400);
  const sizeAndX = parts.calcDoorSizeAndX(1500, 3);
  const rights = r.drawers.children
    .filter((m) => m.userData.role === 'drawer_box_right')
    .sort((a, b) => a.userData.index - b.userData.index);
  assert.equal(rights[0].position.x, sizeAndX.xOffsets[0] + sizeAndX.doorWidths[0] - 9);
  assert.equal(rights[1].position.x, sizeAndX.xOffsets[2] + sizeAndX.doorWidths[2] - 9);
});

test('150D: 抽屉盒底板 Y=[800,818], 厚 18mm', () => {
  const r = gen150D(1500, 2400);
  const bottoms = r.drawers.children.filter((m) => m.userData.role === 'drawer_box_bottom');
  bottoms.forEach((m) => {
    assert.equal(m.scale.y, 18);
    const bottom = m.position.y - m.scale.y / 2;
    const top = m.position.y + m.scale.y / 2;
    assert.equal(bottom, 800);
    assert.equal(top, 818);
  });
});

test('150D: 抽屉盒后板 Z 靠背 (后表面 = -DEPTH_INNER - 18)', () => {
  const r = gen150D(1500, 2400);
  const backs = r.drawers.children.filter((m) => m.userData.role === 'drawer_box_back');
  backs.forEach((m) => {
    assert.equal(m.scale.z, 18);
    const backFace = m.position.z - m.scale.z / 2;
    assert.equal(backFace, -18 - parts.DEPTH_INNER);
  });
});

test('150D: 抽屉盒后板高 182 (200 - 18), Y 在底板之上', () => {
  const r = gen150D(1500, 2400);
  const backs = r.drawers.children.filter((m) => m.userData.role === 'drawer_box_back');
  backs.forEach((m) => {
    assert.equal(m.scale.y, 182);
    const bottom = m.position.y - m.scale.y / 2;
    const top = m.position.y + m.scale.y / 2;
    assert.equal(bottom, 818);
    assert.equal(top, 1000);
  });
});

test('150D: 抽屉 mesh 类型分布', () => {
  const r = gen150D(1500, 2400);
  const rolesCount = {};
  r.drawers.children.forEach((m) => {
    rolesCount[m.userData.role] = (rolesCount[m.userData.role] || 0) + 1;
  });
  assert.deepEqual(rolesCount, {
    drawer_front: 2,
    drawer_box_left: 2,
    drawer_box_right: 2,
    drawer_box_back: 2,
    drawer_box_bottom: 2,
  });
});

test('150D: clearOldParts 递归销毁 drawer meshes', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const r = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos, { variant: 'd' });
  let visited = 0;
  r.drawers.traverse((n) => { if (n.isMesh) visited += 1; });
  assert.equal(visited, 10);
  parts.clearOldParts(r.root);
  assert.equal(r.root.children.length, 0);
});

test('150D: variant 未指定或非法 → 默认 150A (不含 drawers)', () => {
  const { THREE } = makeThreeMock();
  const geos = makeGeometries(THREE);
  const rA = parts.generateCabinetDynamicParts(THREE, 1500, 2400, geos);
  assert.equal(rA.root.userData.variant, 'a');
  assert.equal(rA.root.children.length, 7);
});
