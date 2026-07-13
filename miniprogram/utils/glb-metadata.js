// GLB 元数据抽取:遍历 mesh 抽 board/rail/door,拼成 explain_example.json 结构。
// 依赖注入:parse(filePath, opts, deps)  deps = { THREE, gltfLoader, fs }
// 让此模块可以脱离 wx / three-renderer 单测(纯函数部分)。

// 硬件默认清单,拷贝自 docs/explain_example.json。
// 本期 hardware_list 不做识别,统一写默认值让下游 cost/materials 页有数可算。
const DEFAULT_HARDWARE_LIST = {
  hinge: 8,
  slide: 2,
  hanging_rail: 1,
  minifix: 36,
  countersunk_screw: 86,
  wood_dowel: 42,
  push_latch: 2,
  self_tapping_screw_16: 30,
  self_tapping_screw_30: 30,
  support_arm: 2,
  plinth: 4,
  nylon_pre_inserted_nut: 50,
  dust_strip: 8,
  liquid_nails: 1,
  access_panel_handle: 1,
  cable_channel: 1,
  led_light_strip: 2.2,
  led_light_power: 1,
  led_light_switch: 1,
};

// mesh.name 关键字 → 归类:'door' | 'rail' | 'board' | 'other'
function _classifyMesh(name) {
  const n = String(name || '').toLowerCase();
  if (n.indexOf('door') >= 0) return 'door';
  if (n.indexOf('rail') >= 0 || n.indexOf('hanging') >= 0) return 'rail';
  const boardKws = ['board', 'shelf', 'vertical', 'top', 'bottom', 'side', 'front', 'back'];
  for (let i = 0; i < boardKws.length; i++) {
    if (n.indexOf(boardKws[i]) >= 0) return 'board';
  }
  return 'other';
}

// 三元 size × unitToCm → { length, width, thickness } cm
// length=max, width=mid, thickness=min
function _meshDimsFromSize(size, unitToCm) {
  const arr = [size.x, size.y, size.z].map(function (v) { return v * unitToCm; });
  arr.sort(function (a, b) { return b - a; });
  return {
    length: Math.round(arr[0] * 10) / 10,
    width: Math.round(arr[1] * 10) / 10,
    thickness: Math.round(arr[2] * 100) / 100,
  };
}

// 面积 = length × width / 10000,保留 4 位小数(m²)
function _computeArea(length, width) {
  return Math.round((length * width) / 10000 * 10000) / 10000;
}

// 文件名 → 子目录归类:'50cm' | '100cm' | 'zj' | null
function parseSubdir(fileName) {
  const base = String(fileName || '').replace(/\.glb$/i, '');
  if (/^50[A-Za-z]+$/.test(base)) return '50cm';
  if (/^100[A-Za-z]+$/.test(base)) return '100cm';
  if (/^(Y|Z|YG|ZG)([-_A-Za-z0-9]*)$/i.test(base)) return 'zj';
  return null;
}

// 文件名 → 期望宽度(cm),用来反推 unitToCm。不合法返回 null
function expectedWidthCm(fileName) {
  const base = String(fileName || '').replace(/\.glb$/i, '');
  if (/^50[A-Za-z]+$/.test(base)) return 50;
  if (/^100[A-Za-z]+$/.test(base)) return 100;
  if (/^(Y|Z|YG|ZG)([-_A-Za-z0-9]*)$/i.test(base)) return 110;
  return null;
}

module.exports = {
  DEFAULT_HARDWARE_LIST,
  _classifyMesh,
  _meshDimsFromSize,
  _computeArea,
  parseSubdir,
  expectedWidthCm,
};
