# 定制尺寸柜可替换模型设计方案

日期：2026-07-04
状态：待实施
适用页面：`miniprogram/cabinet/pages/design/index`

## 1. 背景

`layoutEngine.placeNonStandardAndClose` 会在布局末尾自动放一个"非标柜"（`kind === 'nonstandard'`，宽度 = `nonStandardWidth`，code 由 `chooseNonStandardCode(width)` 硬编码为 `e1` 或 `e2`）。用户当前无法替换这个定制柜的模型样式。

已有能力：
- `replaceLast(state, { code, size })`（06-25 版本）能替换最后一个标准柜（`kind === 'standard'`），布满后 picker 隐藏，非标柜不参与
- 已有 50cm 系列模型（a/b/c/d/G1/G2）和 100cm 系列模型（a/b/c/d/G1/G2/H/K/L）

## 2. 目标

在方案布满（`isFull === true`）后：
- picker 保持显示（不再隐藏）
- picker 的尺寸 tab 根据当前非标柜宽度**强制锁定**：
  - `nonStandardWidth < 60`（cm，即 <600mm）→ 只能选 50cm 系列
  - `nonStandardWidth >= 60` → 只能选 100cm 系列
- 用户点 picker 中任意模型卡片 → 立即替换非标柜的 code；宽度、位置、`isFull` 不变；3D 同步刷新

## 3. 非目标

- 不改动非标柜的宽度（`nonStandardWidth` 由墙宽/转角/标准段几何决定，不动）
- 不改动标准柜替换逻辑（`replaceLast` 保持原样）
- 不改动 `placeNonStandardAndClose` 初次落非标柜时的 code（仍是 `e1`/`e2`）
- 不新增 UI 区块（3D 下方长按/双击、独立弹窗、独立按钮均不做）
- 不在退出布满态后保留用户对非标柜的 code 选择（`removeLast` 会把非标柜整个删掉，重新填满时又是 e1/e2；用户可再次选择）

## 4. 交互规约

| 触发 | 行为 |
|---|---|
| 布满态进入时（`isFull === true` 且存在非标柜 item） | picker 显示；根据非标柜宽度锁定 sizeTab；`selectedModelIdx = -1` 无高亮 |
| 布满态点某模型卡片 | 调 `replaceNonStandard(state, { code })` → 非标柜 `it.code` 更新 → 3D 刷新 → 该模型卡片高亮 |
| 布满态但无非标柜（`nonStandardWidth < 40` 或 `>120`，`placeNonStandardAndClose` 没落非标柜） | picker 仍隐藏（保持原行为） |
| 布满态点"上一模块" | 走原 `removeLast`：非标柜和右转角、右收口一起被删除，退出布满态 |
| 非布满态 | picker 逻辑走原路径（`replaceLast`，替换最后一个标准柜） |

## 5. 实现改动

### 5.1 `miniprogram/cabinet/utils/layout-engine.js`

新增导出 `replaceNonStandard(state, { code })`：

