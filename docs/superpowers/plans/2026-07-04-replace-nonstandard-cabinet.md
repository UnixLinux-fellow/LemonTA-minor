# 定制尺寸柜可替换模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 布满（`isFull`）后允许用户在 picker 中把最后一个定制尺寸柜（`kind === 'nonstandard'`，宽度 = `nonStandardWidth`，默认 code `e1`/`e2`）替换成 50cm 或 100cm 系列的标准模型，宽度和位置保持不变；picker 尺寸 tab 根据宽度自动锁定：`<60cm` 锁 50，`>=60cm` 锁 100。

**Architecture:** 新增纯函数 `replaceNonStandard(state, { code })` 到 `layout-engine.js`（只改 `it.code`，宽度/isFull 不变）。在 `pages/design/index.js` 的 `recompute()` 里改造 `isFull` 分支：有非标柜时锁定 sizeTab、picker 保持显示；`onPickModel` 增加"若 isFull 且存在非标柜则调 replaceNonStandard"分支。3D、WXML、WXSS 均不动。

**Tech Stack:** WeChat 小程序（原生 JS，无框架），`node tests/run.js` 做 pure-util 断言。3D 用 `three-renderer.js`（不改）。

**Spec reference:** `docs/superpowers/specs/2026-07-04-replace-nonstandard-cabinet-design.md`

---

## File Structure

- **Modify** `miniprogram/cabinet/utils/layout-engine.js` — 新增 `replaceNonStandard`，加到 `module.exports`。约 15 行新增。
- **Modify** `tests/run.js` — 新增 `group('layout-engine.replaceNonStandard', ...)` 3-4 个断言 group。约 60 行新增。
- **Modify** `miniprogram/cabinet/pages/design/index.js` — `recompute()` 里改 `isFull` 分支；`onPickModel` 增加 `isFull + 非标柜` 分支。约 25 行改动。

**不动**：`three-renderer.js`、`cabinet-model.js`、`cabinet-rules.js`、`design/index.wxml`、`design/index.wxss`、cost/materials 相关流程。

---

## Task 1: 新增 `replaceNonStandard` 纯函数

**Files:**
- Modify: `miniprogram/cabinet/utils/layout-engine.js` — 在 `replaceLast`（当前 line 227-245）之后、`isOnlyFirstCabinet`（当前 line 249）之前插入
- Test: `tests/run.js` — 在现有 `layout-engine.replaceLast 无标准柜时返回失败` group 之后（约 line 222）追加

- [ ] **Step 1: 写失败的测试**

打开 `tests/run.js`，在 `group('layout-engine.replaceLast 无标准柜时返回失败', ...)` 结束的 `});` 之后（约 line 222 后）追加：

