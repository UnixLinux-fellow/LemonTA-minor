// 鞋柜参数化几何生成器。所有尺寸单位 mm。
// 依赖注入 THREE 便于 Node 测试环境 mock。
// 生成的 Group 由调用方 (three-renderer) 缩放到场景 cm 单位。

const common = require('./cabinet-common.js');
const SIDE_PANEL_THICK = common.SIDE_PANEL_THICK;
const GAP = common.GAP;
const WIDTH_MIN = common.WIDTH_MIN;
const WIDTH_MAX = common.WIDTH_MAX;
const _clampW = common._clampW;
const getDoorCount = common.getDoorCount;
const calcDoorSizeAndX = common.calcDoorSizeAndX;
const getDoorGroups = common.getDoorGroups;

const LOWER_CABINET_H = 850;
const SKIRT_H = 150;
const COUNTER_THICK = 50;
const VOID_H = 450;
const FIXED_H = SKIRT_H + LOWER_CABINET_H + COUNTER_THICK + VOID_H; // 1500
// 深度契约:
//   DEPTH_TOTAL = 420 (前后总跨度)
//   门板外挂 20mm (18mm 门厚 + 2mm 缝) + 背板 18mm = 38mm 扣除
//   DEPTH_INNER = 382 (层板/隔板深度)
const DEPTH_TOTAL = 420;
const DEPTH_INNER = DEPTH_TOTAL - 38;
// 门板 Y 对齐规则:
//   下柜门顶离台面底部 20mm (中间留缝);
//   上柜门底 "下盖" 上柜底面 28mm (门板向下伸出盖住悬空区顶端).
const LOWER_DOOR_TOP_GAP = 20;
const UPPER_DOOR_BOTTOM_OVERLAP = 28;

// 占位材质: three.js miniprogram 的 projectObject 对单材质分支不做 null 检查
// ((a=t.material).visible), material=null 会导致 "Cannot read property visible of null".
// _applyMaterial 也会跳过 !node.material 的节点, 所以必须在源头给一份可被后续着色覆盖的材质.
function _makePlaceholderMaterial(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
}

function _cloneScaledMesh(THREE, baseGeometry, baseW, baseH, baseD, w, h, d) {
  const mesh = new THREE.Mesh(baseGeometry, _makePlaceholderMaterial(THREE));
  mesh.scale.set(w / baseW, h / baseH, d / baseD);
  return mesh;
}

// 抽屉行常量 (150D 与 150C 共享)
// 150D: 抽屉贴台面底 (Y_TOP = SKIRT_H + LOWER_CABINET_H = 1000), 高 200 → Y=[800, 1000].
// 下门顶离抽屉底 LOWER_DOOR_TOP_GAP(20mm), Y=[152, 780].
const DRAWER_ROW_H = 200;
const DRAWER_Y_TOP = SKIRT_H + LOWER_CABINET_H;              // 1000
const DRAWER_Y_BOTTOM = DRAWER_Y_TOP - DRAWER_ROW_H;         // 800
const DRAWER_Y_CENTER = DRAWER_Y_BOTTOM + DRAWER_ROW_H / 2;  // 900

// 抽屉分组: 与 getDoorGroups 完全同规则 (奇→[1,2,2,...]; 偶→[2,2,...])
function getDrawerLayout(doorCount) {
  return getDoorGroups(doorCount);
}

// 挂 userData.panel (自动排序: length>=width, thickness=min dim)
// 用于运行时提取板件尺寸做成本计算.
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

// 挂 userData.panel (显式厚度版本, 用于 length/width 中不含厚度的场景, 如门板 20mm)
function _tagPanel(mesh, code, length, width, thickness) {
  const L = Math.max(length, width);
  const W = Math.min(length, width);
  mesh.userData = mesh.userData || {};
  mesh.userData.panel = { code: code, length: L, width: W, thickness: thickness };
  return mesh;
}

// 通用矩形板 (基几何为 1x1x1). dims: {x,y,z,w,h,d} 中心与尺寸(mm), panelThick 覆盖自动厚度判断.
function _makeBoard(THREE, baseGeometry, dims, code, panelThick) {
  const mesh = _cloneScaledMesh(THREE, baseGeometry, 1, 1, 1, dims.w, dims.h, dims.d);
  mesh.position.set(dims.x, dims.y, dims.z);
  mesh.name = code;
  const sorted = [dims.w, dims.h, dims.d].slice().sort((a, b) => a - b);
  _tagPanel(mesh, code, sorted[2], sorted[1], panelThick != null ? panelThick : sorted[0]);
  return mesh;
}

// 左柜下柜的 2 扇门 (共用给 150B/150C, 门 Y 段可变)
function _addLowerDoorsPair(THREE, group, doorGeometry, sizeAndX, yBottom, yTop, codePrefix) {
  const doorZ = 9;
  const h = yTop - yBottom;
  for (let i = 0; i < 2; i++) {
    const w = sizeAndX.doorWidths[i];
    const xOff = sizeAndX.xOffsets[i];
    const mesh = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, h, 18);
    mesh.position.set(xOff + w / 2, yBottom + h / 2, doorZ);
    const code = codePrefix + '_' + (i + 1);
    mesh.name = code;
    mesh.userData.role = 'lower';
    mesh.userData.index = i;
    _tagPanel(mesh, code, Math.max(w, h), Math.min(w, h), 20);
    group.add(mesh);
  }
}

// 在 [yBottom, yTop] Y 段 (活动区内空) 等分 n 层, 内宽 [xInnerLeft, xInnerRight].
function _addShelvesRange(THREE, group, shelfGeometry, xInnerLeft, xInnerRight, yBottom, yTop, count, codeMaker) {
  const shelfZ = -18 - DEPTH_INNER / 2;
  const w = xInnerRight - xInnerLeft;
  const xCenter = (xInnerLeft + xInnerRight) / 2;
  const inner = yTop - yBottom;
  for (let i = 0; i < count; i++) {
    const frac = (i + 1) / (count + 1);
    const mesh = _cloneScaledMesh(THREE, shelfGeometry, 1, 1, 1, w, 18, DEPTH_INNER);
    mesh.position.set(xCenter, yBottom + inner * frac, shelfZ);
    const code = codeMaker(i);
    mesh.name = code;
    mesh.userData.role = 'shelf';
    mesh.userData.index = i;
    _tagPanel(mesh, code, Math.max(w, DEPTH_INNER), Math.min(w, DEPTH_INNER), 18);
    group.add(mesh);
  }
}

