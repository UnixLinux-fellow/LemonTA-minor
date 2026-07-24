const test = require('node:test');
const assert = require('node:assert/strict');
const common = require('../miniprogram/cabinet/utils/cabinet-common.js');

test('常量导出', () => {
  assert.equal(common.SIDE_PANEL_THICK, 18);
  assert.equal(common.GAP, 2);
  assert.equal(common.WIDTH_MIN, 800);
  assert.equal(common.WIDTH_MAX, 3000);
});

test('getDoorCount: 区间边界严格', () => {
  assert.equal(common.getDoorCount(800), 2);
  assert.equal(common.getDoorCount(1100), 2);
  assert.equal(common.getDoorCount(1101), 3);
  assert.equal(common.getDoorCount(1600), 3);
  assert.equal(common.getDoorCount(1601), 4);
  assert.equal(common.getDoorCount(2100), 4);
  assert.equal(common.getDoorCount(2101), 5);
  assert.equal(common.getDoorCount(2600), 5);
  assert.equal(common.getDoorCount(2601), 6);
  assert.equal(common.getDoorCount(3000), 6);
});

test('getDoorCount: 边界外钳制', () => {
  assert.equal(common.getDoorCount(799), 2);
  assert.equal(common.getDoorCount(3001), 6);
  assert.equal(common.getDoorCount(0), 2);
  assert.equal(common.getDoorCount(-5), 2);
  assert.equal(common.getDoorCount(NaN), 2);
  assert.equal(common.getDoorCount(Infinity), 2);
});

test('calcDoorSizeAndX (1500,3): 均分 485, 余 1 加最后', () => {
  const r = common.calcDoorSizeAndX(1500, 3);
  assert.deepEqual(r.doorWidths, [485, 485, 486]);
  assert.deepEqual(r.xOffsets, [20, 507, 994]);
});

test('calcDoorSizeAndX (1101,3): 内宽 1065, 均分 352 余 1', () => {
  const r = common.calcDoorSizeAndX(1101, 3);
  assert.deepEqual(r.doorWidths, [352, 352, 353]);
  assert.deepEqual(r.xOffsets, [20, 374, 728]);
});

test('calcDoorSizeAndX (800,2): 均分完整无余', () => {
  const r = common.calcDoorSizeAndX(800, 2);
  assert.deepEqual(r.doorWidths, [379, 379]);
  assert.deepEqual(r.xOffsets, [20, 401]);
});

test('calcDoorSizeAndX 边缝: xOffset[0]=SIDE+GAP, 右侧 last+w 距 totalW = SIDE+GAP', () => {
  const r = common.calcDoorSizeAndX(1500, 3);
  assert.equal(r.xOffsets[0], common.SIDE_PANEL_THICK + common.GAP);
  const last = r.xOffsets[r.xOffsets.length - 1] + r.doorWidths[r.doorWidths.length - 1];
  assert.equal(1500 - last, common.SIDE_PANEL_THICK + common.GAP);
});

test('getDoorGroups: 奇数 → 左单开 + 其余对开', () => {
  assert.deepEqual(common.getDoorGroups(3), [1, 2]);
  assert.deepEqual(common.getDoorGroups(5), [1, 2, 2]);
});

test('getDoorGroups: 偶数 → 全对开', () => {
  assert.deepEqual(common.getDoorGroups(2), [2]);
  assert.deepEqual(common.getDoorGroups(4), [2, 2]);
  assert.deepEqual(common.getDoorGroups(6), [2, 2, 2]);
});

test('getDoorGroups: 边界 0/负值 → 空数组', () => {
  assert.deepEqual(common.getDoorGroups(0), []);
  assert.deepEqual(common.getDoorGroups(-1), []);
});

test('_clampW: 类型防御', () => {
  assert.equal(common._clampW(1500), 1500);
  assert.equal(common._clampW(500), common.WIDTH_MIN);
  assert.equal(common._clampW(5000), common.WIDTH_MAX);
  assert.equal(common._clampW('abc'), common.WIDTH_MIN);
  assert.equal(common._clampW(null), common.WIDTH_MIN);
  assert.equal(common._clampW(undefined), common.WIDTH_MIN);
});
