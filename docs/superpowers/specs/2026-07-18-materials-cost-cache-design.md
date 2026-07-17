# 板材五金选择页 · 成本预览缓存 · 设计

- 日期: 2026-07-18
- 需求原文: 从板材五金选择页面跳转到成本透视页面之前，板材五金选择页面成本数据要缓存，用户从成本透视页面通过更换配置按钮跳回来看刚才的成本就不用重新计算，如果用户重新选择配置就重新计算。
- 目标页面: `miniprogram/cabinet/pages/materials/index.js`, `miniprogram/cabinet/pages/cost/index.js`
- 依赖模块: `miniprogram/utils/cost-engine.js`, `miniprogram/utils/bootstrap.js`
- 新增模块: `miniprogram/utils/materials-cost-cache.js`

## 1. 目标

避免 `materials ↔ cost` 页面往返时对同一 `plan + materials` 组合的重复 `costEngine.calc()`：

- 用户在 materials 选完 → 立即算价进入 cost 页 → 点 **更换配置** 回到 materials → materials 页应立即显示上一次的 cost，不再走 `await ensureCostDataReady + costEngine.calc` 的耗时链路。
- 若用户在 materials 页重新点了任何一张卡牌 → 视为"重新选择配置" → 正常重算并更新缓存。
- 缓存按 `plan.id` 长期驻留（应用生命周期内），跨方案切换、多次进出均可命中。

## 2. 需求要点（原文映射）

| # | 需求原文 | 落地位置 |
|---|---|---|
| 1 | 跳转到成本透视前，materials 页成本数据要缓存 | materials 页 `_computeCost()` 成功后 `cache.set(plan, materials, cost)` |
| 2 | 通过 更换配置 跳回来看刚才的成本就不用重新计算 | materials 页 `onLoad()` 先 `cache.get(plan, materials)`，命中即 setData 并 return |
| 3 | 用户重新选择配置就重新计算 | `_pick` → `_computeCost` 保持不动；signature 自动变化，`get` 会 miss |

## 3. 缓存作用域与失效触发（决策）

- **作用域**：按 `plan.id` 长期缓存（内存 Map，进程内）。跨方案切换后再回同一 plan 仍可命中。
- **失效触发**：
  - materials 选项变化 → signature 变 → `get` 返回 null（含错的顺手删）
  - `plan.cabinets` 变化 → signature 变 → miss
  - `plan.wall` 变化 → signature 变 → miss
  - `bootstrap.ensureCostDataReady({ force: true })` 被调用 → 价格字典要重拉 → `cache.clearAll()`

**不做**：
- 不写 `wx.setStorage`。应用重启后从零开始重算 —— YAGNI，且回避了 "字典版本 vs 缓存版本" 的持久化一致性问题。
- 不做 LRU / 容量上限。一个会话内 plan 数量有限，不构成内存风险；将来出现问题再加。

## 4. 架构

### 4.1 新增模块 `miniprogram/utils/materials-cost-cache.js`

```
utils/materials-cost-cache.js
  ├─ COST_INPUT_FIELDS_CABINET = [...]       // cost-engine.calc 实际读取的 cabinet 字段清单
  ├─ COST_INPUT_FIELDS_WALL    = [...]       // 同上, wall 侧
  │
  ├─ computeSignature(plan, materials)       // 纯函数, 返回稳定字符串
  │    └─ JSON.stringify({ M, C, W })
  │         M = 五项 materials 值按固定顺序
  │         C = plan.cabinets 每柜按清单挑字段
  │         W = plan.wall 按清单挑字段
  │
  ├─ get(plan, materials)                    // 命中: 返回 cost; 未命中: 删陈旧 entry, 返回 null
  ├─ set(plan, materials, cost)              // 覆盖写入
  └─ clearAll()                              // Map#clear
```

### 4.2 触点接线（3 处）

**`utils/bootstrap.js`**：
```js
const materialsCostCache = require('./materials-cost-cache.js');
async function ensureCostDataReady(opts) {
  const force = !!(opts && opts.force);
  if (force) materialsCostCache.clearAll();   // ← 新增
  await Promise.all([...]);                    // 原样
}
```

