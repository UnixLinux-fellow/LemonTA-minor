// 书柜参数化几何生成器。所有尺寸单位 mm。
// 依赖注入 THREE 便于 Node 测试环境 mock。
// 三段布局:
//   下段 [0, 800]     — 踢脚 60 + 门 736 + 1 层板
//   中段 [800, 2000]  — 玻璃门 1178 + 3 层板 (userData.material='glass')
//   上段 [2000, totalH] — 平开门 (无层板)
// fixed_divider_down 顶面 Y=800; fixed_divider_up 顶面 Y=2000.
// 每个 mesh 挂 userData.panel = { code, length, width, thickness } 供成本计算.

const common = require('./cabinet-common.js');
const SIDE_PANEL_THICK = common.SIDE_PANEL_THICK;
const GAP = common.GAP;
const _clampW = common._clampW;
const getDoorCount = common.getDoorCount;
const calcDoorSizeAndX = common.calcDoorSizeAndX;
const getDoorGroups = common.getDoorGroups;

// 族坐标 (mm)
const SKIRT_H_BS = 60;
const LOWER_H = 800;
const MIDDLE_H = 1200;
const LOWER_TOP_Y = LOWER_H;                       // 800 (fixed_divider_down 顶面)
const MIDDLE_TOP_Y = LOWER_H + MIDDLE_H;           // 2000 (fixed_divider_up 顶面)

// 深度契约 (同鞋柜)
const DEPTH_BODY = 400;
const DEPTH_TOTAL = 420;
const DEPTH_INNER = DEPTH_TOTAL - 38; // 382

function _makePlaceholderMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
}

function _cloneScaledMesh(THREE, baseGeometry, baseW, baseH, baseD, w, h, d) {
  const mesh = new THREE.Mesh(baseGeometry, _makePlaceholderMaterial(THREE));
  mesh.scale.set(w / baseW, h / baseH, d / baseD);
  return mesh;
}

function _attachPanel(mesh, code, w, h, d) {
  const dims = [w, h, d].slice().sort((a, b) => a - b);
  mesh.userData = mesh.userData || {};
  mesh.userData.panel = {
    code: code,
    length: dims[2],
    width: dims[1],
    thickness: dims[0],
  };
  return mesh;
}

function _tagPanel(mesh, code, length, width, thickness) {
  const L = Math.max(length, width);
  const W = Math.min(length, width);
  mesh.userData = mesh.userData || {};
  mesh.userData.panel = { code: code, length: L, width: W, thickness: thickness };
  return mesh;
}

// 门 group: 三段共享 xOffsets. 中门 mesh 加 userData.material='glass'.
//   下:  Y=[SKIRT_H_BS+GAP, LOWER_TOP_Y - GAP]     = [62, 798],   h=736
//   中:  Y=[LOWER_TOP_Y + 18 + GAP, MIDDLE_TOP_Y - GAP] = [820, 1998], h=1178 (玻璃)
//   上:  Y=[MIDDLE_TOP_Y + 18 + GAP, totalH - GAP] = [2020, totalH-2]
function createDoorGroup(THREE, totalWidth, totalHeight, sizeAndX, doorGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'doors' };

  const lowerYBottom = SKIRT_H_BS + GAP;
  const lowerYTop = LOWER_TOP_Y - GAP;
  const lowerH = lowerYTop - lowerYBottom;

  const middleYBottom = LOWER_TOP_Y + 18 + GAP;
  const middleYTop = MIDDLE_TOP_Y - GAP;
  const middleH = middleYTop - middleYBottom;

  const upperYBottom = MIDDLE_TOP_Y + 18 + GAP;
  const upperYTop = totalHeight - GAP;
  const upperH = upperYTop - upperYBottom;

  const doorZ = 9;

  sizeAndX.xOffsets.forEach((xOff, i) => {
    const w = sizeAndX.doorWidths[i];

    const lower = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, lowerH, 18);
    lower.position.set(xOff + w / 2, lowerYBottom + lowerH / 2, doorZ);
    lower.userData = { role: 'lower', index: i };
    lower.name = `door_lower_${i + 1}`;
    _tagPanel(lower, lower.name, Math.max(w, lowerH), Math.min(w, lowerH), 20);
    group.add(lower);

    const middle = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, middleH, 18);
    middle.position.set(xOff + w / 2, middleYBottom + middleH / 2, doorZ);
    middle.userData = { role: 'middle', index: i, material: 'glass' };
    middle.name = `door_middle_${i + 1}`;
    _tagPanel(middle, middle.name, Math.max(w, middleH), Math.min(w, middleH), 20);
    group.add(middle);

    const upper = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, upperH, 18);
    upper.position.set(xOff + w / 2, upperYBottom + upperH / 2, doorZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `door_upper_${i + 1}`;
    _tagPanel(upper, upper.name, Math.max(w, upperH), Math.min(w, upperH), 20);
    group.add(upper);
  });
  return group;
}

