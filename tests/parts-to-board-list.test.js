const test = require('node:test');
const assert = require('node:assert/strict');
const {
  partsToBoardList,
  _isDoorLike,
  _doorHeightMm,
  _hingeCountForHeight,
  _glassHingeCountForHeight,
  DOOR_BASE_H_MM,
  HINGE_HEIGHT_THRESHOLD_MM,
} = require('../miniprogram/utils/parts-to-board-list.js');

// 小 THREE mock (仅支撑 traverse + isMesh + userData + scale.y)
// meshDefs 支持: { code, length, width, thickness, heightMm?, material? } 或 { panel: {...}, scaleY: n, material? }
function makeMockRoot(meshDefs) {
  const children = meshDefs.map((def) => {
    const panel = def.panel || def;
    // 抽取额外字段 (heightMm / scaleY) 用于门高计算
    const scaleY = def.scaleY != null ? def.scaleY :
                   (panel.heightMm != null ? panel.heightMm / DOOR_BASE_H_MM : 1);
    const userData = { panel: panel };
    if (def.material) userData.material = def.material;
    return {
      isMesh: true,
      userData,
      scale: { x: 1, y: scaleY, z: 1 },
    };
  });
  return {
    traverse(cb) {
      cb(this);
      children.forEach((c) => cb(c));
    },
    isMesh: false,
    userData: {},
  };
}

test('_isDoorLike: 识别 door_* / *_door_* / drawer_front*', () => {
  assert.equal(_isDoorLike('door_lower_1'), true);
  assert.equal(_isDoorLike('door_middle_2'), true);
  assert.equal(_isDoorLike('door_upper_R_3'), true);
  assert.equal(_isDoorLike('lower_door_1'), true);   // 150A 命名
  assert.equal(_isDoorLike('upper_door_2'), true);
  assert.equal(_isDoorLike('drawer_front_01'), true);
  assert.equal(_isDoorLike('drawer_front_L_01'), true);
  // 抽屉盒板不算 door
  assert.equal(_isDoorLike('drawer_box_left_01_18'), false);
  assert.equal(_isDoorLike('drawer_box_back_01_18'), false);
  // 柜身板
  assert.equal(_isDoorLike('shelf_lower_1'), false);
  assert.equal(_isDoorLike('mid_divider_lower_1'), false);
  assert.equal(_isDoorLike('main_divider_LR'), false);
  assert.equal(_isDoorLike('back_panel_lower'), false);
  assert.equal(_isDoorLike('fixed_divider_up'), false);
  assert.equal(_isDoorLike(''), false);
  assert.equal(_isDoorLike(undefined), false);
});

test('partsToBoardList: 空 root 返回空 lists', () => {
  const r = partsToBoardList(null);
  assert.deepEqual(r.board_list, []);
  assert.deepEqual(r.door_list, []);
});

test('partsToBoardList: mesh 无 panel 时跳过', () => {
  const root = {
    traverse(cb) {
      cb({ isMesh: true, userData: {} });
      cb({ isMesh: true, userData: null });
      cb({ isMesh: false, userData: { panel: { code: 'x', length: 10, width: 10, thickness: 1.8 } } });
    },
  };
  const r = partsToBoardList(root);
  assert.deepEqual(r.board_list, []);
  assert.deepEqual(r.door_list, []);
});

test('partsToBoardList: mm→cm 转换 + area 计算 (mm×mm→m²)', () => {
  // 门 736mm × 296mm × 20mm → 73.6cm × 29.6cm × 2cm, area = 73.6*29.6/10000 = 0.21786m²
  // 层板 1164mm × 382mm × 18mm → 116.4cm × 38.2cm × 1.8cm, area = 116.4*38.2/10000 = 0.44464m²
  const root = makeMockRoot([
    { code: 'door_lower_1', length: 736, width: 296, thickness: 20 },
    { code: 'shelf_lower_1', length: 1164, width: 382, thickness: 18 },
  ]);
  const r = partsToBoardList(root);
  assert.equal(r.door_list.length, 1);
  assert.equal(r.board_list.length, 1);

  const door = r.door_list[0];
  assert.equal(door.node_name, 'door_lower_1');
  assert.equal(door.length, 73.6);
  assert.equal(door.width, 29.6);
  assert.equal(door.thickness, 2);
  assert.ok(Math.abs(door.area - 0.2179) < 0.001);

  const shelf = r.board_list[0];
  assert.equal(shelf.node_name, 'shelf_lower_1');
  assert.equal(shelf.length, 116.4);
  assert.equal(shelf.width, 38.2);
  assert.equal(shelf.thickness, 1.8);
  assert.ok(Math.abs(shelf.area - 0.4446) < 0.001);
});

