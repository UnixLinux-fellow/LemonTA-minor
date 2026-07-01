# Replace-Last-Cabinet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing "replace first cabinet" capability so the last added standard cabinet in `pages/design` can be replaced instantly by picking another model in the bottom picker, with 3D synced in real time.

**Architecture:** Add a new pure function `replaceLast(state, { code, size })` to `utils/layout-engine.js`. Repurpose the picker's `onPickModel` from "set highlight + wait for button" to "set highlight + replace last + recompute". `recompute()` mirrors the last cabinet back into `selectedModelIdx` so the picker highlight tracks the 3D last cabinet (B-On in the spec). The existing "替换首块" button is removed; the existing "上一模块" button stays.

**Tech Stack:** WeChat mini-program (vanilla JS, no framework). Tests are plain `node tests/run.js` assertions over pure utils. UI is `.wxml` + `.wxss` + `.js`. 3D via `three-renderer.js` (untouched).

**Spec reference:** `docs/superpowers/specs/2026-06-25-replace-last-cabinet-design.md`

**Repo note:** This project is NOT a git repo (`Is a git repository: false`). The "commit" steps in standard plans are replaced with **verification steps**: after each code change run `node tests/run.js` and confirm all assertions pass.

---

## File Structure

Files touched in this plan:

- **Modify** `miniprogram/utils/layout-engine.js` — add `replaceLast`, export it. ~30 lines added.
- **Modify** `tests/run.js` — add a new `group('layout-engine.replaceLast', ...)` block. ~50 lines added.
- **Modify** `miniprogram/pages/design/index.js` — rewrite `onPickModel`, augment `recompute` with B-On reverse-lookup, delete `onReplaceFirst`, delete `allowReplaceFirst` plumbing. ~40 lines net change.
- **Modify** `miniprogram/pages/design/index.wxml` — collapse `.action-bar` to two buttons.

**Untouched:** `three-renderer.js`, `cabinet-rules.js`, `cabinet-model.js`, materials/cost pages, page `.wxss`.

---

## Task 1: Add `replaceLast` to layout-engine

**Files:**
- Modify: `miniprogram/utils/layout-engine.js` (append after `replaceFirst`, before `isOnlyFirstCabinet`)
- Test: `tests/run.js` (append new group after existing `layout-engine.removeLast 第一格保护` block)

- [ ] **Step 1: Write the failing tests**

Open `tests/run.js`. After the existing `group('layout-engine.removeLast 第一格保护', ...)` block (around line 119), append:

