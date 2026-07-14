// panel-formulas: 按 panel_code 返回 (W, H) → {length, width, thickness} 的公式函数。
// 只测代表性 code(每个板类各一个), 保证公式与 spec §6.3 一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../miniprogram/utils/panel-formulas.js');

const F = formulas.PANEL_FORMULAS;

test('side_left_panel_18: 长 = H-6, 宽 58', () => {
  assert.deepEqual(F.side_left_panel_18(50, 230), { length: 224, width: 58, thickness: 1.8 });
  assert.deepEqual(F.side_left_panel_18(100, 300), { length: 294, width: 58, thickness: 1.8 });
});

test('side_right_panel_18: 长 = H-6, 宽 58', () => {
  assert.deepEqual(F.side_right_panel_18(50, 230), { length: 224, width: 58, thickness: 1.8 });
});

test('top_panel_18: 长 58, 宽 = W-3.6', () => {
  assert.deepEqual(F.top_panel_18(50, 230), { length: 58, width: 46.4, thickness: 1.8 });
  assert.deepEqual(F.top_panel_18(100, 230), { length: 58, width: 96.4, thickness: 1.8 });
});

test('bottom_panel_18: 长 58, 宽 = W-3.6', () => {
  assert.deepEqual(F.bottom_panel_18(80, 230), { length: 58, width: 76.4, thickness: 1.8 });
});

test('back_panel_18: 长 = H-9.6, 宽 = W-3.6', () => {
  assert.deepEqual(F.back_panel_18(50, 230), { length: 220.4, width: 46.4, thickness: 1.8 });
});

test('kick_front_18: 长 = W, 宽 5.5', () => {
  assert.deepEqual(F.kick_front_18(50, 230), { length: 50, width: 5.5, thickness: 1.8 });
  assert.deepEqual(F.kick_front_18(30, 230), { length: 30, width: 5.5, thickness: 1.8 });
});

test('shelf_panel_01_18..10 同一公式: 长 56.2, 宽 = W-3.6', () => {
  for (let i = 1; i <= 10; i++) {
    const code = `shelf_panel_${String(i).padStart(2,'0')}_18`;
    assert.deepEqual(F[code](50, 230), { length: 56.2, width: 46.4, thickness: 1.8 }, code + ' 公式');
  }
});

test('door_single_18: 长 = H-6.44, 宽 = W-0.6', () => {
  assert.deepEqual(F.door_single_18(50, 230), { length: 223.56, width: 49.4, thickness: 1.8 });
});

test('door_left/right_18: 宽 = (W-0.6)/2', () => {
  assert.deepEqual(F.door_left_18(100, 230), { length: 223.56, width: 49.7, thickness: 1.8 });
  assert.deepEqual(F.door_right_18(100, 230), { length: 223.56, width: 49.7, thickness: 1.8 });
});

test('access_panel_18: 长 19.8, 宽 = W-4', () => {
  assert.deepEqual(F.access_panel_18(50, 230), { length: 19.8, width: 46, thickness: 1.8 });
});

test('drawer_box_front_01..05_18: 长 = W-4, 宽 16', () => {
  for (let i = 1; i <= 5; i++) {
    const code = `drawer_box_front_${String(i).padStart(2,'0')}_18`;
    assert.deepEqual(F[code](50, 230), { length: 46, width: 16, thickness: 1.8 }, code);
  }
});

test('drawer_side_left/right/bottom: 长 56.2, 宽 16', () => {
  assert.deepEqual(F.drawer_side_left_01_18(50, 230), { length: 56.2, width: 16, thickness: 1.8 });
});

test('drawer_box_back_XX_18: 长 = W-8.5, 宽 10.7', () => {
  assert.deepEqual(F.drawer_box_back_01_18(50, 230), { length: 41.5, width: 10.7, thickness: 1.8 });
});

test('drawer_box_bottom_XX_18: 长 47.2, 宽 = W-8.5', () => {
  assert.deepEqual(F.drawer_box_bottom_01_18(50, 230), { length: 47.2, width: 41.5, thickness: 1.8 });
});

test('未在表中的 panel_code 返回 undefined', () => {
  assert.equal(F.unknown_panel_18, undefined);
});