// 层板 group:
//   下段 1 块: Y = (SKIRT_H_BS + LOWER_TOP_Y) / 2 = 430
//   中段 3 块: 中段内空 [LOWER_TOP_Y + 18, MIDDLE_TOP_Y] = [818, 2000], 4 等分
//   上段 0 块
function createShelfGroup(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'shelves' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const xCenter = SIDE_PANEL_THICK + innerW / 2;
  const shelfZ = -18 - DEPTH_INNER / 2;

  // 下段 1 层, Y 中心 = (SKIRT_H_BS + LOWER_TOP_Y) / 2 = 430
  const lowerShelf = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, innerW, 18, DEPTH_INNER);
  lowerShelf.position.set(xCenter, (SKIRT_H_BS + LOWER_TOP_Y) / 2, shelfZ);
  lowerShelf.userData = { role: 'lower', index: 0 };
  lowerShelf.name = 'shelf_lower_1';
  _tagPanel(lowerShelf, lowerShelf.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
  group.add(lowerShelf);

  // 中段 3 层, 4 等分中段内空 (fixed_divider_down 顶面到 fixed_divider_up 底面之间)
  const midInnerBottom = LOWER_TOP_Y + 18;  // 818
  const midInnerTop = MIDDLE_TOP_Y;         // 2000 (fixed_divider_up 底面 = MIDDLE_TOP_Y)
  const midInner = midInnerTop - midInnerBottom; // 1182
  [0.25, 0.5, 0.75].forEach((frac, i) => {
    const mesh = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, innerW, 18, DEPTH_INNER);
    mesh.position.set(xCenter, midInnerBottom + midInner * frac, shelfZ);
    mesh.userData = { role: 'middle', index: i };
    mesh.name = `shelf_middle_${i + 1}`;
    _tagPanel(mesh, mesh.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
    group.add(mesh);
  });
  return group;
}

// 中侧板 group: 三段分别放中侧板, 数量 = doorCount - 1.
// 书柜规则: 每扇门一格 (支撑性要求, 不允许对开), 相邻两门之间必须有中侧板;
// 与鞋柜的对开门共享 getDoorGroups 逻辑不同, 书柜这里强制 groups=[1,1,...,1].
// 每处 X = xOffsets[boundaryDoorIdx] - GAP/2.
// 中侧板必须无缝贴合固定水平板 / 踢脚 / 顶板 —— 板件之间不允许有缝隙:
//   下段: 踢脚顶面 60 → fixed_divider_down 底面 782
//   中段: fixed_divider_down 顶面 800 → fixed_divider_up 底面 1982
//   上段: fixed_divider_up 顶面 2000 → top_plate 底面 totalH-18
function createDividerGroup(THREE, totalWidth, totalHeight, sizeAndX, dividerGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'dividers' };
  const doorCount = sizeAndX.doorWidths.length;
  const groups = new Array(doorCount).fill(1);
  const dividerZ = -18 - DEPTH_INNER / 2;

  // 三段的 Y 内空: 贴合上下水平结构, 不留 GAP.
  const lowerYBottom = SKIRT_H_BS;              // 60 (踢脚顶面)
  const lowerYTop = LOWER_TOP_Y - 18;           // 782 (fixed_divider_down 底面)
  const lowerH = lowerYTop - lowerYBottom;

  const middleYBottom = LOWER_TOP_Y;            // 800 (fixed_divider_down 顶面)
  const middleYTop = MIDDLE_TOP_Y - 18;         // 1982 (fixed_divider_up 底面)
  const middleH = middleYTop - middleYBottom;

  const upperYBottom = MIDDLE_TOP_Y;            // 2000 (fixed_divider_up 顶面)
  const upperYTop = totalHeight - 18;           // top_plate 底面
  const upperH = upperYTop - upperYBottom;

  let boundaryDoorIdx = 0;
  for (let k = 0; k < groups.length - 1; k++) {
    boundaryDoorIdx += groups[k];
    const xCenter = sizeAndX.xOffsets[boundaryDoorIdx] - GAP / 2;

    const l = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    l.scale.set(18, lowerH, DEPTH_INNER);
    l.position.set(xCenter, lowerYBottom + lowerH / 2, dividerZ);
    l.userData = { role: 'lower', index: k };
    l.name = `mid_divider_lower_${k + 1}`;
    _tagPanel(l, l.name, Math.max(lowerH, DEPTH_INNER), Math.min(lowerH, DEPTH_INNER), 18);
    group.add(l);

    const m = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    m.scale.set(18, middleH, DEPTH_INNER);
    m.position.set(xCenter, middleYBottom + middleH / 2, dividerZ);
    m.userData = { role: 'middle', index: k };
    m.name = `mid_divider_middle_${k + 1}`;
    _tagPanel(m, m.name, Math.max(middleH, DEPTH_INNER), Math.min(middleH, DEPTH_INNER), 18);
    group.add(m);

    const u = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    u.scale.set(18, upperH, DEPTH_INNER);
    u.position.set(xCenter, upperYBottom + upperH / 2, dividerZ);
    u.userData = { role: 'upper', index: k };
    u.name = `mid_divider_upper_${k + 1}`;
    _tagPanel(u, u.name, Math.max(upperH, DEPTH_INNER), Math.min(upperH, DEPTH_INNER), 18);
    group.add(u);
  }
  return group;
}

