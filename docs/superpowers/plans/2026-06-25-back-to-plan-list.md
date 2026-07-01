# 板材五金 / 成本透视页返回方案列表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plan-list 之后的页面跳转从 `wx.navigateTo` 全部改成 `wx.redirectTo`，使任何时刻导航栈最多只有 `plan-list` + 当前页两层。系统返回箭头在 materials/cost 上始终回到方案列表。

**Architecture:** 压平导航栈方案。改动 5 处页面跳转的 wx 调用方式，调整 2 处页面内"上一步"按钮（`cost.onChangeConfig`、`design.onResetWall`）原本依赖 `navigateBack` 的逻辑。无新增文件，无逻辑层改动。

**Tech Stack:** 微信小程序（原生）。`wx.redirectTo` / `wx.navigateBack` 是微信小程序导航 API。项目使用 globalData 在页面间传递 plan 草稿。

---

## 项目背景速读（实施前必读）

- 项目是微信小程序，pages 配置在 `miniprogram/app.json`
- 导航 API：`wx.navigateTo` 入栈跳转、`wx.redirectTo` 替换栈顶、`wx.navigateBack` 弹栈
- 不存在 e2e 框架；测试要在微信开发者工具里手动跑
- Plan 草稿通过 `getApp().globalData.draftPlan` / `currentPlan` 在页面间传递
- 路径分隔符：项目代码里用 `/`，宿主机是 Windows 但跨平台无影响

## File Structure

无新增文件，只修改：

- `miniprogram/pages/plan-list/index.js` — 改两处跳转
- `miniprogram/pages/space-setup/index.js` — 改一处跳转
- `miniprogram/pages/design/index.js` — 改两处（一处跳转，一处 onResetWall 重写）
- `miniprogram/pages/materials/index.js` — 改一处跳转
- `miniprogram/pages/cost/index.js` — 改一处（onChangeConfig 重写）

每个 Task 改一个文件，独立可验证。Task 之间无强依赖（每次改后栈都仍能正常前进），但建议按顺序做以便手动验证时一段段走通。

---

### Task 1: plan-list — 新建流程进入 space-setup 用 redirectTo

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js` (函数 `onTapStart`)

- [ ] **Step 1: 改跳转方式**

把 `onTapStart` 里的 `wx.navigateTo` 换成 `wx.redirectTo`：

```javascript
  onTapStart() {
    if (planStore.isFull()) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    getApp().globalData.draftPlan = null;
    wx.redirectTo({ url: '/pages/space-setup/index' });
  },
```

- [ ] **Step 2: 手动验证**

在微信开发者工具里：
- 打开小程序，从 plan-list 点"开始设计"按钮
- 跳到 space-setup
- 按系统左上角返回箭头
- 预期：回到 plan-list（行为与改前一致，因为 plan-list 是第一页）

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/plan-list/index.js
git commit -m "fix(nav): plan-list 新建流程用 redirectTo 进入 space-setup"
```

---

### Task 2: plan-list — 列表打开方案进入 materials 用 redirectTo

**Files:**
- Modify: `miniprogram/pages/plan-list/index.js` (函数 `onTapItem`)

- [ ] **Step 1: 改跳转方式**

```javascript
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const plan = planStore.get(id);
    if (!plan) return;
    getApp().globalData.currentPlan = plan;
    wx.redirectTo({
      url: '/pages/materials/index?from=list&id=' + id,
    });
  },
```

- [ ] **Step 2: 手动验证**

- 在 plan-list 点一个已有方案
- 进入 materials
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/plan-list/index.js
git commit -m "fix(nav): plan-list 列表项用 redirectTo 进入 materials"
```

---

### Task 3: space-setup — 进入 design 用 redirectTo

**Files:**
- Modify: `miniprogram/pages/space-setup/index.js` (函数 `onConfirm`，第 145 行)

- [ ] **Step 1: 改跳转方式**

把 `onConfirm` 函数最后一行：

```javascript
    wx.navigateTo({ url: '/pages/design/index' });
```

改为：

```javascript
    wx.redirectTo({ url: '/pages/design/index' });
```

- [ ] **Step 2: 手动验证**

- plan-list → 点"开始设计" → space-setup
- 在 space-setup 填好名字、宽高、转角，点"确认"
- 跳到 design
- 按左上角返回箭头
- 预期：回到 plan-list（不再回到 space-setup）

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/space-setup/index.js
git commit -m "fix(nav): space-setup 用 redirectTo 进入 design"
```

---

### Task 4: design — 进入 materials 用 redirectTo，并重写 onResetWall

**Files:**
- Modify: `miniprogram/pages/design/index.js` (函数 `onConfirmLayout` 末尾、函数 `onResetWall`)

- [ ] **Step 1: 改 onConfirmLayout 末尾的跳转**

在 `onConfirmLayout` 函数末尾，找到：

```javascript
    wx.navigateTo({ url: '/pages/materials/index?from=design' });
```

改为：

```javascript
    wx.redirectTo({ url: '/pages/materials/index?from=design' });
```

- [ ] **Step 2: 重写 onResetWall**

栈被压平后，design 的上一页已不是 space-setup，`navigateBack` 会回到 plan-list 而非 space-setup。改成显式 `redirectTo`：

找到：

```javascript
  onResetWall() {
    wx.navigateBack();
  },
```

改为：

```javascript
  onResetWall() {
    wx.redirectTo({ url: '/pages/space-setup/index' });
  },
```