```js
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

在文件末尾 `module.exports` 中追加 `replaceNonStandard`。

### 5.2 `miniprogram/cabinet/pages/design/index.js` — `recompute()` 改动

现有 `recompute()` 中处理 `state.meta.isFull` 的分支是：

```js
if (state.meta.isFull) {
  show50 = false;
  show100 = false;
} else {
  // 原有剩余宽度判定逻辑
}
```

改为：

```js
if (state.meta.isFull) {
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
} else {
  // 原有剩余宽度判定逻辑不变
}
```

B-On 高亮反查逻辑保持不变。由于非标柜 code 是 `e1`/`e2`，不属于 picker 模型列表，反查自然找不到匹配 → `selectedModelIdx = -1` 无高亮。首次点击某模型后，`onPickModel` 里 `this.setData({ selectedModelIdx: idx })` 会让该卡片高亮；后续 `recompute()` 会再次反查——非标柜 code 已变为该模型的 code（存在于 picker 列表中），反查匹配 → 高亮保持。

### 5.3 `miniprogram/cabinet/pages/design/index.js` — `onPickModel(e)` 改动

现有 `onPickModel` 只处理"替换最后一个标准柜"。改为在开头判断布满态：

```js
onPickModel(e) {
  const idx = e.currentTarget.dataset.idx;
  const m = this.data.modelList[idx];
  if (!m) return;

  const state = this._state;
  // 布满态且存在非标柜 → 替换非标柜 code
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
    // 布满但无非标柜 → 无操作（picker 本来也是隐藏的，理论上到不了这里）
    return;
  }

  // 非布满态：原有 replaceLast 逻辑
  const r = layoutEngine.replaceLast(state, {
    code: m.code,
    size: this.data.sizeTab,
  });
  if (!r.ok) {
    this.showToast(r.message || '替换失败');
    return;
  }
  this.setData({ selectedModelIdx: idx });
  this.recompute();
}
```

### 5.4 三维渲染器

`three-renderer.setItems(...)` 不改动。它已经根据 `item.code` 加载对应 glb，并根据 `item.w` 做横向缩放（`e1`/`e2` 本身就是通过缩放来贴合非标宽度的），因此把 code 从 `e1` 换成 `a` 也会走同样的缩放路径。

### 5.5 WXML / WXSS

不改。picker 结构、`sizeTab`、`show50`/`show100`、`selectedModelIdx` 的现有 data binding 已覆盖新行为。

## 6. 兼容性 & 边界

| 场景 | 处理 |
|---|---|
| 非标柜宽度正好 60cm | 走 ≥60 分支，锁 100 |
| 非标柜宽度 <40 或 >120（不落非标柜） | picker 保持隐藏（`show50=false, show100=false`） |
| 用户切 sizeTab | tab 按钮已被 `show50`/`show100` 隐藏，不可点，不需要额外拦截 |
| 用户点"上一模块"后重新填满 | `placeNonStandardAndClose` 用 `chooseNonStandardCode(width)` 生成新的非标柜（e1/e2），先前选择丢失。这是符合预期的（宽度变了，先前的模型不一定合适） |
| materials / cost 页对非标柜 code 的消费 | 依赖 `item.code` 拿到板材/五金清单。code 从 e1/e2 变成 a/b/c 等，会自动切到对应模型的物料表。用户责任在于选择匹配的模型；不做业务防呆 |
| `serialize` / `flattenCabinets` / `renderRows` / `previewImage` | 不动 |

## 7. 测试

### 7.1 单元测试（`tests/run.js`）

新增 group `layout-engine.replaceNonStandard`：

1. **单个非标柜可替换 code**：init 一个墙宽会落非标柜的方案 → `placeNonStandardAndClose` 已被 `addNext` 触发 → 调 `replaceNonStandard(state, { code: 'a' })` → 非标柜 `it.code === 'a'`，宽度不变
2. **无非标柜时失败**：init 一个墙宽不落非标柜的方案 → 调 `replaceNonStandard` → `{ ok: false, message: '当前布局无定制尺寸柜可替换' }`
3. **幂等**：连续 `replaceNonStandard(state, { code: 'a' })` 两次 → 两次都 `ok: true`，state 一致
4. **不动其他 items**：替换前后 `state.items` 长度不变；标准柜、转角、收口条不受影响

### 7.2 人工测试（微信开发者工具）

1. **50cm 场景**：新建方案墙宽 = 87（standardWidth = 50, nonStandardWidth = 33 → 不落非标） → 换 145（standardWidth = 100, nonStandardWidth = 41 → 落非标 e1，40 <= 41 < 60）→ picker 显示、锁 50cm tab、无高亮 → 点 50cm 中 'a' → 3D 里非标柜位置变为 50a 模型（横向压缩到 41cm 宽），高亮 'a'
2. **100cm 场景**：墙宽让 `nonStandardWidth >= 60` 且 <=120（例如 wall.w 让 nonStandard = 80）→ picker 显示、锁 100cm tab、无高亮 → 点 100cm 中 'c' → 非标柜变 100c 模型
3. **60cm 边界**：`nonStandardWidth === 60` → 锁 100cm tab
4. **无非标柜**：`nonStandardWidth < 40` 的墙宽 → picker 保持隐藏
5. **删末块再填满**：点"上一模块"退出布满 → picker 恢复非布满逻辑 → 再点"下一模块"填满 → 非标柜回到 e1/e2，picker 无高亮
6. **materials/cost 页**：替换非标柜为 100c 后进入 materials 页 → 明细里应显示 100c 的板材/五金而不是 e1 的
