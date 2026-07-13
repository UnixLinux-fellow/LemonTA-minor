// GLB 元数据抽取纯逻辑测试。
// 注:parse() 端到端因涉及 GLTFLoader + wx.getFileSystemManager,需要真机验证;
// 这里只覆盖分类/尺寸/面积/命名归类 4 个纯函数。
const test = require('node:test');
const assert = require('node:assert/strict');
const glb = require('../miniprogram/utils/glb-metadata.js');

test('_classifyMesh: door', () => {
  assert.equal(glb._classifyMesh('door_panel_01'), 'door');
  assert.equal(glb._classifyMesh('Door01'), 'door');
});

test('_classifyMesh: rail', () => {
  assert.equal(glb._classifyMesh('hanging_rail_01'), 'rail');
  assert.equal(glb._classifyMesh('rail_top'), 'rail');
});

test('_classifyMesh: board', () => {
  assert.equal(glb._classifyMesh('left_vertical_board'), 'board');
  assert.equal(glb._classifyMesh('middle_shelf_02'), 'board');
  assert.equal(glb._classifyMesh('top_board'), 'board');
  assert.equal(glb._classifyMesh('drawer_side_left'), 'board');
  assert.equal(glb._classifyMesh('drawer_back_board'), 'board');
});

test('_classifyMesh: other', () => {
  assert.equal(glb._classifyMesh('camera'), 'other');
  assert.equal(glb._classifyMesh('lamp_light'), 'other');
});

test('_meshDimsFromSize: length/width/thickness 排序', () => {
  const r = glb._meshDimsFromSize({ x: 230, y: 60, z: 1.8 }, 1);
  assert.equal(r.length, 230);
  assert.equal(r.width, 60);
  assert.equal(r.thickness, 1.8);

  const r2 = glb._meshDimsFromSize({ x: 1.8, y: 230, z: 60 }, 1);
  assert.equal(r2.length, 230);
  assert.equal(r2.width, 60);
  assert.equal(r2.thickness, 1.8);
});

test('_meshDimsFromSize: unitToCm 换算', () => {
  const r = glb._meshDimsFromSize({ x: 2.3, y: 0.6, z: 0.018 }, 100);
  assert.equal(r.length, 230);
  assert.equal(r.width, 60);
  assert.equal(r.thickness, 1.8);
});

test('_computeArea: (length * width) / 10000 保留 4 位', () => {
  assert.equal(glb._computeArea(230, 60), 1.38);
  assert.equal(glb._computeArea(46.4, 15), 0.0696);
});

test('parseSubdir: 50cm - 严格命名', () => {
  assert.equal(glb.parseSubdir('50A.glb'), '50cm');
  assert.equal(glb.parseSubdir('50L.glb'), '50cm');
});

test('parseSubdir: 50cm - 宽松命名(含 50 子串)', () => {
  assert.equal(glb.parseSubdir('衣柜_50cm.glb'), '50cm');
  assert.equal(glb.parseSubdir('mini-50-wardrobe.glb'), '50cm');
  assert.equal(glb.parseSubdir('模型50标准.glb'), '50cm');
});

test('parseSubdir: 100cm - 严格命名', () => {
  assert.equal(glb.parseSubdir('100A.glb'), '100cm');
  assert.equal(glb.parseSubdir('100C.glb'), '100cm');
});

test('parseSubdir: 100cm - 宽松命名(含 100 子串)', () => {
  assert.equal(glb.parseSubdir('柜体100cm加高.glb'), '100cm');
  assert.equal(glb.parseSubdir('big_100_wardrobe.glb'), '100cm');
});

test('parseSubdir: 100 优先于 50 (100C 不应误判为 50cm)', () => {
  // "100C" 里没有连续 "50" 子串, 但确认逻辑正确
  assert.equal(glb.parseSubdir('100C.glb'), '100cm');
  // 极端: 名字同时含 100 和 50, 按优先级归 100
  assert.equal(glb.parseSubdir('50-100-mix.glb'), '100cm');
});

test('parseSubdir: zj - 沿用 Y/Z/YG/ZG 开头规则', () => {
  assert.equal(glb.parseSubdir('Y110.glb'), 'zj');
  assert.equal(glb.parseSubdir('Z.glb'), 'zj');
  assert.equal(glb.parseSubdir('YG120.glb'), 'zj');
  assert.equal(glb.parseSubdir('ZG-110-230.glb'), 'zj');
});

test('parseSubdir: 不含 50/100/YZ 开头 → null', () => {
  assert.equal(glb.parseSubdir('random.glb'), null);
  assert.equal(glb.parseSubdir('abc.glb'), null);
  assert.equal(glb.parseSubdir('200A.glb'), null);
  assert.equal(glb.parseSubdir('衣柜.glb'), null);
});

test('parseSubdir: 非 .glb 后缀 → null', () => {
  assert.equal(glb.parseSubdir('50A.txt'), null);
  assert.equal(glb.parseSubdir('100A'), null);
  assert.equal(glb.parseSubdir('Y110.gltf'), null);
});

test('expectedWidthCm: 从文件名反推目标宽度', () => {
  assert.equal(glb.expectedWidthCm('50A.glb'), 50);
  assert.equal(glb.expectedWidthCm('100C.glb'), 100);
  assert.equal(glb.expectedWidthCm('Y110.glb'), 110);
  assert.equal(glb.expectedWidthCm('YG120.glb'), 110);
  assert.equal(glb.expectedWidthCm('random.glb'), null);
  // 宽松命名也能反推
  assert.equal(glb.expectedWidthCm('衣柜_100cm.glb'), 100);
  assert.equal(glb.expectedWidthCm('模型50.glb'), 50);
});

