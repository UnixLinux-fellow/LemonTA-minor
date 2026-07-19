const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../miniprogram/utils/cabinet-rules.js');

test('validateWall wardrobe: 兼容旧行为(无 mode 参数)', () => {
  assert.equal(rules.validateWall(44, 232).ok, true);
  assert.equal(rules.validateWall(1000, 1000).ok, true);
  assert.equal(rules.validateWall(43, 232).ok, false);
  assert.equal(rules.validateWall(44, 231).ok, false);
});

test('validateWall shoe: 边界内 ok', () => {
  assert.equal(rules.validateWall(80, 220, 'shoe').ok, true);
  assert.equal(rules.validateWall(300, 270, 'shoe').ok, true);
  assert.equal(rules.validateWall(150, 240, 'shoe').ok, true);
});

test('validateWall shoe: 宽度低于 80 报错', () => {
  const r = rules.validateWall(79, 240, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /80cm/);
});

test('validateWall shoe: 宽度高于 300 报错', () => {
  const r = rules.validateWall(301, 240, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /300cm/);
});

test('validateWall shoe: 高度低于 220 报错', () => {
  const r = rules.validateWall(150, 219, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /220cm/);
});

test('validateWall shoe: 高度高于 270 报错', () => {
  const r = rules.validateWall(150, 271, 'shoe');
  assert.equal(r.ok, false);
  assert.match(r.message, /270cm/);
});

test('MODE 常量导出', () => {
  assert.equal(rules.MODE.WARDROBE, 'wardrobe');
  assert.equal(rules.MODE.SHOE, 'shoe');
});