```javascript
group('layout-engine.replaceNonStandard 基本替换', () => {
  // 480 无转角 → standardWidth=400, nonStandardWidth=76 → 落非标 e2 (>60)
  const state = layout.init({ wall: { w: 480, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  for (let i = 0; i < 7; i++) layout.addNext(state, { code: 'a', size: 50 });
  truthy(state.meta.isFull, '前置：已布满');
  const ns = state.items.find((it) => it.kind === 'nonstandard');
  truthy(ns, '前置：存在非标柜');
  eq(ns.code, 'e2', '初始 code = e2');
  const originalW = ns.w;

  const r = layout.replaceNonStandard(state, { code: 'a' });
  eq(r.ok, true, '替换成功');
  eq(ns.code, 'a', 'code 已更新为 a');
  eq(ns.w, originalW, '宽度不变');
  eq(state.meta.isFull, true, 'isFull 不变');
  eq(state.meta.nonStandardPlaced, true, 'nonStandardPlaced 不变');
});

group('layout-engine.replaceNonStandard 幂等', () => {
  const state = layout.init({ wall: { w: 480, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  for (let i = 0; i < 7; i++) layout.addNext(state, { code: 'a', size: 50 });
  const before = state.items.length;
  layout.replaceNonStandard(state, { code: 'b' });
  const r = layout.replaceNonStandard(state, { code: 'b' });
  eq(r.ok, true, '重复替换成功');
  eq(state.items.length, before, 'items 长度不变');
  const ns = state.items.find((it) => it.kind === 'nonstandard');
  eq(ns.code, 'b', 'code 保持 b');
});

group('layout-engine.replaceNonStandard 无非标柜时失败', () => {
  // 320 无转角 → standardWidth=250, nonStandardWidth=320-4-250=66
  // 单独构造一个不落非标的场景：手动清空非标标记
  const synthetic = {
    items: [
      { kind: 'sk', code: 'SK', w: 2, h: 240, side: 'left' },
      { kind: 'standard', code: 'a', w: 50, h: 230, isFirst: true },
      { kind: 'sk', code: 'SK', w: 2, h: 240, side: 'right' },
    ],
    meta: {
      wall: { w: 100, h: 240 },
      cornerType: 'WZJ',
      hasRaise: false,
      standardWidth: 50,
      standardUsed: 50,
      nonStandardWidth: 30,
      color: 'white',
      showDoor: false,
      isFull: true,
      nonStandardPlaced: false,
    },
  };
  const r = layout.replaceNonStandard(synthetic, { code: 'a' });
  eq(r.ok, false, '无非标柜应失败');
  truthy(/无定制尺寸柜/.test(r.message || ''), '失败提示含「无定制尺寸柜」');
});

group('layout-engine.replaceNonStandard 不影响其他 items', () => {
  const state = layout.init({ wall: { w: 480, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  for (let i = 0; i < 7; i++) layout.addNext(state, { code: 'a', size: 50 });
  const before = state.items.map((it) => ({ kind: it.kind, code: it.code, w: it.w }));
  layout.replaceNonStandard(state, { code: 'c' });
  const after = state.items.map((it) => ({ kind: it.kind, code: it.code, w: it.w }));
  // 除了 nonstandard 那一项，其他都应一致
  const changes = [];
  for (let i = 0; i < before.length; i++) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) changes.push(i);
  }
  eq(changes.length, 1, '仅一个 item 变化');
  eq(after[changes[0]].kind, 'nonstandard', '变化项是 nonstandard');
});
```

- [ ] **Step 2: 运行测试确认新组失败**

Run: `node tests/run.js`
Expected: 新 4 个 group 都出现 `TypeError: layout.replaceNonStandard is not a function` 或类似错误；已有 group 全部通过。

- [ ] **Step 3: 在 layout-engine.js 中实现 `replaceNonStandard`**

打开 `miniprogram/cabinet/utils/layout-engine.js`。在 `replaceLast` 函数末尾的 `}` 之后（当前 line 245）、`isOnlyFirstCabinet` 之前（当前 line 247 的注释之前），插入：

```javascript
// 替换最后一个非标柜（定制尺寸柜）的模型 code。
// 宽度不变，位置不变，isFull 不变。仅改 code。
function replaceNonStandard(state, { code }) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.kind !== 'nonstandard') continue;
    it.code = code;
    return { ok: true };
  }
  return { ok: false, message: '当前布局无定制尺寸柜可替换' };
}
```

然后在文件末尾的 `module.exports` 中，`replaceLast,` 之后追加 `replaceNonStandard,`：

```javascript
module.exports = {
  init,
  addNext,
  removeLast,
  replaceFirst,
  replaceLast,
  replaceNonStandard,
  isOnlyFirstCabinet,
  applyColor,
  toggleDoor,
  inLastSlot,
  standardRemaining,
  serialize,
  flattenCabinets,
  renderRows,
  SK_WIDTH,
  CORNER_WIDTH,
  STD_HEIGHT,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/run.js`
Expected: 输出 `N passed, 0 failed`，其中 N = 原有断言数 + 新增 group 里的所有断言数。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/cabinet/utils/layout-engine.js tests/run.js
git commit -m "feat(layout): 新增 replaceNonStandard 用于替换非标柜 code"
```

---

## Task 2: 改造 `recompute()` — isFull 分支根据非标柜宽度锁 sizeTab

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js:301-359`

- [ ] **Step 1: 定位 `recompute()` 函数**

Run: `grep -n "^  recompute" miniprogram/cabinet/pages/design/index.js`
Expected: 找到 `301:  recompute() {`

- [ ] **Step 2: 用 Edit 替换 `isFull` 分支**

找到（约 line 310-320）：

```javascript
    if (state.meta.isFull) {
      show50 = false;
      show100 = false;
    } else if (remaining < 100) {
      // 末块若是 50 且换 100 后仍能装下，则允许 100cm tab
      const replaceTo100Ok = last && (state.meta.standardUsed - last.w + 100) <= state.meta.standardWidth;
      if (!replaceTo100Ok) {
        show100 = false;
        sizeTab = 50;
      }
    }
```

