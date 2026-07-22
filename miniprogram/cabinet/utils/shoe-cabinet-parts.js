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
const DEPTH_TOTAL = 420;
// 前预留 18mm (门厚) + 背板 18mm = 36mm 扣除
const DEPTH_INNER = DEPTH_TOTAL - 36;
// 门板 Y 对齐规则:
//   下柜门顶离台面底部 20mm (中间留缝);
//   上柜门底 "下盖" 上柜底面 28mm (门板向下伸出盖住悬空区顶端).
const LOWER_DOOR_TOP_GAP = 20;
const UPPER_DOOR_BOTTOM_OVERLAP = 28;

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
    group.add(lower);
    const upper = _cloneScaledMesh(THREE, doorGeometry, 450, 846, 18, w, upperDoorH, 18);
    upper.position.set(xOff + w / 2, upperYBottom + upperDoorH / 2, doorZ);
    upper.userData = { role: 'upper', index: i };
    upper.name = `upper_door_${i + 1}`;
    group.add(upper);
  });
  return group;
}

// 门的分组: N 奇 → [1, 2, 2, ...] (单开门在最左, 其余对开);
//          N 偶 → [2, 2, ...] (全部对开).
// 中侧板只放在分组边界, 数量 = groups.length - 1.
function getDoorGroups(doorCount) {
  const n = Math.max(0, Math.floor(doorCount));
  if (n === 0) return [];
  const groups = [];
  if (n % 2 === 1) groups.push(1);
  const pairs = Math.floor((n - (n % 2)) / 2);
  for (let i = 0; i < pairs; i++) groups.push(2);
  return groups;
}

// 中隔板 group: 按分组边界放, 分上下段. 对开门内部无中侧板.
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
    group.add(lower);
    const upper = new THREE.Mesh(dividerGeometry, _makePlaceholderMaterial(THREE));
    upper.scale.set(18, upperH, DEPTH_INNER);
    upper.position.set(xCenter, upperYBottom + upperH / 2 - GAP, dividerZ);
    upper.userData = { role: 'upper', index: k };
    upper.name = `mid_divider_upper_${k + 1}`;
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
  group.add(lower);
  // 上柜底板: 底面 Y = FIXED_H = 1500, 板厚 18, 中心 1509.
  const upper = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  upper.scale.set(innerW, 18, DEPTH_INNER);
  upper.position.set(SIDE_PANEL_THICK + innerW / 2, FIXED_H + 9, shelfZ);
  upper.userData = { role: 'upper_bottom' };
  upper.name = 'shelf_fixed_up';
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
  group.add(lower);

  const middleBottom = SKIRT_H + LOWER_CABINET_H;      // 1000
  const middleTop = FIXED_H;                           // 1500
  const middleH = middleTop - middleBottom;            // 500
  const middle = new THREE.Mesh(shelfGeometry, _makePlaceholderMaterial(THREE));
  middle.scale.set(innerW, middleH, 18);
  middle.position.set(xCenter, (middleBottom + middleTop) / 2, zCenter);
  middle.userData = { role: 'middle_back' };
  middle.name = 'back_panel_middle';
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
  group.add(mesh);
  return group;
}

// 总入口
function generateCabinetDynamicParts(THREE, totalWidth, totalHeight, geometries) {
  const w = _clampW(totalWidth);
  const h = totalHeight;
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
  root.userData = { kind: 'shoeCabinetParts', totalWidth: w, totalHeight: h };
  root.add(doors);
  root.add(dividers);
  root.add(shelves);
  root.add(fixedDividers);
  root.add(counter);
  root.add(upperBackPanel);
  root.add(fixedBackPanels);
  return { root, doors, dividers, shelves, fixedDividers, counter, upperBackPanel, fixedBackPanels };
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