test('partsToBoardList: 抽屉分类 (抽面进 door_list, 盒板进 board_list)', () => {
  const root = makeMockRoot([
    { code: 'drawer_front_01', length: 486, width: 200, thickness: 18 },
    { code: 'drawer_box_left_01_18', length: 382, width: 200, thickness: 18 },
    { code: 'drawer_box_right_01_18', length: 382, width: 200, thickness: 18 },
    { code: 'drawer_box_back_01_18', length: 450, width: 182, thickness: 18 },
    { code: 'drawer_box_bottom_01_18', length: 450, width: 364, thickness: 18 },
  ]);
  const r = partsToBoardList(root);
  assert.equal(r.door_list.length, 1);
  assert.equal(r.door_list[0].node_name, 'drawer_front_01');
  assert.equal(r.board_list.length, 4);
  const codes = r.board_list.map((b) => b.node_name).sort();
  assert.deepEqual(codes, [
    'drawer_box_back_01_18',
    'drawer_box_bottom_01_18',
    'drawer_box_left_01_18',
    'drawer_box_right_01_18',
  ]);
});

test('partsToBoardList: 完整书柜结构 (真实生成的 dyn root)', () => {
  const bs = require('../miniprogram/cabinet/utils/bookshelf-parts.js');
  // 复用 shoe 测试的 THREE mock
  function makeThreeMock() {
    class BoxGeometry {
      constructor(x, y, z) { this.parameters = { width: x, height: y, depth: z }; }
      clone() { return new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth); }
      dispose() {}
    }
    class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry; this.material = material || null;
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.name = ''; this.userData = {}; this.isMesh = true; this.parent = null; this.children = [];
      }
      add(child) { child.parent = this; this.children.push(child); }
      traverse(cb) { cb(this); this.children.forEach((c) => c.traverse && c.traverse(cb)); }
    }
    class Group extends Mesh {
      constructor() { super(null, null); this.isGroup = true; this.isMesh = false; }
    }
    class MeshStandardMaterial { constructor(opts) { Object.assign(this, opts || {}); } }
    return { Mesh, Group, BoxGeometry, MeshStandardMaterial };
  }
  const THREE = makeThreeMock();
  const geos = {
    doorGeometry: new THREE.BoxGeometry(450, 846, 18),
    shelfGeometry: new THREE.BoxGeometry(1, 1, 1),
    dividerGeometry: new THREE.BoxGeometry(1, 1, 1),
  };
  const r = bs.generateBookshelfDynamicParts(THREE, 1500, 2400, geos);
  const bl = partsToBoardList(r.root);

  // 书柜 1500x2400: 门 3 段 × 3 门 = 9 门 (door_list)
  assert.equal(bl.door_list.length, 9);
  // 层板 (下 1 + 中 3) + 中侧板 (下/中/上 × 2 = 6, N=3 门有 2 组边界) + 固定板 2 + 背板 3
  // 板件总数: 4 + 6 + 2 + 3 = 15
  assert.equal(bl.board_list.length, 15);
  // 所有条目应有 area > 0, length >= width, 板件 1.8cm / 门板 2cm
  [...bl.board_list, ...bl.door_list].forEach((entry) => {
    assert.ok(entry.area > 0, `${entry.node_name} area=${entry.area} not > 0`);
    assert.ok(entry.length >= entry.width, `${entry.node_name}: length(${entry.length}) < width(${entry.width})`);
  });
  bl.board_list.forEach((entry) => {
    assert.equal(entry.thickness, 1.8, `板件 ${entry.node_name} 应厚 1.8cm`);
  });
  bl.door_list.forEach((entry) => {
    assert.equal(entry.thickness, 2, `门板 ${entry.node_name} 应厚 2cm`);
  });
});

// ============ 五金规则 ============

test('_hingeCountForHeight: <800→2, ≥800→3', () => {
  assert.equal(_hingeCountForHeight(500), 2);
  assert.equal(_hingeCountForHeight(799), 2);
  assert.equal(_hingeCountForHeight(800), 3);
  assert.equal(_hingeCountForHeight(1000), 3);
  assert.equal(_hingeCountForHeight(2500), 3);
});