test('_classifyMesh: null/空串归 other', () => {
  assert.equal(glb._classifyMesh(null), 'other');
  assert.equal(glb._classifyMesh(''), 'other');
});

test('_classifyMesh: hanging 单独不算 rail (需含 rail 关键字)', () => {
  assert.equal(glb._classifyMesh('hanging_organizer'), 'other');
  assert.equal(glb._classifyMesh('hanging_rail_02'), 'rail');
});

test('parseSubdir: null/空串返回 null', () => {
  assert.equal(glb.parseSubdir(null), null);
  assert.equal(glb.parseSubdir(''), null);
});

test('DEFAULT_HARDWARE_LIST: 结构完整', () => {
  // 只做结构烟测,数值已由 hardware_list 端到端测试覆盖
  assert.equal(typeof glb.DEFAULT_HARDWARE_LIST.hinge, 'number');
  assert.equal(typeof glb.DEFAULT_HARDWARE_LIST.led_light_strip, 'number');
  assert.equal(Object.keys(glb.DEFAULT_HARDWARE_LIST).length, 19);
});

// parse 集成测试:mock 出 GLTFLoader / fs / THREE.Box3,断言输出结构对齐 explain_example
test('parse: 端到端拼装 (mock deps)', async () => {
  // 手工构造一棵 scene:2 板件 + 1 衣通 + 1 门板
  const meshLeft = { name: 'left_vertical_board', isMesh: true };
  const meshShelf = { name: 'middle_shelf_01', isMesh: true };
  const meshRail = { name: 'hanging_rail_01', isMesh: true };
  const meshDoor = { name: 'door_panel', isMesh: true };
  const fakeRoot = {
    traverse(cb) { [meshLeft, meshShelf, meshRail, meshDoor].forEach(cb); },
  };

  // 假 Box3:根据 mesh.name 返回不同尺寸(cm 单位,unitToCm=1)。
  // root 本身 = 50cm 宽,230cm 高,60cm 深。
  const sizesByMesh = new Map([
    [null,       { x: 50, y: 230, z: 60 }],   // root
    [meshLeft,   { x: 1.8, y: 230, z: 60 }],
    [meshShelf,  { x: 50, y: 60, z: 1.8 }],
    [meshRail,   { x: 50, y: 1, z: 1 }],
    [meshDoor,   { x: 50, y: 230, z: 1.8 }],
  ]);
  function makeBox3() {
    let obj = null;
    return {
      setFromObject(o) { obj = o; return this; },
      getSize(v) {
        const s = sizesByMesh.get(obj) || sizesByMesh.get(null);
        v.x = s.x; v.y = s.y; v.z = s.z;
        return v;
      },
    };
  }
  const FakeVec3 = function () { this.x = 0; this.y = 0; this.z = 0; };
  const deps = {
    THREE: { Box3: function () { return makeBox3(); }, Vector3: FakeVec3 },
    gltfLoader: {
      parse(buf, base, onOk) { onOk({ scene: fakeRoot }); },
    },
    fs: {
      readFile({ filePath, success }) {
        success({ data: new ArrayBuffer(8) });
      },
    },
  };
  const opts = {
    filePath: '/tmp/50A.glb',
    fileName: '50A.glb',
    modelCategory: 'wardrobe',
    fileSize: 128000,
    uploadOpenid: 'oXX',
    sourceType: 'normal_user',
  };
  const meta = await glb.parse(opts, deps);
  assert.equal(meta.glb_file_name, '50A.glb');
  assert.equal(meta.model_category, 'wardrobe');
  assert.equal(meta.platform, 'wechat');
  assert.equal(meta.file_size, 128000);
  assert.equal(meta.upload_openid, 'oXX');
  assert.equal(meta.source_type, 'normal_user');
  assert.equal(meta.is_online, true);
  assert.equal(meta.remark, '');
  assert.equal(meta.overall_size.total_width, 50);
  assert.equal(meta.overall_size.total_height, 230);
  assert.equal(meta.overall_size.total_depth, 60);
  assert.equal(meta.board_list.length, 2);
  assert.equal(meta.board_list[0].node_name, 'left_vertical_board');
  assert.equal(meta.hanging_rail_list.length, 1);
  assert.equal(meta.hanging_rail_list[0].node_name, 'hanging_rail_01');
  assert.equal(meta.hanging_rail_list[0].length, 50);
  // total_door_area 应等于门板面积
  assert.equal(meta.total_door_area, glb._computeArea(230, 50));
  // total_body_area 应等于两板件面积之和
  const expBody = glb._computeArea(230, 60) + glb._computeArea(60, 50);
  assert.equal(meta.total_body_area, Math.round(expBody * 10000) / 10000);
  // total_raw_board_area = body + door
  assert.equal(meta.total_raw_board_area,
    Math.round((meta.total_body_area + meta.total_door_area) * 10000) / 10000);
  // hardware_list 用默认值
  assert.equal(meta.hardware_list.hinge, 8);
  assert.equal(meta.hardware_list.slide, 2);
  // 时间戳
  assert.ok(meta.create_time);
  assert.equal(meta.create_time, meta.update_time);
});