替换为：

```javascript
    if (state.meta.isFull) {
      // 布满态：若存在非标柜，picker 保持显示并锁 sizeTab；否则维持原「隐藏 picker」行为
      const ns = state.items.find((it) => it.kind === 'nonstandard');
      if (ns) {
        if (ns.w < 60) {
          show50 = true;
          show100 = false;
          sizeTab = 50;
        } else {
          show50 = false;
          show100 = true;
          sizeTab = 100;
        }
      } else {
        show50 = false;
        show100 = false;
      }
    } else if (remaining < 100) {
      // 末块若是 50 且换 100 后仍能装下，则允许 100cm tab
      const replaceTo100Ok = last && (state.meta.standardUsed - last.w + 100) <= state.meta.standardWidth;
      if (!replaceTo100Ok) {
        show100 = false;
        sizeTab = 50;
      }
    }
```

**注意事项**：
- B-On 高亮反查代码在 `recompute` 更下方（约 line 326-329），保持不变。首次进入布满态时非标柜 code 是 `e1`/`e2` 不在 picker 列表 → `selIdx = -1` 无高亮。用户点某个模型后 `it.code` 变成如 `a`，反查匹配 → 高亮该卡片。符合 spec §5.2。
- 如果 `last`（最后一个标准柜）在布满态下依然是最后一个，B-On 反查中的 `last.w === sizeTab` 判断可能匹配。这在 spec 中不影响，因为 sizeTab 已经被 `isFull` 分支强制锁定为非标柜宽度对应值，而 `last` 是最后一个标准柜，其 `w` 就是 50 或 100，恰好等于锁定的 sizeTab；随后按 `list.findIndex((m) => m.code === last.code)` 查——这会让某个 picker 卡片高亮为"最后一个标准柜的 code"，这不是我们想要的。**需要额外修复**：在 isFull 分支下强制 `selIdx = -1`。

因此，还需要修改 B-On 反查代码。找到（约 line 325-329）：

```javascript
    // B-On：picker 高亮跟随末块
    let selIdx = -1;
    if (last && last.w === sizeTab) {
      selIdx = list.findIndex((m) => m.code === last.code);
    }
```

替换为：

```javascript
    // B-On：picker 高亮跟随末块。布满态下末块指非标柜，用 nonstandard code 反查。
    let selIdx = -1;
    if (state.meta.isFull) {
      const ns = state.items.find((it) => it.kind === 'nonstandard');
      if (ns) selIdx = list.findIndex((m) => m.code === ns.code);
    } else if (last && last.w === sizeTab) {
      selIdx = list.findIndex((m) => m.code === last.code);
    }
```

- [ ] **Step 3: 运行现有测试确认无回归**

Run: `node tests/run.js`
Expected: 全部通过（Task 2 只改页面逻辑，layout-engine 测试不受影响）。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/cabinet/pages/design/index.js
git commit -m "feat(design): 布满态 picker 锁定 sizeTab 并反查非标柜 code"
```

---

## Task 3: 改造 `onPickModel` — isFull 分支调 replaceNonStandard

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js:368-385`

- [ ] **Step 1: 定位 `onPickModel`**

Run: `grep -n "^  onPickModel" miniprogram/cabinet/pages/design/index.js`
Expected: 找到 `368:  onPickModel(e) {`

- [ ] **Step 2: 用 Edit 替换整个 `onPickModel` 函数**

找到当前（约 line 368-385）：

```javascript
  onPickModel(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.modelList[idx];
    if (!m) return;
    // 左转角场景下，初始 state 没有任何 standard，replaceLast 会失败；
    // 此时点 picker 的语义应当是"放第一个标准柜"，退化为 addNext。
    const hasStandard = this._state.items.some((it) => it.kind === 'standard');
    const r = hasStandard
      ? layoutEngine.replaceLast(this._state, { code: m.code, size: this.data.sizeTab })
      : layoutEngine.addNext(this._state, { code: m.code, size: this.data.sizeTab });
    if (!r.ok) {
      this.showToast(r.message || '替换失败');
      return;
    }
    // 高亮先按用户点的 idx 设置；recompute 末尾会按"末块镜像"再校准一次
    this.setData({ selectedModelIdx: idx });
    this.recompute();
  },
```