test('_glassHingeCountForHeight: ≤800→2, 801~1800→3, 1801+→4', () => {
  assert.equal(_glassHingeCountForHeight(500), 2);
  assert.equal(_glassHingeCountForHeight(800), 2);   // 边界: 800 走 2
  assert.equal(_glassHingeCountForHeight(801), 3);
  assert.equal(_glassHingeCountForHeight(1178), 3);  // 书柜中门实际高
  assert.equal(_glassHingeCountForHeight(1800), 3);  // 边界: 1800 走 3
  assert.equal(_glassHingeCountForHeight(1801), 4);
  assert.equal(_glassHingeCountForHeight(2400), 4);
  assert.equal(_glassHingeCountForHeight(3000), 4);  // 超出 2400 仍按 4
});

test('hardware_list: 玻璃门 h=1178 → glass_door_hinge=3 (不进 hinge)', () => {
  const root = makeMockRoot([
    { code: 'door_middle_1', length: 1178, width: 296, thickness: 20, heightMm: 1178, material: 'glass' },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, { glass_door_hinge: 3 });
});

test('hardware_list: 玻璃门 h=2000 → glass_door_hinge=4', () => {
  const root = makeMockRoot([
    { code: 'door_middle_1', length: 2000, width: 296, thickness: 20, heightMm: 2000, material: 'glass' },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, { glass_door_hinge: 4 });
});

test('hardware_list: 书柜 3 段 × 3 门 混合 → hinge=12 (下+上) + glass_door_hinge=9 (中)', () => {
  // 下门 h=736 → 2 铰 (普通); 中门 h=1178 → 3 铰 (玻璃); 上门 h=378 → 2 铰 (普通)
  const defs = [];
  [1, 2, 3].forEach((i) => {
    defs.push({ code: `door_lower_${i}`, length: 736, width: 385, thickness: 20, heightMm: 736 });
    defs.push({ code: `door_middle_${i}`, length: 1178, width: 385, thickness: 20, heightMm: 1178, material: 'glass' });
    defs.push({ code: `door_upper_${i}`, length: 378, width: 385, thickness: 20, heightMm: 378 });
  });
  const r = partsToBoardList(makeMockRoot(defs));
  assert.equal(r.hardware_list.hinge, 12);          // 3×(2+2)
  assert.equal(r.hardware_list.glass_door_hinge, 9); // 3×3
});

test('_doorHeightMm: 优先 heightMm, 兜底 scale.y * 846', () => {
  const meshExplicit = { userData: { panel: { heightMm: 828 } }, scale: { y: 0.5 } };
  assert.equal(_doorHeightMm(meshExplicit), 828);
  const meshFromScale = { userData: { panel: {} }, scale: { y: 736 / DOOR_BASE_H_MM } };
  assert.ok(Math.abs(_doorHeightMm(meshFromScale) - 736) < 1e-6);
});

test('hardware_list: 单扇门 h=736 → 2 铰链', () => {
  const root = makeMockRoot([
    { code: 'door_lower_1', length: 736, width: 296, thickness: 20, heightMm: 736 },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, { hinge: 2 });
});

test('hardware_list: 单扇门 h=1178 → 3 铰链 (书柜中门)', () => {
  const root = makeMockRoot([
    { code: 'door_middle_1', length: 1178, width: 296, thickness: 20, heightMm: 1178 },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, { hinge: 3 });
});

test('hardware_list: 混合 (3 短门 + 3 高门) → 2×3 + 3×3 = 15 铰链', () => {
  const root = makeMockRoot([
    { code: 'door_lower_1', length: 736, width: 385, thickness: 20, heightMm: 736 },
    { code: 'door_lower_2', length: 736, width: 385, thickness: 20, heightMm: 736 },
    { code: 'door_lower_3', length: 736, width: 385, thickness: 20, heightMm: 736 },
    { code: 'door_middle_1', length: 1178, width: 385, thickness: 20, heightMm: 1178 },
    { code: 'door_middle_2', length: 1178, width: 385, thickness: 20, heightMm: 1178 },
    { code: 'door_middle_3', length: 1178, width: 385, thickness: 20, heightMm: 1178 },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, { hinge: 15 });
});

test('hardware_list: 抽面 → 1 副托底轨 每个抽屉 (150D 2 抽屉 → slide=2)', () => {
  const root = makeMockRoot([
    { code: 'drawer_front_01', length: 486, width: 200, thickness: 20, heightMm: 200 },
    { code: 'drawer_front_02', length: 972, width: 200, thickness: 20, heightMm: 200 },
  ]);
  const r = partsToBoardList(root);
  // 抽面 h=200 < 800 但抽面走 slide 不走 hinge
  assert.equal(r.hardware_list.slide, 2);
  assert.equal(r.hardware_list.hinge, undefined);
});

test('hardware_list: 抽屉盒板 不算五金 (只统计 drawer_front 视觉件)', () => {
  const root = makeMockRoot([
    { code: 'drawer_front_01', length: 486, width: 200, thickness: 20, heightMm: 200 },
    { code: 'drawer_box_left_01_18', length: 382, width: 200, thickness: 18 },
    { code: 'drawer_box_right_01_18', length: 382, width: 200, thickness: 18 },
    { code: 'drawer_box_back_01_18', length: 450, width: 182, thickness: 18 },
    { code: 'drawer_box_bottom_01_18', length: 450, width: 364, thickness: 18 },
  ]);
  const r = partsToBoardList(root);
  assert.equal(r.hardware_list.slide, 1);
  assert.equal(r.hardware_list.hinge, undefined);
});

test('hardware_list: 门 + 抽屉共存 (150D 3门+2抽屉, h_lower=628, h_upper=926)', () => {
  const root = makeMockRoot([
    // 下门 3 扇 (h=628 < 800 → 2 铰)
    { code: 'lower_door_1', length: 628, width: 485, thickness: 20, heightMm: 628 },
    { code: 'lower_door_2', length: 628, width: 485, thickness: 20, heightMm: 628 },
    { code: 'lower_door_3', length: 628, width: 486, thickness: 20, heightMm: 628 },
    // 上门 3 扇 (h=926 ≥ 800 → 3 铰)
    { code: 'upper_door_1', length: 926, width: 485, thickness: 20, heightMm: 926 },
    { code: 'upper_door_2', length: 926, width: 485, thickness: 20, heightMm: 926 },
    { code: 'upper_door_3', length: 926, width: 486, thickness: 20, heightMm: 926 },
    // 抽屉 2 个 (150D 3 门场景)
    { code: 'drawer_front_01', length: 485, width: 200, thickness: 20, heightMm: 200 },
    { code: 'drawer_front_02', length: 973, width: 200, thickness: 20, heightMm: 200 },
  ]);
  const r = partsToBoardList(root);
  // 3×2 (下门) + 3×3 (上门) = 15
  assert.equal(r.hardware_list.hinge, 15);
  assert.equal(r.hardware_list.slide, 2);
});

test('hardware_list: 无门无抽屉 → 空对象', () => {
  const root = makeMockRoot([
    { code: 'shelf_lower_1', length: 1164, width: 382, thickness: 18 },
    { code: 'back_panel_lower', length: 704, width: 1164, thickness: 18 },
  ]);
  const r = partsToBoardList(root);
  assert.deepEqual(r.hardware_list, {});
});

test('hardware_list: 完整书柜集成 (1200x2400, 3门×3段=9门)', () => {
  const bs = require('../miniprogram/cabinet/utils/bookshelf-parts.js');
  function makeThreeMock() {
    class BoxGeometry {
      constructor(x, y, z) { this.parameters = { width: x, height: y, depth: z }; }
      clone() { return new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth); }
      dispose() {}
    }
    class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry; this.material = material || null;
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.name = ''; this.userData = {}; this.isMesh = true; this.parent = null; this.children = [];
      }
      add(child) { child.parent = this; this.children.push(child); }
      traverse(cb) { cb(this); this.children.forEach((c) => c.traverse && c.traverse(cb)); }
    }
    class Group extends Mesh {
      constructor() { super(null, null); this.isGroup = true; this.isMesh = false; }
    }
    class MeshStandardMaterial { constructor(opts) { Object.assign(this, opts || {}); } }
    return { Mesh, Group, BoxGeometry, MeshStandardMaterial };
  }
  const THREE = makeThreeMock();
  const geos = {
    doorGeometry: new THREE.BoxGeometry(450, 846, 18),
    shelfGeometry: new THREE.BoxGeometry(1, 1, 1),
    dividerGeometry: new THREE.BoxGeometry(1, 1, 1),
  };
  const r = bs.generateBookshelfDynamicParts(THREE, 1200, 2400, geos);
  const bl = partsToBoardList(r.root);
  // 书柜 1200×2400: 下门 h=736 (普通, <800→2铰), 中门 h=1178 (玻璃, ≤1800→3铰),
  //                上门 h=378 (普通, <800→2铰). 每段 3 扇 → hinge=3×(2+2)=12, glass_door_hinge=3×3=9
  assert.equal(bl.hardware_list.hinge, 12);
  assert.equal(bl.hardware_list.glass_door_hinge, 9);
  // 无抽屉
  assert.equal(bl.hardware_list.slide, undefined);
});