// cavity (纯内空, 无侧板) 内的门宽/xOffset 计算. 起于 cavity 左边界内 GAP.
function _calcDoorLayoutInCavity(cavityW, doorCount) {
  const totalGap = GAP * (doorCount + 1);
  const usable = cavityW - totalGap;
  const baseW = Math.max(1, Math.floor(usable / doorCount));
  const remainder = usable - baseW * doorCount;
  const doorWidths = new Array(doorCount).fill(baseW);
  if (doorCount > 0) doorWidths[doorCount - 1] += remainder;
  const xOffsets = [];
  let cursor = GAP;
  for (let i = 0; i < doorCount; i++) {
    xOffsets.push(cursor);
    cursor += doorWidths[i] + GAP;
  }
  return { doorWidths, xOffsets };
}

// 门 group: 下门 + 上门, 每扇独立 Mesh, 位置为几何中心 (Three.js 约定)
// baseGeometry 尺寸约定 450 × 846 × 18 (来自 GLB door_sample)
// Y 对齐规则 (以 150S 为基模的所有鞋柜都遵守):
//   下门 Y=[SKIRT_H+GAP, SKIRT_H+LOWER_CABINET_H - LOWER_DOOR_TOP_GAP] = [152, 980]
//   上门 Y=[FIXED_H - UPPER_DOOR_BOTTOM_OVERLAP, totalH - GAP] = [1472, totalH-2]
function createDoorGroup(THREE, totalWidth, totalHeight, sizeAndX, doorGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'doors' };
  const lowerYBottom = SKIRT_H + GAP; // 152
  const lowerYTop = SKIRT_H + LOWER_CABINET_H - LOWER_DOOR_TOP_GAP; // 980
  const lowerDoorH = lowerYTop - lowerYBottom; // 828
  const upperYBottom = FIXED_H - UPPER_DOOR_BOTTOM_OVERLAP; // 1472
  const upperYTop = totalHeight - GAP;
  const upperDoorH = upperYTop - upperYBottom;
  const doorZ = 9;
  sizeAndX.xOffsets.forEach((xOff, i) => {
    const w = sizeAndX.doorWidths[i];
    const lower = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, lowerDoorH, 18);
    lower.position.set(xOff + w / 2, lowerYBottom + lowerDoorH / 2, doorZ);
    lower.userData = { role: 'lower', index: i };
    lower.name = `lower_door_${i + 1}`;
    _tagPanel(lower, lower.name, Math.max(w, lowerDoorH), Math.min(w, lowerDoorH), 20);
    group.add(lower);
    const upper = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, upperDoorH, 18);
    upper.position.set(xOff + w / 2, upperYBottom + upperDoorH / 2, doorZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `upper_door_${i + 1}`;
    _tagPanel(upper, upper.name, Math.max(w, upperDoorH), Math.min(w, upperDoorH), 20);
    group.add(upper);
  });
  return group;
}

// 中隔板 group: 按分组边界放, 分上下段. 对开门内部无中侧板.
// getDoorGroups 来自 cabinet-common.

function createDividerGroup(THREE, totalWidth, totalHeight, sizeAndX, dividerGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'dividers' };
  const upperH = totalHeight - FIXED_H;
  const lowerYBottom = SKIRT_H + GAP;
  const upperYBottom = FIXED_H + GAP;
  const lowerH = LOWER_CABINET_H;
  const doorCount = sizeAndX.doorWidths.length;
  // spec: 隔板正面 Z=-18 (藏在门后). mesh.position 是几何中心,
  // 深度 = DEPTH_INNER, 故中心 Z = -18 - DEPTH_INNER/2.
  const dividerZ = -18 - DEPTH_INNER / 2;
  const groups = getDoorGroups(doorCount);
  // 分组边界: 前 K 组门数之和处 (K=1..groups.length-1). 该位置的门 index 就是隔板右邻门.
  let boundaryDoorIdx = 0;
  for (let k = 0; k < groups.length - 1; k++) {
    boundaryDoorIdx += groups[k];
    const xCenter = sizeAndX.xOffsets[boundaryDoorIdx] - GAP / 2;
    const lower = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    lower.scale.set(18, lowerH, DEPTH_INNER);
    lower.position.set(xCenter, lowerYBottom + lowerH / 2 - GAP, dividerZ);
    lower.userData = { role: 'lower', index: k };
    lower.name = `mid_divider_lower_${k + 1}`;
    _tagPanel(lower, lower.name, Math.max(lowerH, DEPTH_INNER), Math.min(lowerH, DEPTH_INNER), 18);
    group.add(lower);
    const upper = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    upper.scale.set(18, upperH, DEPTH_INNER);
    upper.position.set(xCenter, upperYBottom + upperH / 2 - GAP, dividerZ);
    upper.userData = { role: 'upper', index: k };
    upper.name = `mid_divider_upper_${k + 1}`;
    _tagPanel(upper, upper.name, Math.max(upperH, DEPTH_INNER), Math.min(upperH, DEPTH_INNER), 18);
    group.add(upper);
  }
  return group;
}

// 层板 group:
// - 下柜固定 3 层, 内空 = LOWER_CABINET_H - 18*2 = 814, 4 等分
// - 上柜: upperH ≤ 800 → 1 层居中; > 800 → 2 层 3 等分
function createShelfGroup(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'shelves' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  // spec: 层板正面 Z=-18 (藏在门后). mesh.position 是几何中心,
  // 深度 = DEPTH_INNER, 故中心 Z = -18 - DEPTH_INNER/2.
  const shelfZ = -18 - DEPTH_INNER / 2;
  const lowerFloorTop = SKIRT_H + 18;
  const lowerInner = LOWER_CABINET_H - 18 * 2;
  [0.25, 0.5, 0.75].forEach((frac, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, lowerFloorTop + lowerInner * frac, shelfZ);
    mesh.userData = { role: 'lower', index: i };
    mesh.name = `shelf_lower_${i + 1}`;
    _tagPanel(mesh, mesh.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
    group.add(mesh);
  });
  const upperH = totalHeight - FIXED_H;
  const upperFloorTop = FIXED_H + 18;
  const upperInner = upperH - 18 * 2;
  const upperFracs = upperH <= 800 ? [0.5] : [1 / 3, 2 / 3];
  upperFracs.forEach((frac, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, upperFloorTop + upperInner * frac, shelfZ);
    mesh.userData = { role: 'upper', index: i };
    mesh.name = `shelf_upper_${i + 1}`;
    _tagPanel(mesh, mesh.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
    group.add(mesh);
  });
  return group;
}

