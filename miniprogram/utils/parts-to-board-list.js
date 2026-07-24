// 运行时板件提取: 遍历 THREE 场景中的 dyn root, 收集所有 mesh.userData.panel,
// 输出与 cost-engine 兼容的 { board_list, door_list, hardware_list } 结构.
//
// 单位约定:
//   mesh.userData.panel = { code, length, width, thickness }  单位 mm
//   输出的 board/door 条目 length/width/thickness 单位 cm, area 单位 m² (与 cost-engine 一致)
//
// 分类规则 (按 code 命名):
//   包含 'door' 或以 'drawer_front' 开头 → 视觉门板类 → door_list
//   其余 (侧板/顶板/背板/层板/隔板/抽屉盒/台面/固定水平板 等) → board_list
//
// 五金规则:
//   普通门:  高 <800mm → 2 铰, 高 ≥800mm → 3 铰 (存到 hardware_list.hinge)
//   玻璃门:  高 ≤800mm → 2 铰, 801~1800mm → 3 铰, 1801~2400mm → 4 铰
//           (存到 hardware_list.glass_door_hinge, 走 glass_door_hinge_{domestic|import})
//   每个抽屉 (drawer_front): 1 副托底轨 (存到 hardware_list.slide)
//
// 门/抽屉高度从 mesh.scale.y * 846 反推 (基几何 doorGeometry Y=846, 与 shoe/bookshelf-parts 一致).

// doorGeometry 基高度 (与 shoe-cabinet-parts.js / bookshelf-parts.js 里 _cloneScaledMesh(...,846,...) 保持一致)
const DOOR_BASE_H_MM = 846;
// 门铰规则阈值
const HINGE_HEIGHT_THRESHOLD_MM = 800;
// 玻璃门铰链高度分档 (mm)
const GLASS_HINGE_THRESHOLD_1_MM = 800;
const GLASS_HINGE_THRESHOLD_2_MM = 1800;

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

function _isDoorLike(code) {
  if (!code) return false;
  // 门系列 (150A/D 的 lower_door_N, upper_door_N; 书柜 door_lower/middle/upper_N;
  //         150B/C 的 door_lower_L/R_N, door_upper_R_N)
  if (code.indexOf('door') >= 0) return true;
  // 抽面视觉件 (150D 的 drawer_front_NN, 150C 的 drawer_front_L_01)
  if (code.indexOf('drawer_front') === 0) return true;
  return false;
}

function _panelToEntry(panel, mesh) {
  const lengthCm = panel.length / 10;
  const widthCm = panel.width / 10;
  const thicknessCm = panel.thickness / 10;
  const entry = {
    node_name: panel.code,
    length: round2(lengthCm),
    width: round2(widthCm),
    thickness: round2(thicknessCm),
    area: round4(lengthCm * widthCm / 10000),
  };
  // 玻璃门标记 (mesh.userData.material='glass'): cost-engine 用它把玻璃门从
  // 板材/门材/工艺三合一单价里剥出去, 单独走 glass_door 单价.
  if (mesh && mesh.userData && mesh.userData.material === 'glass') {
    entry.material = 'glass';
  }
  return entry;
}

// 门/抽屉的物理高度 (mm): 反推自 mesh.scale.y * doorGeometry.baseHeight.
// 若 mesh.scale 缺失或 panel.heightMm 已显式记录, 优先用 heightMm.
function _doorHeightMm(mesh) {
  const p = mesh.userData && mesh.userData.panel;
  if (p && typeof p.heightMm === 'number') return p.heightMm;
  if (mesh.scale && typeof mesh.scale.y === 'number') {
    return mesh.scale.y * DOOR_BASE_H_MM;
  }
  return 0;
}

// 按门高算铰链数: <800mm → 2, ≥800mm → 3
function _hingeCountForHeight(hMm) {
  return hMm < HINGE_HEIGHT_THRESHOLD_MM ? 2 : 3;
}

// 玻璃门铰链: ≤800mm → 2, 801~1800mm → 3, 1801~2400mm → 4 (超出 2400 仍按 4 计)
function _glassHingeCountForHeight(hMm) {
  if (hMm <= GLASS_HINGE_THRESHOLD_1_MM) return 2;
  if (hMm <= GLASS_HINGE_THRESHOLD_2_MM) return 3;
  return 4;
}

function _isGlassMesh(mesh) {
  return !!(mesh && mesh.userData && mesh.userData.material === 'glass');
}

// root 可以是 THREE.Group 或任何有 traverse 方法的对象.
// 返回 { board_list, door_list, hardware_list }.
function partsToBoardList(root) {
  const boardList = [];
  const doorList = [];
  let hingeQty = 0;
  let glassHingeQty = 0;
  let slideQty = 0;
  if (!root || typeof root.traverse !== 'function') {
    return { board_list: boardList, door_list: doorList, hardware_list: {} };
  }
  root.traverse((n) => {
    if (!n.isMesh || !n.userData || !n.userData.panel) return;
    const p = n.userData.panel;
    if (!p.code || typeof p.length !== 'number' || typeof p.width !== 'number' || typeof p.thickness !== 'number') {
      return;
    }
    const entry = _panelToEntry(p, n);
    if (_isDoorLike(p.code)) {
      doorList.push(entry);
      // 抽面 = 1 副托底轨; 玻璃门 = 分档铰链; 普通门 = 老规则铰链
      if (p.code.indexOf('drawer_front') === 0) {
        slideQty += 1;
      } else if (_isGlassMesh(n)) {
        glassHingeQty += _glassHingeCountForHeight(_doorHeightMm(n));
      } else {
        hingeQty += _hingeCountForHeight(_doorHeightMm(n));
      }
    } else {
      boardList.push(entry);
    }
  });
  const hardwareList = {};
  if (hingeQty > 0) hardwareList.hinge = hingeQty;
  if (glassHingeQty > 0) hardwareList.glass_door_hinge = glassHingeQty;
  if (slideQty > 0) hardwareList.slide = slideQty;
  return { board_list: boardList, door_list: doorList, hardware_list: hardwareList };
}

module.exports = {
  partsToBoardList,
  _isDoorLike,
  _doorHeightMm,
  _hingeCountForHeight,
  _glassHingeCountForHeight,
  DOOR_BASE_H_MM,
  HINGE_HEIGHT_THRESHOLD_MM,
  GLASS_HINGE_THRESHOLD_1_MM,
  GLASS_HINGE_THRESHOLD_2_MM,
};