`space-setup.onLoad` 已经会从 `globalData.draftPlan` 把之前填的墙体参数回填，用户回去能看到原来的输入。

- [ ] **Step 3: 手动验证 onConfirmLayout 路径**

- plan-list → space-setup → design → 摆满 → 点"确认布局"
- 跳到 materials
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 4: 手动验证 onResetWall 路径**

- plan-list → space-setup（填好参数）→ design → 点页面内"重设墙体"按钮
- 跳到 space-setup
- 预期：墙体宽、高、名称等之前填的参数都还在（来自 `globalData.draftPlan` 回填）
- 再按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/design/index.js
git commit -m "fix(nav): design 用 redirectTo 进入 materials, onResetWall 用 redirectTo 回 space-setup"
```

---

### Task 5: materials — 进入 cost 用 redirectTo

**Files:**
- Modify: `miniprogram/pages/materials/index.js` (函数 `onCalc` 末尾)

- [ ] **Step 1: 改跳转方式**

在 `onCalc` 函数末尾，找到：

```javascript
    wx.navigateTo({
      url: '/pages/cost/index?from=' + this.data.from + '&id=' + plan.id,
    });
```

改为：

```javascript
    wx.redirectTo({
      url: '/pages/cost/index?from=' + this.data.from + '&id=' + plan.id,
    });
```

- [ ] **Step 2: 手动验证（设计流程）**

- 走完整设计流程：plan-list → space-setup → design → materials → 选好板材 → 点"计算成本"
- 跳到 cost
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 3: 手动验证（列表进入）**

- plan-list → 点一个已有方案 → materials → 点"计算成本"
- 跳到 cost
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/materials/index.js
git commit -m "fix(nav): materials 用 redirectTo 进入 cost"
```

---

### Task 6: cost — 重写 onChangeConfig

**Files:**
- Modify: `miniprogram/pages/cost/index.js` (函数 `onChangeConfig`，第 117-119 行)

- [ ] **Step 1: 重写 onChangeConfig**

栈被压平后，cost 的上一页已不是 materials，`navigateBack` 会回到 plan-list。"更换配置"按钮的意图是回到 materials，要显式 `redirectTo`，并透传 `from` 和 `id` 让 materials 能正确加载 plan。

找到：

```javascript
  onChangeConfig() {
    wx.navigateBack();
  },
```

改为：

```javascript
  onChangeConfig() {
    const from = this.data.from || 'design';
    const id = (this.data.plan && this.data.plan.id) || '';
    wx.redirectTo({
      url: '/pages/materials/index?from=' + from + '&id=' + id,
    });
  },
```

参数拼法与 `materials.onCalc` 进入 cost 时的 url 保持一致（都是 `from` + `id`）。`materials.onLoad` 已经处理 `from=list` 时从 `globalData.currentPlan` 取、`from=design` 时从 `globalData.draftPlan` 取，两条路径都能正常加载 plan 和之前选好的板材。

- [ ] **Step 2: 手动验证（设计流程）**

- plan-list → space-setup → design → materials → cost
- 点 cost 页底部的"更换配置"按钮
- 预期：跳回 materials，之前选好的板材选项保留
- 改一个板材选项 → 点"计算成本"
- 预期：跳到 cost，价格更新
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 3: 手动验证（列表进入）**

- plan-list → 点已有方案 → materials → cost
- 点"更换配置"
- 预期：跳回 materials，板材是该方案保存的配置
- 按左上角返回箭头
- 预期：回到 plan-list

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/cost/index.js
git commit -m "fix(nav): cost onChangeConfig 用 redirectTo 回 materials"
```

---

### Task 7: 端到端回归

**Files:** 无修改，纯验证。

- [ ] **Step 1: 设计流程完整路径回归**

清掉小程序数据后重新开始：

1. plan-list → 点"开始设计" → 跳 space-setup
   - 按返回：回 plan-list ✓
2. plan-list → space-setup → 填参数确认 → 跳 design
   - 按返回：回 plan-list ✓
3. plan-list → space-setup → design → 点"重设墙体" → 跳 space-setup，参数保留
   - 按返回：回 plan-list ✓
4. plan-list → space-setup → design → 摆满 → 确认 → 跳 materials
   - 按返回：回 plan-list ✓
5. plan-list → space-setup → design → materials → 计算成本 → 跳 cost
   - 按返回：回 plan-list ✓
6. plan-list → ... → cost → 点"更换配置" → 跳 materials
   - 按返回：回 plan-list ✓

- [ ] **Step 2: 列表进入路径回归**

1. plan-list → 点已有方案 → 跳 materials
   - 按返回：回 plan-list ✓
2. plan-list → 已有方案 → materials → 计算成本 → 跳 cost
   - 按返回：回 plan-list ✓
3. plan-list → 已有方案 → materials → cost → "更换配置" → 跳 materials
   - 按返回：回 plan-list ✓

- [ ] **Step 3: 草稿污染检查**

1. 新建一个方案，走到 design 半途（摆了几个柜子但没确认布局）
2. 按返回回到 plan-list
3. 再点"开始设计"
4. 预期：space-setup 是空白状态（因为 `onTapStart` 把 draftPlan 重置为 null），不会出现上次半成品的参数

- [ ] **Step 4: cost "下载" 弹窗仍能正常关闭**

- 进入 cost → 点"一键下载" → 弹出网盘链接弹窗 → 点"关闭"
- 预期：弹窗关闭，cost 页正常显示
- 这步是为了确认 cost 页其他交互没有被这次改动副作用打到

如果以上全部通过，整个改动验收完成。