// 悬空区上下的两块固定水平板 (原 GLB 里的 shelf_fixed_down / shelf_fixed_up).
// GLB 里的版本会随 shell 的 sy 拉伸整体位移: 墙 220cm 时它们会跑到 Y=89.9 / 137.5,
// 和参数化门的绝对定位对不上, 用户看起来就像"底柜顶板/上柜底板消失了".
// 所以从 shell 里剔掉, 由这里按绝对 mm 位置重建, 和门/隔/层用同一套坐标.
function createFixedDividerGroup(THREE, totalWidth, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'fixedDividers' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const shelfZ = -18 - DEPTH_INNER / 2;
  // 底柜顶板: 顶面 Y = SKIRT_H + LOWER_CABINET_H = 1000, 板厚 18, 中心 991.
  const lower = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  lower.scale.set(innerW, 18, DEPTH_INNER);
  lower.position.set(SIDE_PANEL_THICK + innerW / 2, SKIRT_H + LOWER_CABINET_H - 9, shelfZ);
  lower.userData = { role: 'lower_top' };
  lower.name = 'shelf_fixed_down';
  _tagPanel(lower, lower.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
  group.add(lower);
  // 上柜底板: 底面 Y = FIXED_H = 1500, 板厚 18, 中心 1509.
  const upper = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  upper.scale.set(innerW, 18, DEPTH_INNER);
  upper.position.set(SIDE_PANEL_THICK + innerW / 2, FIXED_H + 9, shelfZ);
  upper.userData = { role: 'upper_bottom' };
  upper.name = 'shelf_fixed_up';
  _tagPanel(upper, upper.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
  group.add(upper);
  return group;
}

// 下柜背板 + 中间镂空背板: Y 上下界全固定 (不随 totalH 变化).
//   下柜背板 Y=[SKIRT_H+18, SKIRT_H+LOWER_CABINET_H-18] = [168, 982],  即紧贴 bottom_plate 顶面 → shelf_fixed_down 底面.
//   中间背板 Y=[SKIRT_H+LOWER_CABINET_H, FIXED_H]        = [1000,1500], 即紧贴 shelf_fixed_down 顶面 → shelf_fixed_up 底面.
// X 铺满内宽; Z 靠背, 与 createUpperBackPanelGroup 一致 (后表面 Z=-DEPTH_TOTAL).
function createFixedBackPanelGroup(THREE, totalWidth, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'fixedBackPanels' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const xCenter = SIDE_PANEL_THICK + innerW / 2;
  const zCenter = -DEPTH_TOTAL + 9;

  const lowerBottom = SKIRT_H + 18;                    // 168
  const lowerTop = SKIRT_H + LOWER_CABINET_H - 18;     // 982
  const lowerH = lowerTop - lowerBottom;               // 814
  const lower = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  lower.scale.set(innerW, lowerH, 18);
  lower.position.set(xCenter, (lowerBottom + lowerTop) / 2, zCenter);
  lower.userData = { role: 'lower_back' };
  lower.name = 'back_panel_lower';
  _tagPanel(lower, lower.name, Math.max(innerW, lowerH), Math.min(innerW, lowerH), 18);
  group.add(lower);

  const middleBottom = SKIRT_H + LOWER_CABINET_H;      // 1000
  const middleTop = FIXED_H;                           // 1500
  const middleH = middleTop - middleBottom;            // 500
  const middle = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  middle.scale.set(innerW, middleH, 18);
  middle.position.set(xCenter, (middleBottom + middleTop) / 2, zCenter);
  middle.userData = { role: 'middle_back' };
  middle.name = 'back_panel_middle';
  _tagPanel(middle, middle.name, Math.max(innerW, middleH), Math.min(innerW, middleH), 18);
  group.add(middle);

  return group;
}

// 上柜后背板: 底面 Y = FIXED_H + 18 = 1518 (shelf_fixed_up 顶面), 顶面 Y = totalH - 18 (top_plate 底面).
// 板厚 18mm 靠背, 后表面 Z=-DEPTH_TOTAL, 前表面 Z=-DEPTH_TOTAL+18=-382, 中心 Z=-391.
// X 铺满两侧板内宽 (totalWidth - 36), 与下柜/中间背板同宽.
function createUpperBackPanelGroup(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'upperBackPanel' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const bottomY = FIXED_H + 18; // 1518
  const topY = totalHeight - 18;
  const h = topY - bottomY;
  const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  mesh.scale.set(innerW, h, 18);
  mesh.position.set(
    SIDE_PANEL_THICK + innerW / 2,
    (bottomY + topY) / 2,
    -DEPTH_TOTAL + 9
  );
  mesh.userData = { role: 'upper_back' };
  mesh.name = 'back_panel_upper';
  _tagPanel(mesh, mesh.name, Math.max(innerW, h), Math.min(innerW, h), 18);
  group.add(mesh);
  return group;
}

// 台面: 露在外面的水平板, 底面 Y = SKIRT_H + LOWER_CABINET_H = 1000, 厚 50, 中心 1025.
// X 铺满外宽 (与 GLB 里原 countertop 尺寸一致), Z 铺满外深 (DEPTH_TOTAL), 前面对齐正面 Z=0.
// 因此中心 X = totalWidth/2, 中心 Z = -DEPTH_TOTAL/2.
function createCounterGroup(THREE, totalWidth, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'counter' };
  const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  mesh.scale.set(totalWidth, COUNTER_THICK, DEPTH_TOTAL);
  mesh.position.set(
    totalWidth / 2,
    SKIRT_H + LOWER_CABINET_H + COUNTER_THICK / 2,
    -DEPTH_TOTAL / 2
  );
  mesh.userData = { role: 'counter' };
  mesh.name = 'countertop';
  _tagPanel(mesh, mesh.name, Math.max(totalWidth, DEPTH_TOTAL), Math.min(totalWidth, DEPTH_TOTAL), COUNTER_THICK);
  group.add(mesh);
  return group;
}

// 150A: 现有的下柜+悬空+上柜结构 (踢脚150 + 下柜850 + 台面50 + 悬空450 + 上柜)
function _generate150A(THREE, w, h, geometries) {
  const doorCount = getDoorCount(w);
  const sizeAndX = calcDoorSizeAndX(w, doorCount);
  const doors = createDoorGroup(THREE, w, h, sizeAndX, geometries.doorGeometry);
  const dividers = createDividerGroup(THREE, w, h, sizeAndX, geometries.dividerGeometry);
  const shelves = createShelfGroup(THREE, w, h, geometries.shelfGeometry);
  const fixedDividers = createFixedDividerGroup(THREE, w, geometries.shelfGeometry);
  const counter = createCounterGroup(THREE, w, geometries.shelfGeometry);
  const upperBackPanel = createUpperBackPanelGroup(THREE, w, h, geometries.shelfGeometry);
  const fixedBackPanels = createFixedBackPanelGroup(THREE, w, geometries.shelfGeometry);
  const root = new THREE.Group();
  root.userData = { kind: 'shoeCabinetParts', totalWidth: w, totalHeight: h, variant: 'a' };
  root.add(doors);
  root.add(dividers);
  root.add(shelves);
  root.add(fixedDividers);
  root.add(counter);
  root.add(upperBackPanel);
  root.add(fixedBackPanels);
  return { root, doors, dividers, shelves, fixedDividers, counter, upperBackPanel, fixedBackPanels };
}

// 150B: 左右分柜, 主分割板贯穿全高. 左=2门+悬空+开放区, 右=独立门数直通.
function _generate150B(THREE, w, h, geometries) {
  const shelfG = geometries.shelfGeometry;
  const doorG = geometries.doorGeometry;
  const shelfZ = -18 - DEPTH_INNER / 2;
  const backZ = -DEPTH_TOTAL + 9;

  const root = new THREE.Group();
  root.userData = { kind: 'shoeCabinetParts', totalWidth: w, totalHeight: h, variant: 'b' };

  const doorsG = new THREE.Group();          doorsG.userData = { kind: 'doors' };
  const dividersG = new THREE.Group();       dividersG.userData = { kind: 'dividers' };
  const shelvesG = new THREE.Group();        shelvesG.userData = { kind: 'shelves' };
  const fixedDividersG = new THREE.Group();  fixedDividersG.userData = { kind: 'fixedDividers' };
  const counterG = new THREE.Group();        counterG.userData = { kind: 'counter' };
  const upperBackPanelG = new THREE.Group(); upperBackPanelG.userData = { kind: 'upperBackPanel' };
  const fixedBackPanelsG = new THREE.Group();fixedBackPanelsG.userData = { kind: 'fixedBackPanels' };
  const drawersG = new THREE.Group();        drawersG.userData = { kind: 'drawers' };

  const outerDoorCount = getDoorCount(w);
  const outerSizeAndX = calcDoorSizeAndX(w, outerDoorCount);

  // 主分割板 X 位置
  let leftW;
  if (outerDoorCount >= 3) {
    leftW = outerSizeAndX.xOffsets[2] - GAP / 2;
  } else {
    leftW = w / 2; // 兜底: 中点对分
  }
  const dividerX = leftW;
  const mainDivider = _makeBoard(
    THREE, shelfG,
    { x: dividerX, y: (SKIRT_H + h) / 2, z: shelfZ,
      w: 18, h: h - SKIRT_H, d: DEPTH_INNER },
    'main_divider_LR', 18
  );
  mainDivider.userData.role = 'main_divider';
  dividersG.add(mainDivider);

  // ---- 左柜 ----
  let leftDoorSizeAndX;
  if (outerDoorCount >= 3) {
    leftDoorSizeAndX = {
      doorWidths: [outerSizeAndX.doorWidths[0], outerSizeAndX.doorWidths[1]],
      xOffsets: [outerSizeAndX.xOffsets[0], outerSizeAndX.xOffsets[1]],
    };
  } else {
    const innerL = leftW - SIDE_PANEL_THICK - 9 - GAP * 2;
    leftDoorSizeAndX = {
      doorWidths: [innerL],
      xOffsets: [SIDE_PANEL_THICK + GAP],
    };
  }

  const leftInnerXL = SIDE_PANEL_THICK;
  const leftInnerXR = leftW - 9;
  const leftInnerW = leftInnerXR - leftInnerXL;

  const lowerYBottom = SKIRT_H + GAP;
  const lowerYTop = SKIRT_H + LOWER_CABINET_H - LOWER_DOOR_TOP_GAP;
  if (outerDoorCount >= 3) {
    _addLowerDoorsPair(THREE, doorsG, doorG, leftDoorSizeAndX,
      lowerYBottom, lowerYTop, 'door_lower_L');
  } else {
    const dh = lowerYTop - lowerYBottom;
    const ww = leftDoorSizeAndX.doorWidths[0];
    const xOff = leftDoorSizeAndX.xOffsets[0];
    const mesh = _cloneScaledMesh(THREE, doorG, 450, 846, 18, ww, dh, 18);
    mesh.position.set(xOff + ww / 2, lowerYBottom + dh / 2, 9);
    mesh.name = 'door_lower_L_1';
    mesh.userData.role = 'lower'; mesh.userData.index = 0;
    _tagPanel(mesh, 'door_lower_L_1', Math.max(ww, dh), Math.min(ww, dh), 20);
    doorsG.add(mesh);
  }

  _addShelvesRange(THREE, shelvesG, shelfG, leftInnerXL, leftInnerXR,
    SKIRT_H + 18, SKIRT_H + LOWER_CABINET_H - 18, 3,
    (i) => 'shelf_lower_L_' + (i + 1));

  const leftLowerTop = _makeBoard(THREE, shelfG,
    { x: (leftInnerXL + leftInnerXR) / 2, y: SKIRT_H + LOWER_CABINET_H - 9, z: shelfZ,
      w: leftInnerW, h: 18, d: DEPTH_INNER },
    'shelf_fixed_down_L', 18);
  leftLowerTop.userData.role = 'lower_top';
  fixedDividersG.add(leftLowerTop);

  const leftCounter = _makeBoard(THREE, shelfG,
    { x: leftW / 2, y: SKIRT_H + LOWER_CABINET_H + COUNTER_THICK / 2, z: -DEPTH_TOTAL / 2,
      w: leftW, h: COUNTER_THICK, d: DEPTH_TOTAL },
    'countertop_L', 50);
  leftCounter.userData.role = 'counter';
  counterG.add(leftCounter);

  // 左柜台面以上无 shelf_fixed_up_L, 整段镂空到顶.
  // 台面以上一整块 18mm 背板 (Y=[1000, h-18]), 无板缝.
  const leftBackXCenter = (leftInnerXL + leftInnerXR) / 2;
  fixedBackPanelsG.add(_makeBoard(THREE, shelfG,
    { x: leftBackXCenter, y: (168 + 982) / 2, z: backZ,
      w: leftInnerW, h: 982 - 168, d: 18 },
    'back_panel_lower_L', 18));
  const upperBackYBottom = SKIRT_H + LOWER_CABINET_H; // 1000 = 台面底面
  const upperBackYTop = h - 18;
  upperBackPanelG.add(_makeBoard(THREE, shelfG,
    { x: leftBackXCenter, y: (upperBackYBottom + upperBackYTop) / 2, z: backZ,
      w: leftInnerW, h: upperBackYTop - upperBackYBottom, d: 18 },
    'back_panel_upper_L', 18));

  // ---- 右柜 ----
  // 需求: 右下柜顶板顶面与左柜台面顶面齐平.
  // 左柜台面顶面 = SKIRT_H + LOWER_CABINET_H + COUNTER_THICK = 1050.
  // 踢脚 150 不变 → 右下柜净高 = 1050 - 150 = 900.
  const RIGHT_LOWER_H = 900;
  const rightInnerXL = leftW + 9;
  const rightInnerXR = w - SIDE_PANEL_THICK;
  const rightInnerW = rightInnerXR - rightInnerXL;
  const rightInnerXCenter = (rightInnerXL + rightInnerXR) / 2;

  let rightDoorCount;
  if (outerDoorCount >= 3) {
    rightDoorCount = getDoorCount(rightInnerW + SIDE_PANEL_THICK * 2);
  } else {
    rightDoorCount = 1;
  }
  if (!rightDoorCount || rightDoorCount < 1) rightDoorCount = 1;

  const rDoorSizeAndX = _calcDoorLayoutInCavity(rightInnerW, rightDoorCount);
  const rXOffsets = rDoorSizeAndX.xOffsets.map((x) => x + rightInnerXL);

  // 中侧板 X (相对右柜内空左边界). 奇数门 → [1,2,2,...]; 偶数 → [2,2,...].
  const rGroups = getDoorGroups(rightDoorCount);
  const rDividerXs = [];
  let rBoundaryIdx = 0;
  for (let k = 0; k < rGroups.length - 1; k++) {
    rBoundaryIdx += rGroups[k];
    rDividerXs.push(rXOffsets[rBoundaryIdx] - GAP / 2);
  }

  // R_1 (最左门) 左沿覆盖主分割板 18mm: 左移 18, 宽 +18.
  // 门左沿最终 = leftW - 9 + GAP = 主分割板左外面 + 2mm 缝.
  const rLowerYBottom = SKIRT_H + GAP;
  const rLowerYTop = SKIRT_H + RIGHT_LOWER_H - LOWER_DOOR_TOP_GAP;
  const rLowerH = rLowerYTop - rLowerYBottom;
  for (let i = 0; i < rightDoorCount; i++) {
    let ww = rDoorSizeAndX.doorWidths[i];
    let xLeft = rXOffsets[i];
    if (i === 0) { xLeft -= 18; ww += 18; }
    const mesh = _cloneScaledMesh(THREE, doorG, 450, 846, 18, ww, rLowerH, 18);
    mesh.position.set(xLeft + ww / 2, rLowerYBottom + rLowerH / 2, 9);
    const code = 'door_lower_R_' + (i + 1);
    mesh.name = code;
    mesh.userData.role = 'lower'; mesh.userData.index = i;
    _tagPanel(mesh, code, Math.max(ww, rLowerH), Math.min(ww, rLowerH), 20);
    doorsG.add(mesh);
  }

  _addShelvesRange(THREE, shelvesG, shelfG, rightInnerXL, rightInnerXR,
    SKIRT_H + 18, SKIRT_H + RIGHT_LOWER_H - 18, 3,
    (i) => 'shelf_lower_R_' + (i + 1));

  const rFixedTop = _makeBoard(THREE, shelfG,
    { x: rightInnerXCenter, y: SKIRT_H + RIGHT_LOWER_H - 9, z: shelfZ,
      w: rightInnerW, h: 18, d: DEPTH_INNER },
    'shelf_fixed_R', 18);
  rFixedTop.userData.role = 'fixed_middle';
  fixedDividersG.add(rFixedTop);

  // 右柜下柜中侧板 (Y 覆盖踢脚顶到下柜顶板底面)
  const rLowerDivBottom = SKIRT_H;
  const rLowerDivTop = SKIRT_H + RIGHT_LOWER_H - 18;
  rDividerXs.forEach((xC, k) => {
    const mesh = _makeBoard(THREE, geometries.dividerGeometry,
      { x: xC, y: (rLowerDivBottom + rLowerDivTop) / 2, z: shelfZ,
        w: 18, h: rLowerDivTop - rLowerDivBottom, d: DEPTH_INNER },
      'mid_divider_lower_R_' + (k + 1), 18);
    mesh.userData.role = 'lower';
    mesh.userData.index = k;
    dividersG.add(mesh);
  });

  const rUpperYBottom = SKIRT_H + RIGHT_LOWER_H + GAP;
  const rUpperYTop = h - GAP;
  const rUpperH = rUpperYTop - rUpperYBottom;
  for (let i = 0; i < rightDoorCount; i++) {
    let ww = rDoorSizeAndX.doorWidths[i];
    let xLeft = rXOffsets[i];
    if (i === 0) { xLeft -= 18; ww += 18; }
    const mesh = _cloneScaledMesh(THREE, doorG, 450, 846, 18, ww, rUpperH, 18);
    mesh.position.set(xLeft + ww / 2, rUpperYBottom + rUpperH / 2, 9);
    const code = 'door_upper_R_' + (i + 1);
    mesh.name = code;
    mesh.userData.role = 'upper'; mesh.userData.index = i;
    _tagPanel(mesh, code, Math.max(ww, rUpperH), Math.min(ww, rUpperH), 20);
    doorsG.add(mesh);
  }

  const rUpperCavityBottom = SKIRT_H + RIGHT_LOWER_H + 18;
  const rUpperCavityTop = h - 18;
  const rUpperCavityH = h - (SKIRT_H + RIGHT_LOWER_H);
  const rUpperShelfCount = rUpperCavityH <= 800 ? 1 : 2;
  _addShelvesRange(THREE, shelvesG, shelfG, rightInnerXL, rightInnerXR,
    rUpperCavityBottom, rUpperCavityTop, rUpperShelfCount,
    (i) => 'shelf_upper_R_' + (i + 1));

  // 右柜上柜中侧板 (Y 覆盖下柜顶板顶面到顶板底面)
  const rUpperDivBottom = SKIRT_H + RIGHT_LOWER_H;
  const rUpperDivTop = h - 18;
  rDividerXs.forEach((xC, k) => {
    const mesh = _makeBoard(THREE, geometries.dividerGeometry,
      { x: xC, y: (rUpperDivBottom + rUpperDivTop) / 2, z: shelfZ,
        w: 18, h: rUpperDivTop - rUpperDivBottom, d: DEPTH_INNER },
      'mid_divider_upper_R_' + (k + 1), 18);
    mesh.userData.role = 'upper';
    mesh.userData.index = k;
    dividersG.add(mesh);
  });

  fixedBackPanelsG.add(_makeBoard(THREE, shelfG,
    { x: rightInnerXCenter, y: (SKIRT_H + 18 + SKIRT_H + RIGHT_LOWER_H - 18) / 2, z: backZ,
      w: rightInnerW, h: RIGHT_LOWER_H - 36, d: 18 },
    'back_panel_lower_R', 18));
  upperBackPanelG.add(_makeBoard(THREE, shelfG,
    { x: rightInnerXCenter, y: (rUpperCavityBottom + rUpperCavityTop) / 2, z: backZ,
      w: rightInnerW, h: rUpperCavityTop - rUpperCavityBottom, d: 18 },
    'back_panel_upper_R', 18));

  root.add(doorsG); root.add(dividersG); root.add(shelvesG);
  root.add(fixedDividersG); root.add(counterG);
  root.add(upperBackPanelG); root.add(fixedBackPanelsG); root.add(drawersG);

  return {
    root,
    doors: doorsG, dividers: dividersG, shelves: shelvesG,
    fixedDividers: fixedDividersG, counter: counterG,
    upperBackPanel: upperBackPanelG, fixedBackPanels: fixedBackPanelsG,
    drawers: drawersG,
  };
}

// 150C: = 150B + 左下柜抽屉排 (踢脚 150 + 门 650 + 抽屉 200 + 台面 50)
function _generate150C(THREE, w, h, geometries) {
  const built = _generate150B(THREE, w, h, geometries);
  built.root.userData.variant = 'c';

  const doorG = geometries.doorGeometry;
  const shelfG = geometries.shelfGeometry;

  // 1. 移除左下柜 2 扇门, 重画为 h=646 (Y=[152, 798])
  const leftLowerDoorCodes = ['door_lower_L_1', 'door_lower_L_2'];
  const oldDoors = built.doors.children.filter((m) => leftLowerDoorCodes.indexOf(m.name) >= 0);
  const doorMeta = oldDoors.map((m) => ({
    x: m.position.x, name: m.name, w: 450 * m.scale.x,
  }));
  oldDoors.forEach((m) => { built.doors.remove(m); });

  // 2. 抽屉行 (Y=[802, 998], h=196)
  const drawerFrontW = doorMeta.reduce((s, dm) => s + dm.w, 0) + GAP;
  const drawerFrontXCenter = doorMeta.length > 0
    ? (doorMeta[0].x - doorMeta[0].w / 2 + doorMeta[doorMeta.length - 1].x + doorMeta[doorMeta.length - 1].w / 2) / 2
    : (SIDE_PANEL_THICK + drawerFrontW / 2);

  const drawerYBottom = 800 + GAP;   // 802
  const drawerYTop = 1000 - GAP;     // 998
  const drawerH = drawerYTop - drawerYBottom; // 196

  // 门顶离抽面底 LOWER_DOOR_TOP_GAP=20mm 让位 (开门 + 抽屉不相撞).
  const cDoorYBottom = SKIRT_H + GAP;                       // 152
  const cDoorYTop = drawerYBottom - LOWER_DOOR_TOP_GAP;     // 782
  const cDoorH = cDoorYTop - cDoorYBottom;                  // 630
  doorMeta.forEach((dm, i) => {
    const mesh = _cloneScaledMesh(THREE, doorG, 450, 846, 18, dm.w, cDoorH, 18);
    mesh.position.set(dm.x, cDoorYBottom + cDoorH / 2, 9);
    mesh.name = dm.name;
    mesh.userData.role = 'lower'; mesh.userData.index = i;
    _tagPanel(mesh, dm.name, Math.max(dm.w, cDoorH), Math.min(dm.w, cDoorH), 20);
    built.doors.add(mesh);
  });

  const frontMesh = _cloneScaledMesh(THREE, doorG, 450, 846, 18, drawerFrontW, drawerH, 18);
  frontMesh.position.set(drawerFrontXCenter, drawerYBottom + drawerH / 2, 9);
  frontMesh.name = 'drawer_front_L_01';
  frontMesh.userData.role = 'drawer_front';
  _tagPanel(frontMesh, 'drawer_front_L_01',
    Math.max(drawerFrontW, drawerH), Math.min(drawerFrontW, drawerH), 20);
  built.drawers.add(frontMesh);

  // 3. 抽屉盒 4 板 (滑轨预留每侧 20mm, 盒外宽 = 抽面 - 40)
  const boxDepth = DEPTH_INNER;
  const boxOuterW = drawerFrontW - 40;
  const boxOuterH = drawerH - 20;
  const boxYCenter = drawerYBottom + drawerH / 2;
  const boxZFront = -18;
  const boxZCenter = boxZFront - boxDepth / 2;

  const boxLeft = _makeBoard(THREE, shelfG,
    { x: drawerFrontXCenter - boxOuterW / 2 + 9, y: boxYCenter, z: boxZCenter,
      w: 18, h: boxOuterH, d: boxDepth },
    'drawer_box_left_01_18', 18);
  boxLeft.userData.role = 'drawer_box_side';
  built.drawers.add(boxLeft);

  const boxRight = _makeBoard(THREE, shelfG,
    { x: drawerFrontXCenter + boxOuterW / 2 - 9, y: boxYCenter, z: boxZCenter,
      w: 18, h: boxOuterH, d: boxDepth },
    'drawer_box_right_01_18', 18);
  boxRight.userData.role = 'drawer_box_side';
  built.drawers.add(boxRight);

  const backW = boxOuterW - 36;
  const boxBack = _makeBoard(THREE, shelfG,
    { x: drawerFrontXCenter, y: boxYCenter, z: boxZFront - boxDepth + 9,
      w: backW, h: boxOuterH, d: 18 },
    'drawer_box_back_01_18', 18);
  boxBack.userData.role = 'drawer_box_back';
  built.drawers.add(boxBack);

  const bottomW = boxOuterW - 36;
  const bottomD = boxDepth - 18;
  const boxBottom = _makeBoard(THREE, shelfG,
    { x: drawerFrontXCenter, y: boxYCenter - boxOuterH / 2 + 9, z: boxZFront - bottomD / 2,
      w: bottomW, h: 18, d: bottomD },
    'drawer_box_bottom_01_18', 18);
  boxBottom.userData.role = 'drawer_box_bottom';
  built.drawers.add(boxBottom);

  return built;
}

// 与 createDoorGroup 同结构, 但下门顶让位抽屉行, Y=[152, 780].
// 抽屉贴台面底 (Y_TOP=1000), 下门顶 = 抽屉底 - LOWER_DOOR_TOP_GAP = 800 - 20 = 780.
function _createDoorGroupWithDrawerRow(THREE, totalWidth, totalHeight, sizeAndX, doorGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'doors' };
  const lowerYBottom = SKIRT_H + GAP;                                            // 152
  const lowerYTop = DRAWER_Y_BOTTOM - LOWER_DOOR_TOP_GAP;                        // 780
  const lowerDoorH = lowerYTop - lowerYBottom;                                   // 628
  const upperYBottom = FIXED_H - UPPER_DOOR_BOTTOM_OVERLAP;
  const upperYTop = totalHeight - GAP;
  const upperDoorH = upperYTop - upperYBottom;
  const doorZ = 9;
  sizeAndX.xOffsets.forEach((xOff, i) => {
    const w = sizeAndX.doorWidths[i];
    const lower = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, lowerDoorH, 18);
    lower.position.set(xOff + w / 2, lowerYBottom + lowerDoorH / 2, doorZ);
    lower.userData = { role: 'lower', index: i };
    lower.name = `lower_door_${i + 1}`;
    _tagPanel(lower, lower.name, Math.max(w, lowerDoorH), Math.min(w, lowerDoorH), 20);
    group.add(lower);
    const upper = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, upperDoorH, 18);
    upper.position.set(xOff + w / 2, upperYBottom + upperDoorH / 2, doorZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `upper_door_${i + 1}`;
    _tagPanel(upper, upper.name, Math.max(w, upperDoorH), Math.min(w, upperDoorH), 20);
    group.add(upper);
  });
  return group;
}

