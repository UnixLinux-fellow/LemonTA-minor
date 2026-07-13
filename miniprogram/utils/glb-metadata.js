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
  if (n.indexOf('rail') >= 0) return 'rail';
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
  // length,width 单位 cm; area 单位 m²; 保留 4 位小数
  const areaM2 = (length * width) / 10000;
  return Math.round(areaM2 * 10000) / 10000;
}

// 文件名 → 子目录归类:'50cm' | '100cm' | 'zj' | null
function parseSubdir(fileName) {
  const base = String(fileName || '').replace(/\.glb$/i, '');
  if (/^50[A-Za-z]+$/.test(base)) return '50cm';
  if (/^100[A-Za-z]+$/.test(base)) return '100cm';
  if (/^(YG|ZG|Y|Z)([-_A-Za-z0-9]*)$/i.test(base)) return 'zj';
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

// 读取文件 → ArrayBuffer,依赖注入 fs (支持 wx.getFileSystemManager 与测试 mock)
function _readGlbBuffer(filePath, fs) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: (err) => reject(err),
    });
  });
}

// gltfLoader.parse 回调化 → Promise<root>
function _parseGltf(buffer, gltfLoader) {
  return new Promise((resolve, reject) => {
    try {
      gltfLoader.parse(
        buffer,
        '',
        (gltf) => {
          const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!root) return reject(new Error('no_scene'));
          resolve(root);
        },
        (err) => reject(err || new Error('gltf_parse_fail'))
      );
    } catch (e) {
      reject(e);
    }
  });
}

function _sizeFromObject(obj, THREE) {
  const bbox = new THREE.Box3().setFromObject(obj);
  const v = new THREE.Vector3();
  bbox.getSize(v);
  return { x: v.x, y: v.y, z: v.z };
}

// 主入口。opts: { filePath, fileName, modelCategory, fileSize, uploadOpenid, sourceType }
// deps: { THREE, gltfLoader, fs }  fs 需实现 readFile({ filePath, success, fail })
async function parse(opts, deps) {
  const { THREE, gltfLoader, fs } = deps;
  const { filePath, fileName, modelCategory, fileSize, uploadOpenid, sourceType } = opts;

  const buffer = await _readGlbBuffer(filePath, fs);
  const root = await _parseGltf(buffer, gltfLoader);

  const expectedW = expectedWidthCm(fileName);
  const rootSize = _sizeFromObject(root, THREE);
  // GLB 原始坐标不是可靠的 cm/mm,用文件名反推的目标宽度反算 unitToCm。
  // rootSize.x 为 0 时兜底 1(承认 GLB 已按 cm 建模)。
  // 注:兜底 1 时 overall_size 可能全为 0,调用方应检查并向用户告警(见 Task 5 上传编排)。
  const unitToCm =
    rootSize.x > 0.0001 && expectedW ? expectedW / rootSize.x : 1;

  const overall_size = {
    total_width: Math.round(rootSize.x * unitToCm),
    total_height: Math.round(rootSize.y * unitToCm),
    total_depth: Math.round(rootSize.z * unitToCm),
  };

  const board_list = [];
  const hanging_rail_list = [];
  let total_door_area = 0;

  root.traverse((node) => {
    if (!node || !node.isMesh) return;
    const kind = _classifyMesh(node.name);
    if (kind === 'other') return;
    const size = _sizeFromObject(node, THREE);
    const dims = _meshDimsFromSize(size, unitToCm);
    if (kind === 'board') {
      board_list.push({
        node_name: node.name,
        length: dims.length,
        width: dims.width,
        thickness: dims.thickness,
        area: _computeArea(dims.length, dims.width),
      });
    } else if (kind === 'rail') {
      hanging_rail_list.push({
        node_name: node.name,
        length: dims.length,
      });
    } else if (kind === 'door') {
      total_door_area += _computeArea(dims.length, dims.width);
    }
  });

  const total_body_area = Math.round(
    board_list.reduce((s, b) => s + b.area, 0) * 10000
  ) / 10000;
  total_door_area = Math.round(total_door_area * 10000) / 10000;
  const total_raw_board_area = Math.round(
    (total_body_area + total_door_area) * 10000
  ) / 10000;

  const now = new Date().toISOString();

  return {
    glb_file_name: fileName,
    model_category: modelCategory,
    platform: 'wechat',
    // cos_path 由调用方在上传成功后回填
    file_size: fileSize,
    source_type: sourceType,
    upload_openid: uploadOpenid,
    is_online: true,
    remark: '',
    overall_size,
    board_list,
    total_body_area,
    total_door_area,
    total_raw_board_area,
    hanging_rail_list,
    hardware_list: Object.assign({}, DEFAULT_HARDWARE_LIST),
    create_time: now,
    update_time: now,
  };
}

module.exports = {
  DEFAULT_HARDWARE_LIST,
  _classifyMesh,
  _meshDimsFromSize,
  _computeArea,
  parseSubdir,
  expectedWidthCm,
  parse,
};