替换为：

```javascript
  onPickModel(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.modelList[idx];
    if (!m) return;
    const state = this._state;

    // 布满态且存在非标柜 → 只改非标柜 code
    if (state.meta.isFull) {
      const ns = state.items.find((it) => it.kind === 'nonstandard');
      if (ns) {
        const r = layoutEngine.replaceNonStandard(state, { code: m.code });
        if (!r.ok) {
          this.showToast(r.message || '替换失败');
          return;
        }
        this.setData({ selectedModelIdx: idx });
        this.recompute();
        return;
      }
      // 布满但无非标柜（罕见）→ picker 本来也是隐藏的，理论上到不了这里
      return;
    }

    // 非布满态：原有逻辑
    // 左转角场景下，初始 state 没有任何 standard，replaceLast 会失败；
    // 此时点 picker 的语义应当是"放第一个标准柜"，退化为 addNext。
    const hasStandard = state.items.some((it) => it.kind === 'standard');
    const r = hasStandard
      ? layoutEngine.replaceLast(state, { code: m.code, size: this.data.sizeTab })
      : layoutEngine.addNext(state, { code: m.code, size: this.data.sizeTab });
    if (!r.ok) {
      this.showToast(r.message || '替换失败');
      return;
    }
    // 高亮先按用户点的 idx 设置；recompute 末尾会按"末块镜像"再校准一次
    this.setData({ selectedModelIdx: idx });
    this.recompute();
  },
```

- [ ] **Step 3: 运行现有测试确认无回归**

