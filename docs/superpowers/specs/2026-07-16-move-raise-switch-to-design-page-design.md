# 加高模块开关搬到设计衣柜页

## 背景

`需要加高模块` 开关目前放在空间设置页 (`pages/space-setup`) 的"是否有转角衣柜"下方。用户希望搬到设计衣柜页 (`cabinet/pages/design`) `ctrl-bar` 里 `显示柜门` / `重置墙面` 两个按钮**下方**,这样在真正的 3D 场景里就能直接切加高。

用户明确说"暂时"放在那,不做深度重排,只做最小搬迁。

## 现状数据流

- `space-setup`: switch 绑 `hasRaise` → 写入 `plan.hasRaise` → 跳设计页。
- `design onLoad`: 从 `plan.hasRaise` 传入 `layoutEngine.init({...})`,写到 `state.meta.hasRaise`。
- `renderRows(state)`: 每次 `recompute` 都读 `state.meta.hasRaise` 决定是否拼上排加高柜,再交给 renderer 的 `setItems`。
- `three-renderer` 的 `this.hasRaise = opts.hasRaise` **仅赋值,从未被读**。运行时只需 flip `state.meta.hasRaise` + `recompute()` 就能让加高排即时显隐,不必重建 3D 场景。

## 改动

### `pages/space-setup`

- `index.wxml`: 删掉第 41-44 行 `switch-row`。
- `index.wxss`: 删 `.switch-row` / `.switch-row .label` (无其他使用者)。
- `index.js`:
  - `data.hasRaise` 字段删。
  - `onLoad` 里 `hasRaise: !!draft.hasRaise` 那行删。
  - `onToggleRaise` 方法删。
  - `validate()` 内 `validateRaise` 校验块删(该函数在 `cabinet-rules.js` 里保留,给设计页复用)。
  - `onConfirm` 生成 plan 时不再显式塞 `hasRaise`;`Object.assign({}, draft, {...})` 会保留 draft 里既有值(编辑既有方案场景)。

### `cabinet/pages/design`

- `index.wxml`: `ctrl-bar` 内、`ctrl-row` 之后、`color-row` 之前,插入一行:

  ```wxml
  <view class="raise-row">
    <view class="raise-label">需要加高模块</view>
    <switch checked="{{plan.hasRaise}}" bindchange="onToggleRaise" color="#14532d" />
  </view>
  ```

- `index.wxss`: 追加 `.raise-row` (flex/space-between/16rpx 底距) 与 `.raise-label` (26rpx / #4b5563,与现有 `ctrl-btn` 字号一致)。
- `index.js`:
  - 新增 `onToggleRaise(e)`:
    1. 读 `plan.wall.h`,若 `e.detail.value` 为 true 且高度 ≤ 250:`showToast('墙面高度需大于250cm才能加高')`,并**回滚 switch**——通过 `setData({ plan: {...plan, hasRaise: false} })` 强制 checked 变回 false。
    2. 合法则:`this._state.meta.hasRaise = value`;`setData({ plan: { ...plan, hasRaise: value } })`(info-bar 的 `· 加高` 后缀刷新);调用 `this.recompute()`。
  - `onLoad` 里 `layoutEngine.init({ hasRaise: plan.hasRaise })` 保留(编辑既有方案时 plan 里可能已有值,首创方案下会是 `undefined` 等价 false)。

## 校验策略

墙高 ≤ 250 时打开开关 → toast 提示 + 回滚。已与用户确认。

## 未处理

- 编辑既有方案参数(重进 `space-setup`) 无法再改 `hasRaise`,只能在设计页改;符合"开关搬家"语义。
- `validateRaise` / `state.meta.hasRaise` / renderer 存储的 `hasRaise` 均不动。
