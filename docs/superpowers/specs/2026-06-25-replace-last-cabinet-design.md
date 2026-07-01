# 设计页：即时替换末块（Replace-Last-Cabinet）

**状态**：草案
**日期**：2026-06-25
**作者**：协作设计
**适用页面**：`miniprogram/pages/design/index`

## 1. 背景

`pages/design` 是衣柜布局编辑页，3D 画布展示当前布局，底部 picker 让用户挑选标准柜模型，按 "下一模块" 把模型逐个加到 3D 空间。

当前已有的"替换"能力：

- `layoutEngine.replaceFirst(state, { code, size })`
- `layoutEngine.isOnlyFirstCabinet(state)`：仅当布局中只有自动放置的首块（且未布满）时为真
- UI 上 `allowReplaceFirst === true` 时显示"替换首块"按钮，把"上一模块"替换掉

也就是说**当前只有 1 个柜子时才能替换那 1 个**。当用户加了第 2、第 3 个之后，已经放下的柜子只能"上一模块"删掉、不能再替换。

## 2. 目标

把"替换"扩展为：**3D 空间中最后一个添加的标准柜，始终可被替换为 picker 中的其他模型/尺寸**。

- 1 个柜子时：那个唯一柜子就是末块
- N 个柜子时：第 N 个（最后添加的那个）是末块
- 替换实时反映到 3D 渲染

## 3. 交互规约

| 触发 | 行为 |
|---|---|
| 在 picker 中点一个模型卡片 | 立即用 `(选中模型 code, 当前 sizeTab)` 替换 3D 中最后一个 `kind === 'standard'` 的 item；成功则 3D 同步刷新，失败则 toast、不改 |
| 点 50/100cm 尺寸 tab | 只切换 picker 显示的模型列表，不动 3D（保持现有行为） |
| 点 "下一模块" | 仍然是"添加新柜"（保持现有行为） |
| 点 "上一模块" | 仍然是"删除末块"（保持现有行为） |
| 替换后 `standardUsed === standardWidth` | 自动 `placeNonStandardAndClose`（与 `replaceFirst` 一致），布满，picker 隐藏，按钮变"确认布局" |
| 替换后 `standardUsed > standardWidth`（放不下） | toast "剩余宽度不足，无法放置该尺寸柜体"，3D 与 state 都不改 |
| `isFull === true`（已布满态） | picker 仍隐藏（保持现有），无替换；点 "上一模块" 可退出布满态后继续替换新末块 |
| 非标柜 / 转角 / 收口 | 不可被替换（由墙宽几何自动生成） |

### 3.1 picker 高亮规则（B-On）

`selectedModelIdx` 的语义改为「当前 3D 末块对应的 picker idx」，作为 3D 末块的镜像。

`recompute()` 重算后按规则同步：

1. 找到 state 中最后一个 `kind === 'standard'` 的 item，记作 lastStd
2. 在当前 `modelList`（受 sizeTab 过滤后的列表）中，找 `m.code === lastStd.code && currentSizeTab === lastStd.w` 的项
3. 找到则 `selectedModelIdx = 匹配 idx`；找不到则 `selectedModelIdx = -1`（无高亮）

典型场景：

- 末块是 50cm 'a'，sizeTab=50 → picker 中 'a' 卡片高亮
- 用户点 'b' → 立即替换，picker 中 'b' 卡片立刻高亮
- 用户切到 100cm tab → modelList 变了，末块还是 50cm 'a' → 没有任何卡片高亮（直观提示"末块不在当前列表里"）
- 用户点 100cm 中的 'c' → 末块替换成 100cm 'c'，'c' 卡片亮起
- 用户点 "上一模块" 删掉末块 → 新末块是前一个（比如 'a'），picker 高亮自动跳回 'a'

WXML 那行 `class="model-cell {{selectedModelIdx === idx ? 'active' : ''}}"` 因 -1 永不等于任何 idx，自然得到"无高亮"的渲染。

## 4. 实现改动

### 4.1 `miniprogram/utils/layout-engine.js`

新增导出 `replaceLast(state, { code, size })`：

- 倒序遍历 `state.items` 找最后一个 `it.kind === 'standard'`
- 计算 `newUsed = state.meta.standardUsed - it.w + size`
- 若 `newUsed > state.meta.standardWidth` → `{ ok: false, message: '剩余宽度不足，无法放置该尺寸柜体' }`
- 写入：`it.code = code; it.w = size; state.meta.standardUsed = newUsed;`
- `it.isFirst` 保留不变（仅 length===1 时末块就是首块，靠 isFirst 区分依然成立）
- 若 `newUsed >= state.meta.standardWidth` → `placeNonStandardAndClose(state)`（与 `replaceFirst` 同语义）
- 返回 `{ ok: true }`