// 与 createShelfGroup 结构相同, 但下柜层板 3→2 层 (受抽屉挤占):
//   shelf_lower_1: 卡在门顶(780)与抽屉底(800)的 20mm 缝隙中间, 遮挡开门缝 (中心 Y=790).
//   shelf_lower_2: 下门内空间 (152, 780) 居中 (中心 Y=466).
function _createShelfGroupForDrawerVariant(THREE, totalWidth, totalHeight, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'shelves' };
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const shelfZ = -18 - DEPTH_INNER / 2;
  const lowerDoorBottom = SKIRT_H + GAP; // 152
  const lowerDoorTop = DRAWER_Y_BOTTOM - LOWER_DOOR_TOP_GAP; // 780
  const shelfSlotY = (lowerDoorTop + DRAWER_Y_BOTTOM) / 2; // 790
  const shelfInnerY = (lowerDoorBottom + lowerDoorTop) / 2; // 466
  [shelfSlotY, shelfInnerY].forEach((yCenter, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, yCenter, shelfZ);
    mesh.userData = { role: 'lower', index: i };
    mesh.name = `shelf_lower_${i + 1}`;
    _tagPanel(mesh, mesh.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
    group.add(mesh);
  });
  const upperH = totalHeight - FIXED_H;
  const upperFloorTop = FIXED_H + 18;
  const upperInner = upperH - 18 * 2;
  const upperFracs = upperH <= 800 ? [0.5] : [1 / 3, 2 / 3];
  upperFracs.forEach((frac, i) => {
    const mesh = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    mesh.scale.set(innerW, 18, DEPTH_INNER);
    mesh.position.set(SIDE_PANEL_THICK + innerW / 2, upperFloorTop + upperInner * frac, shelfZ);
    mesh.userData = { role: 'upper', index: i };
    mesh.name = `shelf_upper_${i + 1}`;
    _tagPanel(mesh, mesh.name, Math.max(innerW, DEPTH_INNER), Math.min(innerW, DEPTH_INNER), 18);
    group.add(mesh);
  });
  return group;
}