Run: `node tests/run.js`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/cabinet/pages/design/index.js
git commit -m "feat(design): 布满态点 picker 卡片替换非标柜 code"
```

---

## Task 4: 人工验证（微信开发者工具）

**Files:** 无（人工测试）

- [ ] **Step 1: 打开项目**

- 启动微信开发者工具，打开 LemonTA 项目
- 如果提示 npm，点击「工具 → 构建 npm」

- [ ] **Step 2: 场景 A — 非标柜 <60cm，picker 锁 50 系列**

- 新建方案：墙宽 `W=480 H=260`，无转角，无加高
- 进入 design 页 → 加几个 50a 直到布满（`standardWidth=400`，加 7 个 50 满）
- 布满后：非标柜 `nonStandardWidth=76`，*但 76 >= 60*，picker 应锁 100 系列。所以此场景实际是 §7.2 中的场景 2。**改用**墙宽 `W=340 H=240 WZJ` 让非标 <60:
  - `standardWidth = 340 - 4 - 0 = 336 → floor(50) = 300`，非标 = 340-4-300 = 36 → 落非标（36 < 40 不落，找下一个）
  - 实际找一个能落非标且 <60 的墙宽。经验：`W=344`：`standardWidth = 344-4=340 → 300`，非标=40，落 e1，40<60 → 锁 50 系列 ✓
- 用 W=344 H=240 WZJ 试：布满后 picker 显示 50cm tab、模型卡片全部可见、无卡片高亮
- 点 50cm 中的 `b` → 3D 中非标柜位置从 e1 变为 50b 模型（renderer 会横向压缩到 40cm 宽），`b` 卡片高亮
- 点 50cm 中的 `c` → 3D 更新到 50c，`c` 卡片高亮

- [ ] **Step 3: 场景 B — 非标柜 ≥60cm，picker 锁 100 系列**

- 新建方案：墙宽 `W=480 H=260 WZJ` → `standardWidth=400`，非标=76，落 e2
- 加 7 个 50a 到布满
- 布满后：picker 显示 100cm tab、无卡片高亮
- 点 100cm 中的 `d` → 3D 非标柜从 e2 变为 100d（横向压缩到 76cm 宽），`d` 卡片高亮

- [ ] **Step 4: 场景 C — 60cm 边界**

- 找一个非标柜宽度正好 60 的墙宽。`nonStandard = W - 4 - standardWidth`；例如 W=464 → standardWidth=400、非标=60。
- 试 W=464 H=260 WZJ：非标 60 → chooseNonStandardCode(60) 返回 'e1'（`width <= 60` 走 e1 分支）
- 但 recompute 里 `ns.w < 60` 走 50 分支、`>= 60` 走 100 分支 → 60 应锁 **100** 系列
- 验证：布满后 picker 显示 100cm tab

- [ ] **Step 5: 场景 D — 布满但无非标柜（picker 保持隐藏）**

- 找一个非标宽 <40 或 >120 的墙宽让 `placeNonStandardAndClose` 不落非标。例如 W=304 H=240 WZJ：`standardWidth=300`、非标=0 → 不落非标。
- 加 6 个 50a 到布满
- 布满后 picker 应完全隐藏（`show50=false, show100=false`），符合原行为

- [ ] **Step 6: 场景 E — 退出布满后重新填满**

- 从场景 B 结束状态出发（非标已被替换为 100d）
- 点「上一模块」→ 非标柜和右收口一起被 `removeLast` 删除，退出布满态
- 再点「下一模块」→ 补最后一个 50a → 再次布满 → 非标柜重新落，code 回到 `e2`（因为 `chooseNonStandardCode(76)` 返回 e2）
- picker 应重新显示 100 tab，无高亮

- [ ] **Step 7: 场景 F — materials/cost 页反映替换**

- 从场景 A 结束（非标已替换为 50b）出发
- 点「确认布局」→ 进入 materials 页 → 明细里最后一柜应显示 code `b`（而不是 e1）
- 进入 cost 页 → 板材/五金明细按 50b 计算

- [ ] **Step 8: 场景 G — 加高、颜色、门板不影响新逻辑**

- 新建方案带加高（W=480 H=270 WZJ 加高）
- 布满 → 切颜色、切门板 → 布满态 picker 仍显示 100 系列、无高亮
- 点 100cm 中的 `k` → 3D 非标柜位置更新到 100k；加高排的对应位置也同步刷新（因为 `renderRows` 用 `state.items`，code 已改）

- [ ] **Step 9: 最终验证 milestone**

若全部场景通过，功能完成。若失败：
- picker 未显示：检查 `recompute` 中 `isFull` 分支是否正确设置了 `show50` / `show100`
- 3D 未更新 code：检查 `_renderer.setItems(layoutEngine.renderRows(state))` 是否在 `recompute` 末尾被调用（原有代码，不应被本次改动影响）
- 高亮跑到错的卡片：检查 B-On 反查是否在 `isFull` 分支下用了 `ns.code` 而不是 `last.code`

---

## Spec Coverage Verification

| Spec 章节 | 覆盖 Task |
|---|---|
| §2 布满后 picker 保持显示 | Task 2 Step 2 |
| §2 <60cm 锁 50、>=60cm 锁 100 | Task 2 Step 2 |
| §2 点 picker 立即替换 code、宽度/位置不变 | Task 1 Step 3、Task 3 Step 2 |
| §3 不改宽度、不改标准柜替换、不改初次落非标 code | Task 1 Step 3（只改 code）、其他不动 |
| §4 交互规约（无非标柜时 picker 隐藏、上一模块删非标） | Task 2 Step 2（else 分支保持原行为）、`removeLast` 原有逻辑不动 |
| §5.1 `replaceNonStandard` | Task 1 |
| §5.2 recompute isFull 分支 | Task 2 |
| §5.2 B-On 高亮反查（非标 code 不在列表→-1；替换后自然匹配） | Task 2 Step 2（isFull 分支下用 ns.code 反查） |
| §5.3 `onPickModel` 布满态分支 | Task 3 |
| §5.4 three-renderer 不动 | N/A |
| §5.5 WXML/WXSS 不动 | N/A |
| §6 边界（60cm、无非标、退出重进） | Task 4 场景 C/D/E |
| §7.1 单元测试 | Task 1 Step 1 |
| §7.2 人工测试 | Task 4 |

## Self-Review Notes

- **占位符扫描**：无 TBD/TODO；每一步都给出完整代码或命令。
- **类型一致性**：`replaceNonStandard(state, { code })` 签名跨 Task 1/2/3 一致；返回值 `{ ok: bool, message?: string }` 与 `replaceLast`/`replaceFirst` 一致。
- **文件路径**：全部为绝对相对根目录路径，已核对。
- **spec 覆盖表**：spec §2/§4/§5 每个条目均有对应 Task；§6 边界、§7 测试均覆盖。
- **新发现**：spec 里没提到 B-On 反查在 `isFull` 分支下需要专门处理（否则会用最后一个标准柜的 code 高亮 picker 中的错误卡片）。Task 2 Step 2 补充了这一修复。