`replaceFirst` 与 `isOnlyFirstCabinet` 保留但本页不再调用（避免对其它页面/模块的潜在影响）。

### 4.2 `miniprogram/pages/design/index.js`

`onPickModel(e)` 改写为「选中 + 立即替换」：

```
onPickModel(e) {
  const idx = e.currentTarget.dataset.idx;
  const m = this.data.modelList[idx];
  if (!m) return;
  // 即时替换末块
  const r = layoutEngine.replaceLast(this._state, {
    code: m.code,
    size: this.data.sizeTab,
  });
  if (!r.ok) {
    this.showToast(r.message || '替换失败');
    return;
  }
  // 高亮先按用户点的 idx 设置，recompute 会再按"末块镜像"反查一次
  this.setData({ selectedModelIdx: idx });
  this.recompute();
}
```

`recompute()` 末尾追加 selectedModelIdx 反查逻辑（B-On）：

```
// B-On：picker 高亮跟随末块
const stds = state.items.filter((it) => it.kind === 'standard');
const last = stds[stds.length - 1];
let selIdx = -1;
if (last && last.w === sizeTab) {
  selIdx = list.findIndex((m) => m.code === last.code);
}
// 合入主 setData：selectedModelIdx: selIdx
```

删掉：

- `onReplaceFirst` 处理器
- `recompute` 里 `allowReplaceFirst` / `isOnlyFirstCabinet` / `canHave100 = ... allowReplaceFirst && ...` 的整段逻辑
- data 中 `allowReplaceFirst: false` 字段

注：50/100 tab 切换、删末块、加新块都会触发 `recompute`，B-On 同步在那一步统一完成；`onSwitchSize` 内不需要再单独维护 `selectedModelIdx`。

### 4.3 `miniprogram/pages/design/index.wxml`

`.action-bar` 简化：

```
<view class="action-bar">
  <view class="action-btn" bindtap="onPrev">上一模块</view>
  <view class="action-btn primary" bindtap="onNext">{{nextBtnText}}</view>
</view>
```

删 `<view wx:if="{{allowReplaceFirst}}" ... 替换首块</view>` 整行，去掉 wx:else 分支。

### 4.4 `miniprogram/utils/three-renderer.js`

**不动**。3D 同步走现有的 `_renderer.setItems(layoutEngine.renderRows(state))`，已经在 `recompute()` 末尾调用。

## 5. 兼容性 & 边界

- 首块替换由 `replaceLast` 自然覆盖（length===1 时末块就是首块），UX 与旧版的"替换首块"等价
- `serialize`、`flattenCabinets`、`renderRows`、`cabinetCount`、`previewImage` 均不动
- `materials` / `cost` 页对 `state.items` 的消费契约不变
- `isFirst` 仍保留，`removeLast` 中"第一个模块只能替换，不能删除"的保护仍生效

## 6. 验证场景

1. **首块替换**：仅 1 柜，点 picker 中其他模型 → 那唯一柜子样式/尺寸更新
2. **末块替换**：2 柜以上，点 picker → 只有最后一柜变化，前面不动
3. **切尺寸触发布满**：切 100cm tab → 点模型替换末块，且 `standardUsed` 刚好填满 → 自动布满、picker 消失、按钮变"确认布局"
4. **尺寸超界**：切 100cm tab → 点模型但放不下 → toast "剩余宽度不足"、3D 不变、state 不改
5. **退出布满**：布满后点 "上一模块" → 退出布满态、picker 重现、再点模型替换新末块成功
6. **picker 高亮反查**：
   - 初始进入：默认末块是 50cm 'a'，sizeTab=50 → picker 中 'a' 高亮
   - 切到 100cm tab：末块仍是 50cm 'a' → picker 无高亮
   - 点 100cm 中的 'c'：末块替换为 100cm 'c'，'c' 高亮
   - 删末块：新末块是前一个，picker 高亮跳回对应项
7. **加新块**：替换末块后再点 "下一模块" → 在替换好的末块右侧追加，新末块成为可替换对象，picker 高亮跟过去

## 7. 不做的事

- 不在 3D 中给末块加高亮/描边/闪动（用户选定方案 3-B：不加视觉提示，凭即时反馈）
- 不允许在 3D 画布上点选柜子（用户排除了该交互）
- 不替换非标柜 / 转角 / 收口
- 不动 `replaceFirst` / `isOnlyFirstCabinet` 的导出（防止其它模块依赖断裂）