```javascript
group('layout-engine.replaceLast 单柜场景（等价于 replaceFirst）', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  // standardWidth=250, 初始首块 50cm a, standardUsed=50
  const r = layout.replaceLast(state, { code: 'b', size: 100 });
  eq(r.ok, true, '单柜替换为 100b 成功');
  eq(state.meta.standardUsed, 100, '标准已用=100');
  const stds = state.items.filter((it) => it.kind === 'standard');
  eq(stds.length, 1, '仍只有 1 个标准柜');
  eq(stds[0].code, 'b', '末块 code=b');
  eq(stds[0].w, 100, '末块 w=100');
  eq(stds[0].isFirst, true, 'isFirst 标记保留');
  eq(state.meta.isFull, false, '未布满（250-100=150 剩余）');
});

group('layout-engine.replaceLast 多柜场景', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  layout.addNext(state, { code: 'a', size: 50 }); // 第 2 柜
  layout.addNext(state, { code: 'a', size: 50 }); // 第 3 柜
  // 此时 3 个 50a，standardUsed=150
  const r = layout.replaceLast(state, { code: 'c', size: 100 });
  eq(r.ok, true, '第 3 柜替换为 100c 成功');
  eq(state.meta.standardUsed, 200, '50+50+100=200');
  const stds = state.items.filter((it) => it.kind === 'standard');
  eq(stds.length, 3, '仍是 3 个标准柜');
  eq(stds[0].isFirst, true, '首块 isFirst 不变');
  eq(stds[1].code, 'a', '第 2 柜未动');
  eq(stds[1].w, 50, '第 2 柜宽度未动');
  eq(stds[2].code, 'c', '第 3 柜替换为 c');
  eq(stds[2].w, 100, '第 3 柜宽=100');
  eq(state.meta.isFull, false, '250-200=50 仍可放，未布满');
});

group('layout-engine.replaceLast 替换后刚好填满 → 自动布满', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=100
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=150
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=200
  // 还差 50 才到 standardWidth=250
  const r = layout.replaceLast(state, { code: 'b', size: 100 });
  eq(r.ok, true, '末块 50→100 成功');
  eq(state.meta.standardUsed, 250, '正好填满');
  eq(state.meta.isFull, true, '触发 placeNonStandardAndClose');
  truthy(state.items.some((it) => it.kind === 'nonstandard'), '已落非标');
  truthy(state.items.some((it) => it.kind === 'sk' && it.side === 'right'), '已落右收口');
});

group('layout-engine.replaceLast 越界应失败且不修改 state', () => {
  // 真实墙宽下 standardWidth 一定是 50 的倍数，replaceLast 的越界分支在
  // 真实流程下难以触发；用人工构造的 state 直接验证防御逻辑。
  const synthetic = {
    items: [
      { kind: 'sk', code: 'SK', w: 2, h: 240, side: 'left' },
      { kind: 'standard', code: 'a', w: 50, h: 230, isFirst: true },
    ],
    meta: {
      wall: { w: 84, h: 240 },
      cornerType: 'WZJ',
      hasRaise: false,
      standardWidth: 80,
      standardUsed: 50,
      nonStandardWidth: 30,
      color: 'white',
      showDoor: false,
      isFull: false,
      nonStandardPlaced: false,
    },
  };
  // newUsed = 50 - 50 + 100 = 100 > standardWidth(80) → 越界
  const r = layout.replaceLast(synthetic, { code: 'b', size: 100 });
  eq(r.ok, false, '越界应失败');
  truthy(/剩余宽度不足/.test(r.message || ''), '失败提示包含「剩余宽度不足」');
  eq(synthetic.meta.standardUsed, 50, '失败时 standardUsed 不变');
  eq(synthetic.items[1].w, 50, '失败时末块 w 不变');
  eq(synthetic.items[1].code, 'a', '失败时末块 code 不变');
});

group('layout-engine.replaceLast 无标准柜时返回失败', () => {
  // 构造仅有 sk 没有 standard 的人工 state
  const synthetic = {
    items: [{ kind: 'sk', code: 'SK', w: 2, h: 240, side: 'left' }],
    meta: {
      wall: { w: 84, h: 240 },
      cornerType: 'WZJ',
      hasRaise: false,
      standardWidth: 0,
      standardUsed: 0,
      nonStandardWidth: 0,
      color: 'white',
      showDoor: false,
      isFull: false,
      nonStandardPlaced: false,
    },
  };
  const r = layout.replaceLast(synthetic, { code: 'a', size: 50 });
  eq(r.ok, false, '无标准柜应失败');
});
```

- [ ] **Step 2: Run tests to verify they fail with "function not defined"**

Run: `node tests/run.js`

Expected: tests fail with `TypeError: layout.replaceLast is not a function` (the new groups error out; existing groups still pass).

- [ ] **Step 3: Implement `replaceLast` in layout-engine.js**

Open `miniprogram/utils/layout-engine.js`. After the `replaceFirst` function (ends around line 221), before `isOnlyFirstCabinet`, insert:

```javascript
// 替换最后一个标准模块（含 isFirst 那一格在内）
// size 变化不可使 standardUsed 超过 standardWidth，否则越界返回失败、不修改 state
function replaceLast(state, { code, size }) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.kind !== 'standard') continue;
    const newUsed = state.meta.standardUsed - it.w + size;
    if (newUsed > state.meta.standardWidth) {
      return { ok: false, message: '剩余宽度不足，无法放置该尺寸柜体' };
    }
    state.meta.standardUsed = newUsed;
    it.code = code;
    it.w = size;
    // 与 replaceFirst 一致：刚好填满则自动落非标 + 右转角 + 右收口
    if (state.meta.standardUsed >= state.meta.standardWidth) {
      placeNonStandardAndClose(state);
    }
    return { ok: true };
  }
  return { ok: false, message: '未找到可替换的标准模块' };
}
```

Then in the `module.exports` block at the bottom (around line 354), add `replaceLast` to the export list:

```javascript
module.exports = {
  init,
  addNext,
  removeLast,
  replaceFirst,
  replaceLast,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`

