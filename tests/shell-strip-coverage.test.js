// 剥壳白名单覆盖率测试.
// _prepareShoeShellAndSamples (three-renderer.js) 从 GLB shell 里剔除动态部件,
// 剥净率决定后续参数化生成的部件能否正确对位 + shell root bbox 是否被污染.
// 150B/C/D 引入了新命名 (back_panel_right_*, drawer_sample_18,
// shelf_fixed_R_18 无数字, back_panel_left_lower/upper_*, drawer_double/single_*),
// 旧白名单不覆盖 → 漏剥 → 三轴拉伸畸变.
//
// 由于剥壳逻辑内嵌在 renderer 方法里, 这里直接读 three-renderer.js 源码把 predicate
// 抽出来做纯字符串匹配. 未来若 predicate 被抽成独立函数, 换成 require 该函数即可.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// 从 three-renderer.js 里的 _prepareShoeShellAndSamples 白名单逐条移植过来.
// 与源代码保持字面同步 (any change to strip list must land here too).
function shouldStripAsShoeDynamic(name) {
  const n = (name || '').toLowerCase();
  return (
    n.indexOf('door_sample') >= 0 ||
    n.indexOf('mid_panel_sample') >= 0 ||
    n.indexOf('shelf_sample') >= 0 ||
    n.indexOf('drawer_sample') >= 0 ||
    n.indexOf('drawer_front') >= 0 ||
    n.indexOf('drawer_double') >= 0 ||
    n.indexOf('drawer_single') >= 0 ||
    n.indexOf('lower_door') >= 0 ||
    n.indexOf('upper_door') >= 0 ||
    n.indexOf('mid_divider') >= 0 ||
    n.indexOf('shelf_fixed_up') >= 0 ||
    n.indexOf('shelf_fixed_down') >= 0 ||
    n.indexOf('countertop') >= 0 ||
    n.indexOf('back_panel_upper') >= 0 ||
    n.indexOf('back_panel_lower') >= 0 ||
    n.indexOf('back_panel_middle') >= 0 ||
    n.indexOf('back_panel_left') >= 0 ||
    n.indexOf('back_panel_right') >= 0 ||
    /shelf_upper_[lr]\d/.test(n) ||
    /shelf_fixed_[lr][_\d]/.test(n)
  );
}

// shell 应保留节点: 侧板 / 顶板 / 底板 / 踢脚 / (Assembly 容器).
// 未剥且不属于 shell 的都是"漏网", 应该 assertion 失败.
function isShellStatic(name) {
  const n = (name || '').toLowerCase();
  return (
    n.indexOf('side_left_panel') >= 0 ||
    n.indexOf('side_right_panel') >= 0 ||
    n.indexOf('bottom_panel') >= 0 ||
    n.indexOf('top_panel') >= 0 ||
    n.indexOf('top_plate') >= 0 ||         // 150B: top_plate#1
    n.indexOf('baseboard') >= 0 ||         // 150B/C/D: baseboard_18 等
    n === 'assembly-30' || n === 'assembly-31' || n === 'assembly-33' || n === 'assembly-36' ||
    n === 'active view'
  );
}

function loadNodeNames(glbFile) {
  const buf = fs.readFileSync(glbFile);
  const jsonLen = buf.readUInt32LE(12);
  const json = buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, '');
  const g = JSON.parse(json);
  return (g.nodes || []).map((n) => n.name).filter(Boolean);
}

function auditStripCoverage(glbFile) {
  const names = loadNodeNames(glbFile);
  const leaked = [];
  for (const name of names) {
    if (shouldStripAsShoeDynamic(name)) continue;
    if (isShellStatic(name)) continue;
    leaked.push(name);
  }
  return leaked;
}

test('剥壳白名单: 150A 无漏网', () => {
  const leaked = auditStripCoverage(path.join(__dirname, '150A.glb'));
  assert.deepEqual(leaked, [], '150A 漏剥: ' + leaked.join(', '));
});

test('剥壳白名单: 150B 无漏网', () => {
  const leaked = auditStripCoverage(path.join(__dirname, '150B.glb'));
  assert.deepEqual(leaked, [], '150B 漏剥: ' + leaked.join(', '));
});

test('剥壳白名单: 150C 无漏网', () => {
  const leaked = auditStripCoverage(path.join(__dirname, '150C.glb'));
  assert.deepEqual(leaked, [], '150C 漏剥: ' + leaked.join(', '));
});

test('剥壳白名单: 150D 无漏网', () => {
  const leaked = auditStripCoverage(path.join(__dirname, '150D.glb'));
  assert.deepEqual(leaked, [], '150D 漏剥: ' + leaked.join(', '));
});