// 抽屉行 group: 每抽屉 = 抽面 (Z=9) + 4 盒板 (left/right/back/bottom, 藏柜体内).
// 命名: drawer_front_NN / drawer_box_{left,right,back,bottom}_NN_18, NN 从 01 起.
function _createDrawerRowGroup(THREE, totalWidth, sizeAndX, doorGeometry, shelfGeometry) {
  const group = new THREE.Group();
  group.userData = { kind: 'drawers' };
  const doorCount = sizeAndX.doorWidths.length;
  const layout = getDrawerLayout(doorCount);
  const doorZ = 9;
  const boxZCenter = -18 - DEPTH_INNER / 2; // -209
  const boxZFront = boxZCenter + DEPTH_INNER / 2; // -18
  const boxZBack = boxZCenter - DEPTH_INNER / 2;  // -400
  let doorCursor = 0;
  layout.forEach((groupSize, i) => {
    const startIdx = doorCursor;
    const endIdx = doorCursor + groupSize - 1;
    doorCursor += groupSize;
    const xLeft = sizeAndX.xOffsets[startIdx];
    const xRight = sizeAndX.xOffsets[endIdx] + sizeAndX.doorWidths[endIdx];
    const drawerW = xRight - xLeft;
    const xCenter = (xLeft + xRight) / 2;
    const nn = String(i + 1).padStart(2, '0');

    // 抽面 (视觉件, Z=9 与门共面)
    const front = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, drawerW, DRAWER_ROW_H, 18);
    front.position.set(xCenter, DRAWER_Y_CENTER, doorZ);
    front.userData = { role: 'drawer_front', index: i };
    front.name = `drawer_front_${nn}`;
    _attachPanel(front, front.name, drawerW, DRAWER_ROW_H, 18);
    group.add(front);

    // 左侧板
    const leftPanel = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    leftPanel.scale.set(18, DRAWER_ROW_H, DEPTH_INNER);
    leftPanel.position.set(xLeft + 9, DRAWER_Y_CENTER, boxZCenter);
    leftPanel.userData = { role: 'drawer_box_left', index: i };
    leftPanel.name = `drawer_box_left_${nn}_18`;
    _attachPanel(leftPanel, leftPanel.name, 18, DRAWER_ROW_H, DEPTH_INNER);
    group.add(leftPanel);

    // 右侧板
    const rightPanel = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    rightPanel.scale.set(18, DRAWER_ROW_H, DEPTH_INNER);
    rightPanel.position.set(xRight - 9, DRAWER_Y_CENTER, boxZCenter);
    rightPanel.userData = { role: 'drawer_box_right', index: i };
    rightPanel.name = `drawer_box_right_${nn}_18`;
    _attachPanel(rightPanel, rightPanel.name, 18, DRAWER_ROW_H, DEPTH_INNER);
    group.add(rightPanel);

    // 后板: 夹两侧板间, 高 = 200 - 18 (让出底板)
    const innerBoxW = drawerW - 36;
    const backH = DRAWER_ROW_H - 18;
    const backPanel = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    backPanel.scale.set(innerBoxW, backH, 18);
    backPanel.position.set(xCenter, DRAWER_Y_BOTTOM + 18 + backH / 2, boxZBack + 9);
    backPanel.userData = { role: 'drawer_box_back', index: i };
    backPanel.name = `drawer_box_back_${nn}_18`;
    _attachPanel(backPanel, backPanel.name, innerBoxW, backH, 18);
    group.add(backPanel);

    // 底板: Y=[800, 818], Z 前贴抽屉盒前沿延展到后板前面
    const bottomD = DEPTH_INNER - 18;
    const bottomPanel = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
    bottomPanel.scale.set(innerBoxW, 18, bottomD);
    bottomPanel.position.set(xCenter, DRAWER_Y_BOTTOM + 9, boxZFront - bottomD / 2);
    bottomPanel.userData = { role: 'drawer_box_bottom', index: i };
    bottomPanel.name = `drawer_box_bottom_${nn}_18`;
    _attachPanel(bottomPanel, bottomPanel.name, innerBoxW, 18, bottomD);
    group.add(bottomPanel);
  });
  return group;
}

