// tests/materials-cost-cache.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshCache() {
  const p = path.resolve(__dirname, '../miniprogram/utils/materials-cost-cache.js');
  delete require.cache[p];
  return require(p);
}

const PLAN_A = {
  id: 'plan-a',
  cabinets: [
    { kind: 'standard', w: 50, h: 230, code: 'a' },
    { kind: 'standard', w: 100, h: 230, code: 'a' },
  ],
  wall: { w: 480, h: 240 },
};
const M1 = { panel: 'panel_e2_domestic', doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none', hardware: 'domestic', lighting: 'none' };

test('computeSignature: 同输入 → 同签名 (稳定)', () => {
  const cache = freshCache();
  const s1 = cache.computeSignature(PLAN_A, M1);
  const s2 = cache.computeSignature(PLAN_A, M1);
  assert.equal(s1, s2);
});

test('computeSignature: materials 任一字段变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  ['panel', 'doorPanel', 'doorCraft', 'hardware', 'lighting'].forEach((k) => {
    const m = Object.assign({}, M1, { [k]: M1[k] + '_x' });
    assert.notEqual(cache.computeSignature(PLAN_A, m), base, k + ' 应改变签名');
  });
});

test('computeSignature: cabinets 关键字段变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const withResizedCabinet = Object.assign({}, PLAN_A, {
    cabinets: [
      Object.assign({}, PLAN_A.cabinets[0], { w: 60 }), // 50 → 60
      PLAN_A.cabinets[1],
    ],
  });
  assert.notEqual(cache.computeSignature(withResizedCabinet, M1), base);
});

test('computeSignature: cabinets 顺序变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const swapped = Object.assign({}, PLAN_A, {
    cabinets: [PLAN_A.cabinets[1], PLAN_A.cabinets[0]],
  });
  assert.notEqual(cache.computeSignature(swapped, M1), base);
});

test('computeSignature: wall 尺寸变 → 签名变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const wallW = Object.assign({}, PLAN_A, { wall: { w: 500, h: 240 } });
  assert.notEqual(cache.computeSignature(wallW, M1), base);
  const wallH = Object.assign({}, PLAN_A, { wall: { w: 480, h: 260 } });
  assert.notEqual(cache.computeSignature(wallH, M1), base);
});

test('computeSignature: cabinets 里非输入面字段变 → 签名不变', () => {
  const cache = freshCache();
  const base = cache.computeSignature(PLAN_A, M1);
  const withLabel = Object.assign({}, PLAN_A, {
    cabinets: [
      Object.assign({}, PLAN_A.cabinets[0], { label: '标 A', id: 'c1', extra: 999 }),
      PLAN_A.cabinets[1],
    ],
  });
  assert.equal(cache.computeSignature(withLabel, M1), base);
});

test('computeSignature: 缺 materials/wall 字段应容忍 (给默认空值, 不抛)', () => {
  const cache = freshCache();
  const s = cache.computeSignature({ id: 'x', cabinets: [] }, {});
  assert.equal(typeof s, 'string');
});

const COST_1 = { grandTotal: 1234, modules: [{ label: 'a' }] };
const COST_2 = { grandTotal: 9999, modules: [{ label: 'b' }] };

test('set 后同 plan + 同 materials 的 get 返回原 cost 引用', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  assert.equal(cache.get(PLAN_A, M1), COST_1);
});

test('materials 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const m2 = Object.assign({}, M1, { panel: 'panel_egger' });
  assert.equal(cache.get(PLAN_A, m2), null);
});

test('plan.cabinets 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const resized = Object.assign({}, PLAN_A, {
    cabinets: [Object.assign({}, PLAN_A.cabinets[0], { w: 60 }), PLAN_A.cabinets[1]],
  });
  assert.equal(cache.get(resized, M1), null);
});

test('plan.wall 变化 → get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const wallH = Object.assign({}, PLAN_A, { wall: { w: 480, h: 260 } });
  assert.equal(cache.get(wallH, M1), null);
});

test('不同 plan.id 之间不串 (同 signature 也各存各的)', () => {
  const cache = freshCache();
  const planB = Object.assign({}, PLAN_A, { id: 'plan-b' });
  cache.set(PLAN_A, M1, COST_1);
  assert.equal(cache.get(planB, M1), null); // 同 signature 但 id 不同 → miss
  cache.set(planB, M1, COST_2);
  assert.equal(cache.get(PLAN_A, M1), COST_1);
  assert.equal(cache.get(planB, M1), COST_2);
});

test('clearAll 后所有 get 返回 null', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  cache.clearAll();
  assert.equal(cache.get(PLAN_A, M1), null);
});

test('get miss 时顺手删陈旧 entry: 覆盖 set 前无遗留', () => {
  const cache = freshCache();
  cache.set(PLAN_A, M1, COST_1);
  const m2 = Object.assign({}, M1, { panel: 'panel_egger' });
  // signature 不匹配 → 应删除 entry
  assert.equal(cache.get(PLAN_A, m2), null);
  // 再用原 M1 查, 也应 miss (刚才那次调用把 entry 删了)
  assert.equal(cache.get(PLAN_A, M1), null);
});

test('无 plan.id 时 set/get 不抛, 且各自独立不写入', () => {
  const cache = freshCache();
  const noId = Object.assign({}, PLAN_A, { id: undefined });
  cache.set(noId, M1, COST_1); // 不抛
  assert.equal(cache.get(noId, M1), null); // 未持久化 → miss
});
