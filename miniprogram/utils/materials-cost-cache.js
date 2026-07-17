// miniprogram/utils/materials-cost-cache.js
//
// 内存缓存 (进程内, 不落 storage): key = plan.id, value = { signature, cost }。
// materials 页 ↔ cost 页往返时命中缓存, 避免对同一 plan + materials 组合的重复
// costEngine.calc()。签名相同 ⇒ 输入面等价 ⇒ 重算必然得同样 cost。
//
// 失效触发:
//  - materials 五项 / plan.cabinets 关键字段 / plan.wall 变化 → signature 变 → miss
//  - bootstrap.ensureCostDataReady({force:true}) → clearAll() (价格字典要重拉)
//
// 输入面清单 = cost-engine.js 里 calcModule / resolveGlbFile / calc 实际读到的
// cabinet.* 和 wall.* 字段。改动 cost-engine 输入面时须同步更新此清单。
const COST_INPUT_FIELDS_CABINET = ['kind', 'w', 'h', 'code'];
const COST_INPUT_FIELDS_WALL = ['w', 'h'];
const MATERIALS_FIELDS = ['panel', 'doorPanel', 'doorCraft', 'hardware', 'lighting'];

const store = new Map(); // planId -> { signature, cost }

function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj == null ? undefined : obj[f];
  return out;
}

function computeSignature(plan, materials) {
  const M = pick(materials || {}, MATERIALS_FIELDS);
  const C = ((plan && plan.cabinets) || []).map((c) => pick(c || {}, COST_INPUT_FIELDS_CABINET));
  const W = pick((plan && plan.wall) || {}, COST_INPUT_FIELDS_WALL);
  return JSON.stringify({ M, C, W });
}

function get(plan, materials) {
  try {
    const id = plan && plan.id;
    if (!id) return null;
    const entry = store.get(id);
    if (!entry) return null;
    const sig = computeSignature(plan, materials);
    if (entry.signature === sig) return entry.cost;
    // 陈旧: 顺手删, 避免 Map 长期驻留失效项
    store.delete(id);
    return null;
  } catch (e) {
    console.warn('[materials-cost-cache] get failed:', e);
    return null;
  }
}

function set(plan, materials, cost) {
  try {
    const id = plan && plan.id;
    if (!id) return;
    store.set(id, { signature: computeSignature(plan, materials), cost });
  } catch (e) {
    console.warn('[materials-cost-cache] set failed:', e);
  }
}

function clearAll() {
  store.clear();
}

module.exports = { computeSignature, get, set, clearAll };