// 150D: = 150A + 下柜底部抽屉排 (按门数奇偶分组).
function _generate150D(THREE, w, h, geometries) {
  const doorCount = getDoorCount(w);
  const sizeAndX = calcDoorSizeAndX(w, doorCount);
  const doors = _createDoorGroupWithDrawerRow(THREE, w, h, sizeAndX, geometries.doorGeometry);
  const dividers = createDividerGroup(THREE, w, h, sizeAndX, geometries.dividerGeometry);
  const shelves = _createShelfGroupForDrawerVariant(THREE, w, h, geometries.shelfGeometry);
  const fixedDividers = createFixedDividerGroup(THREE, w, geometries.shelfGeometry);
  const counter = createCounterGroup(THREE, w, geometries.shelfGeometry);
  const upperBackPanel = createUpperBackPanelGroup(THREE, w, h, geometries.shelfGeometry);
  const fixedBackPanels = createFixedBackPanelGroup(THREE, w, geometries.shelfGeometry);
  const drawers = _createDrawerRowGroup(
    THREE, w, sizeAndX, geometries.doorGeometry, geometries.shelfGeometry
  );
  const root = new THREE.Group();
  root.userData = { kind: 'shoeCabinetParts', totalWidth: w, totalHeight: h, variant: 'd' };
  root.add(doors);
  root.add(dividers);
  root.add(shelves);
  root.add(fixedDividers);
  root.add(counter);
  root.add(upperBackPanel);
  root.add(fixedBackPanels);
  root.add(drawers);
  return { root, doors, dividers, shelves, fixedDividers, counter, upperBackPanel, fixedBackPanels, drawers };
}