**`cabinet/pages/materials/index.js`**：
- `onLoad`：拿到 `plan` + `materials` 后：
  ```js
  const cached = materialsCostCache.get(plan, materials);
  if (cached) {
    this.setData({ cost: cached, dataReady: true, dataNotice: '' });
    return;   // 跳过 _computeCost, 也就跳过 ensureCostDataReady 的 await
  }
  this._computeCost();
  ```
- `_computeCost`：`costEngine.calc` **成功** 后紧跟 `materialsCostCache.set(plan, this.data.materials, cost)`。catch 分支不写。
- `_pick` 不改（其调用的 `_computeCost` 会覆盖写入）。

**`cabinet/pages/cost/index.js`**：
- `_computeCost`：`await ensureCostDataReady()` + `isAllReady()` 校验通过后：
  ```js
  const cached = materialsCostCache.get(plan, plan.materials || {});
  if (cached) {
    this.setData({ dataReady: true, dataNotice: '', cost: cached });
    return;
  }
  // 未命中 → 原 costEngine.calc 流程; 算完后 set 一次
  ```
  cost 页也 set 的意义：直接深链进 cost 页（例如从方案列表进）时缓存尚空，算完落缓存，后续 更换配置 → materials 页可以命中。

## 5. Signature 字段清单的对齐

`COST_INPUT_FIELDS_CABINET` / `COST_INPUT_FIELDS_WALL` 不拍脑袋写，实现时先 grep `cost-engine.js` 里所有从 `cabinet.*` 和 `wall.*` 读到的字段，把这份清单作为常量落进 `materials-cost-cache.js` 顶部，并加一行注释：

> 改动 cost-engine 输入面时需同步更新此清单。

这样能保证 **signature 相等 → 重算必然得同样 cost** 是充分条件，不会出现"缓存命中但结果实际已过期"的漏洞。

## 6. 错误处理

- `computeSignature` 抛错（理论上不会） → `get` / `set` 内 try/catch 兜底：`get` 返回 `null`（当作未命中，页面走原重算路径），`set` 静默失败（缓存本质是加速层，写不进不影响功能正确性）。
- `cost` 不做深拷贝。`costEngine.calc` 每次返回全新对象，页面 setData 后不改这个对象，共享同一引用是安全的。

## 7. 测试

新增 `tests/utils/materials-cost-cache.test.js`：

1. `set` 后同 plan + 同 materials 的 `get` 返回原 cost 引用
2. materials 里任一字段变化 → `get` 返回 null
3. `plan.cabinets` 变化（改一个尺寸）→ `get` 返回 null
4. `plan.wall` 变化 → `get` 返回 null
5. 不同 `plan.id` 之间不串（同 signature 也各存各的）
6. `clearAll` 后所有 `get` 返回 null
7. `get` 未命中时会顺手删掉陈旧 entry（用后续 set 观察，无遗留）

页面级不写集成测试 —— 页面接线只有 3 处显式改动，靠人工 QA + console 观察。

## 8. 手工验证清单（写完后跑一遍）

1. materials 选一套配置 → 立即算价 → cost 页 → **更换配置** 回到 materials → `cost` 应立即显示，不出现 loading 文案。
2. 上一步后再点一张卡牌 → cost 立即变化（`_pick` → `_computeCost` → 覆盖写入）。
3. cost 页点 **重试**（`ensureCostDataReady({force:true})`）→ 返回 materials 页 → 应重算（`clearAll` 生效）。
4. 深链直接进 cost 页 → 显示正常 → 更换配置进 materials 页 → 应立即命中缓存。

## 9. 不做的事（YAGNI）

- 持久化到 `wx.setStorage`
- LRU / 容量上限
- 页面 onShow 层监听 —— 两页均走 `wx.redirectTo` 摧毁旧页栈，`onLoad` 时机就够
- 深拷贝 cost
- 集成测试
