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

test('parseSubdir: 50cm', () => {
  assert.equal(glb.parseSubdir('50A.glb'), '50cm');
  assert.equal(glb.parseSubdir('50L.glb'), '50cm');
});

test('parseSubdir: 100cm', () => {
  assert.equal(glb.parseSubdir('100A.glb'), '100cm');
  assert.equal(glb.parseSubdir('100C.glb'), '100cm');
});

test('parseSubdir: zj', () => {
  assert.equal(glb.parseSubdir('Y110.glb'), 'zj');
  assert.equal(glb.parseSubdir('Z.glb'), 'zj');
  assert.equal(glb.parseSubdir('YG120.glb'), 'zj');
  assert.equal(glb.parseSubdir('ZG-110-230.glb'), 'zj');
});

test('parseSubdir: 命名不合法返回 null', () => {
  assert.equal(glb.parseSubdir('random.glb'), null);
  assert.equal(glb.parseSubdir('abc.glb'), null);
  assert.equal(glb.parseSubdir('200A.glb'), null);
});

test('expectedWidthCm: 从文件名反推目标宽度', () => {
  assert.equal(glb.expectedWidthCm('50A.glb'), 50);
  assert.equal(glb.expectedWidthCm('100C.glb'), 100);
  assert.equal(glb.expectedWidthCm('Y110.glb'), 110);
  assert.equal(glb.expectedWidthCm('YG120.glb'), 110);
  assert.equal(glb.expectedWidthCm('random.glb'), null);
});
