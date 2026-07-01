# 板材五金 / 成本透视页返回方案列表

## 背景

小程序当前导航栈：

- 设计流程：`plan-list → space-setup → design → materials → cost`
- 从列表打开历史方案：`plan-list → materials → cost`

用户在 `materials`（板材五金）或 `cost`（成本透视）页面按系统左上角返回箭头时，只会回退一层。期望行为是直接回到 `plan-list`。

## 目标

`materials` 和 `cost` 页面（无论从哪条路径进入）按系统返回箭头时直接回到 `plan-list`。

## 方案

压平导航栈：把 `plan-list` 之后的所有页面跳转从 `wx.navigateTo` 改成 `wx.redirectTo`。导航栈在任何时刻最多两层：`plan-list` + 当前页。系统返回箭头始终回到 `plan-list`。

### 栈变化对照

```
现状：
  设计流程  [plan-list, space-setup, design, materials, cost]
  列表进入  [plan-list, materials, cost]

改后：
  设计流程  [plan-list, space-setup] → [plan-list, design]
            → [plan-list, materials] → [plan-list, cost]
  列表进入  [plan-list, materials] → [plan-list, cost]
```

用户看到的前进体验不变。

## 改动点

### 跳转方式改为 redirectTo

| 文件 | 触发位置 | 现状 | 改为 |
|------|---------|------|------|
| `pages/plan-list/index.js` | `onTapStart` 新建方案进入 space-setup | `wx.navigateTo` | `wx.redirectTo` |
| `pages/plan-list/index.js` | `onTapItem` 列表项打开 materials | `wx.navigateTo` | `wx.redirectTo` |
| `pages/space-setup/index.js` | `onConfirm` 进入 design | `wx.navigateTo` | `wx.redirectTo` |
| `pages/design/index.js` | `onConfirmLayout` 进入 materials | `wx.navigateTo` | `wx.redirectTo` |
| `pages/materials/index.js` | `onCalc` 进入 cost | `wx.navigateTo` | `wx.redirectTo` |

### 页面内"上一步"按钮调整

栈被压平后，原本依赖 `navigateBack` 回上一页的按钮要改成 `redirectTo` 显式跳转：

- `pages/cost/index.js` 的 `onChangeConfig`：现在是 `wx.navigateBack()`。改为 `wx.redirectTo` 到 `/pages/materials/index?from={from}&id={plan.id}`（参数与 `onCalc` 拼法一致）。
- `pages/design/index.js` 的 `onResetWall`：现在是 `wx.navigateBack()`。改为 `wx.redirectTo` 到 `/pages/space-setup/index`。

### 不动的代码

- `space-setup` 自身的返回按钮（若存在）保持原样，本来就回 `plan-list`。
- `cost` 页面 `onLoad` 中 `wx.navigateBack` 的兜底（plan 缺失时）保持原样，意图是在异常情况下退出当前页，行为正确。
- `design` 页面 `onLoad` 中同样的兜底保持原样。

## 边界与副作用

**design 页系统返回**：用户在画布上画到一半按系统返回会直接回 `plan-list`，跳过 `space-setup`。这是栈压平的必然结果。布局未确认（未点"确认布局"），draftPlan 不会被写入 planStore，下次新建会从空白开始。

**草稿数据保护**：`globalData.draftPlan` 由 `plan-list.onTapStart` 在每次新建流程开始时重置为 null，不会污染下一次。

**cost 页"更换配置"参数**：从 design 流程进入时 `from=design`，从列表进入时 `from=list`。改 `onChangeConfig` 时要透传 `this.data.from` 和 `this.data.plan.id`，确保 materials 页能正确判断来源并加载到对应的 plan。

## 验证

项目无 e2e 框架，在微信开发者工具中手动验证三条路径：

1. 新建流程从 `plan-list` 依次走到 `cost`，每一步按左上角返回箭头都回到 `plan-list`。
2. 在 `plan-list` 点已有方案 → `materials` → `cost`，每一步按返回箭头都回到 `plan-list`。
3. 页面内按钮：`cost` 的"更换配置"回到 `materials`；`design` 的"重设墙体"回到 `space-setup`；之后再按返回箭头都回到 `plan-list`。
