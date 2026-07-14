const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const opts = require(path.resolve(__dirname, '../miniprogram/utils/materials-options.js'));

test('materialName: 5 kinds 各命中一次', () => {
  assert.equal(opts.materialName('panel', 'panel_egger'), '爱格');
  assert.equal(opts.materialName('doorPanel', 'door_material_piano_lacquer'), '钢琴烤漆');
  assert.equal(opts.materialName('doorCraft', 'door_craft_grille_door'), '格栅门');
  assert.equal(opts.materialName('hardware', 'domestic'), '中国品牌');
  assert.equal(opts.materialName('lighting', 'led_import'), '海福乐灯带');
});

test('materialName: unknown code fallback 到 code 本身 (便于排查)', () => {
  assert.equal(opts.materialName('panel', 'panel_unknown'), 'panel_unknown');
  assert.equal(opts.materialName('lighting', 'nope'), 'nope');
});

test('materialName: unknown kind 也 fallback', () => {
  assert.equal(opts.materialName('nope_kind', 'anything'), 'anything');
});

test('materialName: 空 code 返回空串', () => {
  assert.equal(opts.materialName('panel', ''), '');
  assert.equal(opts.materialName('panel', null), '');
  assert.equal(opts.materialName('panel', undefined), '');
});

test('DEFAULT_MATERIALS 的每个值都能被 materialName 命中', () => {
  const d = opts.DEFAULT_MATERIALS;
  assert.equal(opts.materialName('panel', d.panel), 'E2 国产板');
  assert.equal(opts.materialName('doorPanel', d.doorPanel), '与柜体相同');
  assert.equal(opts.materialName('doorCraft', d.doorCraft), '无');
  assert.equal(opts.materialName('hardware', d.hardware), '中国品牌');
  assert.equal(opts.materialName('lighting', d.lighting), '无');
});

test('5 组 OPTIONS 数组仍导出', () => {
  assert.equal(opts.PANEL_OPTIONS.length, 5);
  assert.equal(opts.DOOR_PANEL_OPTIONS.length, 7);
  assert.equal(opts.DOOR_CRAFT_OPTIONS.length, 4);
  assert.equal(opts.HARDWARE_OPTIONS.length, 2);
  assert.equal(opts.LIGHTING_OPTIONS.length, 3);
});