// 两块固定水平板:
//   fixed_divider_down: 顶面 Y=LOWER_TOP_Y=800, 板厚 18, 中心 791
//   fixed_divider_up:   顶面 Y=MIDDLE_TOP_Y=2000, 板厚 18, 中心 1991
function createFixedDividerGroup(THREE, totalWidth, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'fixedDividers' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const xCenter = SIDE_PANEL_THICK + innerW / 2;
  const shelfZ = -18 - DEPTH_INNER / 2;

  const down = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, innerW, 18, DEPTH_INNER);
  down.position.set(xCenter, LOWER_TOP_Y - 9, shelfZ);
  down.userData = { role: 'lower_top' };
  down.name = 'fixed_divider_down';
  _tagPanel(down, down.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
  group.add(down);

  const up = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, innerW, 18, DEPTH_INNER);
  up.position.set(xCenter, MIDDLE_TOP_Y - 9, shelfZ);
  up.userData = { role: 'middle_top' };
  up.name = 'fixed_divider_up';
  _tagPanel(up, up.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
  group.add(up);
  return group;
}

// 三段背板: 每段独立, X 铺满内宽, Z 后表面贴 -DEPTH_TOTAL.
//   下段: Y=[SKIRT_H_BS+18, LOWER_TOP_Y-18]     = [78, 782]
//   中段: Y=[LOWER_TOP_Y+18, MIDDLE_TOP_Y-18]   = [818, 1982]
//   上段: Y=[MIDDLE_TOP_Y+18, totalH-18]
function createBackPanelGroup(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'backPanels' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const xCenter = SIDE_PANEL_THICK + innerW / 2;
  const backZ = -DEPTH_TOTAL + 9;

  const segments = [
    { code: 'back_panel_lower',  yBottom: SKIRT_H_BS + 18, yTop: LOWER_TOP_Y - 18 },
    { code: 'back_panel_middle', yBottom: LOWER_TOP_Y + 18, yTop: MIDDLE_TOP_Y - 18 },
    { code: 'back_panel_upper',  yBottom: MIDDLE_TOP_Y + 18, yTop: totalHeight - 18 },
  ];
  segments.forEach((seg) => {
    const h = seg.yTop - seg.yBottom;
    const mesh = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, innerW, h, 18);
    mesh.position.set(xCenter, (seg.yBottom + seg.yTop) / 2, backZ);
    mesh.userData = { role: seg.code };
    mesh.name = seg.code;
    _tagPanel(mesh, seg.code, Math.max(innerW, h), Math.min(innerW, h), 18);
    group.add(mesh);
  });
  return group;
}

// 总入口
function generateBookshelfDynamicParts(THREE, totalWidth, totalHeight, geometries) {
  const w = _clampW(totalWidth);
  const h = totalHeight;
  const doorCount = getDoorCount(w);
  const sizeAndX = calcDoorSizeAndX(w, doorCount);
  const doors = createDoorGroup(THREE, w, h, sizeAndX, geometries.doorGeometry);
  const shelves = createShelfGroup(THREE, w, h, geometries.shelfGeometry);
  const dividers = createDividerGroup(THREE, w, h, sizeAndX, geometries.dividerGeometry);
  const fixedDividers = createFixedDividerGroup(THREE, w, geometries.shelfGeometry);
  const backPanels = createBackPanelGroup(THREE, w, h, geometries.shelfGeometry);
  const root = new THREE.Group();
  root.userData = { kind: 'bookshelfParts', totalWidth: w, totalHeight: h };
  root.add(doors);
  root.add(shelves);
  root.add(dividers);
  root.add(fixedDividers);
  root.add(backPanels);
  return { root, doors, shelves, dividers, fixedDividers, backPanels };
}

// 递归销毁 (同鞋柜)
function clearOldParts(root) {
  root.traverse((n) => {
    if (n === root) return;
    if (n.isMesh && n.geometry && typeof n.geometry.dispose === 'function') {
      n.geometry.dispose();
    }
  });
  while (root.children.length > 0) {
    const child = root.children[0];
    root.remove(child);
    if (child.children) child.children.length = 0;
  }
}

module.exports = {
  SKIRT_H_BS,
  LOWER_H,
  MIDDLE_H,
  LOWER_TOP_Y,
  MIDDLE_TOP_Y,
  DEPTH_BODY,
  DEPTH_TOTAL,
  DEPTH_INNER,
  SIDE_PANEL_THICK,
  GAP,
  createDoorGroup,
  createShelfGroup,
  createDividerGroup,
  createFixedDividerGroup,
  createBackPanelGroup,
  generateBookshelfDynamicParts,
  clearOldParts,
};