Expected: all groups pass. Final line shows `N passed, 0 failed` (N = previous count + 5 new groups' assertions).

- [ ] **Step 5: Verification milestone**

No git in this repo. Mentally checkpoint: `replaceLast` is now a tested pure function. Move on to Task 2.

---

## Task 2: Rewrite design page JS for instant replace + B-On mirror

**Files:**
- Modify: `miniprogram/pages/design/index.js`

This task has no automated test (page-level UI logic). Verify by running `node tests/run.js` after to ensure no util regression, plus manual smoke (Task 4).

- [ ] **Step 1: Update `onPickModel` to do instant replace**

Open `miniprogram/pages/design/index.js`. Find `onPickModel` (around line 370):

```javascript
onPickModel(e) {
  const idx = e.currentTarget.dataset.idx;
  this.setData({ selectedModelIdx: idx });
},
```

Replace the entire function body with:

```javascript
onPickModel(e) {
  const idx = e.currentTarget.dataset.idx;
  const m = this.data.modelList[idx];
  if (!m) return;
  // 即时替换末块（含首块场景）
  const r = layoutEngine.replaceLast(this._state, {
    code: m.code,
    size: this.data.sizeTab,
  });
  if (!r.ok) {
    this.showToast(r.message || '替换失败');
    return;
  }
  // 高亮先按用户点的 idx 设置；recompute 末尾会按"末块镜像"再校准一次
  this.setData({ selectedModelIdx: idx });
  this.recompute();
},
```

- [ ] **Step 2: Delete `onReplaceFirst` handler**

Still in `index.js`, find `onReplaceFirst` (around line 409). Delete the entire function including its leading comment. The block to delete:

```javascript
// 仅在"只有首块"状态下可用：用当前 picker 选中的模型 + size tab 替换首块。
// 替换不会推进光标，只调整首块的 code/w 和 standardUsed。
onReplaceFirst() {
  const state = this._state;
  if (!layoutEngine.isOnlyFirstCabinet(state)) return; // 防御，按钮已隐藏
  const list = this.data.modelList;
  const m = list[this.data.selectedModelIdx] || list[0];
  if (!m) return;
  const r = layoutEngine.replaceFirst(state, {
    code: m.code,
    size: this.data.sizeTab,
  });
  if (!r.ok) {
    this.showToast(r.message || '替换失败');
    return;
  }
  this.recompute();
},
```

- [ ] **Step 3: Remove `allowReplaceFirst` from data initial state**

In the `data: { ... }` block near the top of the page (around line 28), delete this line:

```javascript
allowReplaceFirst: false,
```

- [ ] **Step 4: Simplify `recompute()` — remove allowReplaceFirst branch, add B-On mirror**

Find `recompute()` (around line 302). The current body has an `allowReplaceFirst` calculation and uses it in the `canHave100` expression. Replace the whole function with:

```javascript
recompute() {
  const state = this._state;
  // 根据剩余标准段宽度决定 50/100 按钮的可用性
  // 进入最后一格时 (remaining < 50): 隐藏与非标尺寸不匹配的按钮
  const remaining = layoutEngine.standardRemaining(state);
  let show50 = true;
  let show100 = true;
  let sizeTab = this.data.sizeTab;
  if (state.meta.isFull) {
    show50 = false;
    show100 = false;
  } else {
    // 末块替换/新增都按当前实际剩余宽度判定：
    // 若末块本身是 50 且想换成 100，"可放下 100" 等价于 (remaining + 末块w) >= 100，
    // 但 remaining 已是「standardWidth - standardUsed」、未含末块，所以仍用 remaining 判断够不够"再放一个"。
    // 替换 50→100 的可行性由 replaceLast 自己用 standardUsed - oldW + size 判定，UI 不需提前禁止。
    if (remaining < 100) {
      // 仍可能允许 100：当前末块若是 50 而 remaining 是 50，替换为 100 后 newUsed = used-50+100 = standardWidth，合法
      const stds = state.items.filter((it) => it.kind === 'standard');
      const last = stds[stds.length - 1];
      const replaceTo100Ok = last && (state.meta.standardUsed - last.w + 100) <= state.meta.standardWidth;
      if (!replaceTo100Ok) {
        show100 = false;
        sizeTab = 50;
      }
    }
  }
  const list = sizeTab === 50 ? this._grouped.s50 : this._grouped.s100;
  const prevModelKey = (this.data.modelList || []).map((m) => m.name).join('|');
  const nextModelKey = list.map((m) => m.name).join('|');
  const modelListChanged = prevModelKey !== nextModelKey;
  // B-On：picker 高亮跟随末块
  const stds = state.items.filter((it) => it.kind === 'standard');
  const last = stds[stds.length - 1];
  let selIdx = -1;
  if (last && last.w === sizeTab) {
    selIdx = list.findIndex((m) => m.code === last.code);
  }
  this.setData({
    items: state.items,
    meta: state.meta,
    standardWidth: state.meta.standardWidth,
    standardUsed: state.meta.standardUsed,
    nonStandardWidth: state.meta.nonStandardWidth,
    color: state.meta.color,
    colorCss: COLOR_CSS[state.meta.color] || COLOR_CSS.white,
    showDoor: state.meta.showDoor,
    confirmReady: state.meta.isFull,
    nextBtnText: state.meta.isFull ? '确认布局' : '下一模块',
    sizeTab,
    modelList: list,
    show50,
    show100,
    remainingStd: remaining,
    selectedModelIdx: selIdx,
  }, () => {
    // modelList 变了（剩余宽度触发 50/100 切换）才重建 thumb canvas，避免空动作
    if (modelListChanged) {
      this._refreshThumbCanvases();
      this._updateScrollIndicator();
    }
  });
  if (this._renderer) {
    this._renderer.setColor(state.meta.color);
    this._renderer.setShowDoor(state.meta.showDoor);
    this._renderer.setItems(layoutEngine.renderRows(state));
  }
},
```

Note: removed `allowReplaceFirst` from `setData`; added `selectedModelIdx: selIdx`.

- [ ] **Step 5: Run util tests to ensure no regression**

Run: `node tests/run.js`

Expected: all assertions still pass.

- [ ] **Step 6: Verification milestone**

`index.js` now: picker-pick = instant replace; recompute mirrors last-cabinet to picker highlight; `onReplaceFirst` and `allowReplaceFirst` are gone. Move on to Task 3.

---

## Task 3: Simplify design page WXML action-bar

**Files:**
- Modify: `miniprogram/pages/design/index.wxml`

- [ ] **Step 1: Collapse the action-bar to two buttons**

Open `miniprogram/pages/design/index.wxml`. Find the action-bar block (around lines 69-73):

```xml
<view class="action-bar">
  <view wx:if="{{allowReplaceFirst}}" class="action-btn" bindtap="onReplaceFirst">替换首块</view>
  <view wx:else class="action-btn" bindtap="onPrev">上一模块</view>
  <view class="action-btn primary" bindtap="onNext">{{nextBtnText}}</view>
</view>
```

Replace with:

```xml
<view class="action-bar">
  <view class="action-btn" bindtap="onPrev">上一模块</view>
  <view class="action-btn primary" bindtap="onNext">{{nextBtnText}}</view>
</view>
```

- [ ] **Step 2: Verification milestone**

WXML now has a single, always-shown "上一模块" button alongside the primary "下一模块" / "确认布局" button. Move on to Task 4 for manual smoke.

---

## Task 4: Manual smoke test in WeChat DevTools

**Files:** none (manual verification only)

This task is required because there is no automated UI test framework in this project. Run through these scenarios using the WeChat DevTools simulator.

- [ ] **Step 1: Open the project in WeChat DevTools**

- Launch the WeChat DevTools simulator.
- Open the LemonTA project. If it complains about npm, click "工具 → 构建 npm".
- Navigate: plan-list page → 新建方案 → fill name / wall (e.g., W=320, H=240, no corner, no raise) → enter design page.

- [ ] **Step 2: Scenario A — single cabinet replace (equiv. to old replace-first)**

- On entry: 3D shows 1 cabinet (50cm 'a'). picker is on 50 tab. picker cell for 'a' should be highlighted (B-On reverse lookup).
- Click cell 'b' in picker. → 3D's only cabinet should immediately switch to 50cm 'b'. 'b' is now highlighted. 'a' is not.

- [ ] **Step 3: Scenario B — multi-cabinet, only last changes**

- Click "下一模块" twice. 3D shows 3 cabinets (50a + 50a + 50a).
- Last cabinet's `code` is 'a' on 50 tab → 'a' highlighted.
- Click 'c' in picker. → only the 3rd cabinet becomes 50c. The first two stay as 50a.

- [ ] **Step 4: Scenario C — size jump on replace, exactly filling → auto-close**

- Continuing from Scenario B (state: 50a + 50a + 50c, standardUsed=150, standardWidth=250).
- Click "下一模块". 4th cabinet 50a added, standardUsed=200.
- Click "100cm" tab. picker shows 100cm models. No cell highlighted (last is 50cm a, not in 100 list).
- Click 'b' in 100cm picker. → newUsed = 200 - 50 + 100 = 250 == standardWidth → auto-close.
- Expected: picker disappears (`show50=false, show100=false`), primary button text = "确认布局".

- [ ] **Step 5: Scenario D — size constraint blocks replacement**

- Restart: back out to plan-list, new plan with W=84 H=240 corner=WZJ (or use whatever minimum wall the page accepts that yields standardWidth=80 and nonStandardWidth=30). Skip this scenario if validation rejects W=84.
- Alternative: Use any plan and try a scenario where replacing 50→100 would exceed standardWidth. (Per spec, this is hard to trigger naturally because standardWidth is always a multiple of 50; the unit tests in Task 1 already cover synthetic state. If this scenario can't be constructed manually, mark as N/A and rely on Task 1 tests.)

- [ ] **Step 6: Scenario E — exit isFull then continue replacing**

- After Scenario C ended in isFull, click "上一模块".
- Expected: layout exits isFull (non-standard + right SK + last standard removed), picker reappears, "下一模块" text restored.
- Pick another model → it replaces the new last cabinet.

- [ ] **Step 7: Scenario F — picker highlight follows after delete**

- In any non-full state with ≥2 cabinets where last has different code from prev:
- E.g., 50a + 50c → 'c' highlighted on 50 tab.
- Click "上一模块". → cabinets = 50a, picker highlight automatically shifts to 'a'.

- [ ] **Step 8: Scenario G — color and door toggle still work**

- Switch color: 3D recolors as before (regression check).
- Toggle door: doors appear/hide as before.
- Replacement still works after color/door changes.

- [ ] **Step 9: Confirm 3D sync end-to-end**

- After several replacements, click "确认布局" (when full).
- Expected: navigate to materials page; the `cabinets` list reflects the latest state including all replacements.

- [ ] **Step 10: Final verification milestone**

If all scenarios pass, the feature is complete. If any fails:
- For 3D not syncing: check `_renderer.setItems(...)` is being called inside `recompute()` after the changes (should be unchanged from original).
- For picker highlight not following: check `selectedModelIdx: selIdx` is in the `setData` payload in `recompute()`.
- For replace silently failing: check `onPickModel` calls `replaceLast` and shows toast on `r.ok === false`.

---

## Spec Coverage Verification

| Spec section | Covered by |
|---|---|
| §3 picker pick → instant replace | Task 2 Step 1 |
| §3 sizeTab only refreshes list (no 3D change) | Unchanged from current code; preserved in Task 2 Step 4 |
| §3 "下一模块" still adds | Unchanged; preserved in Task 3 |
| §3 "上一模块" still deletes | Unchanged; preserved in Task 3 |
| §3 replace fills exactly → auto-close | Task 1 Step 3 (calls `placeNonStandardAndClose`); Task 4 Scenario C |
| §3 replace exceeds standardWidth → toast, no change | Task 1 Step 3 (early return); Task 2 Step 1 (toast); Task 1 unit test "放不下应失败" |
| §3 isFull → picker hidden, no replace | Unchanged; B-On reverse-lookup just yields `selIdx = -1` |
| §3 non-standard / corner / sk not replaceable | `replaceLast` only matches `kind === 'standard'` (Task 1 Step 3) |
| §3.1 B-On highlight = last cabinet | Task 2 Step 4 (`selIdx` calc), Task 4 Scenarios A/B/F |
| §4.1 `replaceLast` in layout-engine | Task 1 |
| §4.2 `onPickModel` rewrite | Task 2 Step 1 |
| §4.2 delete `onReplaceFirst` | Task 2 Step 2 |
| §4.2 delete `allowReplaceFirst` | Task 2 Steps 3+4 |
| §4.3 WXML simplify action-bar | Task 3 |
| §4.4 three-renderer untouched | N/A (no task modifies it) |
| §5 `replaceFirst` / `isOnlyFirstCabinet` exports preserved | Task 1 Step 3 (kept in `module.exports`) |
| §6 verification scenarios | Task 4 |