// 总入口. opts.variant: 'a' | 'b' | 'c' | 'd', 默认 'a'.
function generateCabinetDynamicParts(THREE, totalWidth, totalHeight, geometries, opts) {
  const variant = ((opts && opts.variant) || 'a').toString().toLowerCase();
  const w = _clampW(totalWidth);
  const h = totalHeight;
  switch (variant) {
    case 'b': return _generate150B(THREE, w, h, geometries);
    case 'c': return _generate150C(THREE, w, h, geometries);
    case 'd': return _generate150D(THREE, w, h, geometries);
    case 'a':
    default:  return _generate150A(THREE, w, h, geometries);
  }
}

// 递归销毁
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
  SIDE_PANEL_THICK,
  GAP,
  LOWER_CABINET_H,
  SKIRT_H,
  COUNTER_THICK,
  VOID_H,
  FIXED_H,
  DEPTH_TOTAL,
  DEPTH_INNER,
  LOWER_DOOR_TOP_GAP,
  UPPER_DOOR_BOTTOM_OVERLAP,
  getDoorCount,
  getDoorGroups,
  calcDoorSizeAndX,
  createDoorGroup,
  createDividerGroup,
  createShelfGroup,
  createFixedDividerGroup,
  createCounterGroup,
  createUpperBackPanelGroup,
  createFixedBackPanelGroup,
  generateCabinetDynamicParts,
  clearOldParts,
};
