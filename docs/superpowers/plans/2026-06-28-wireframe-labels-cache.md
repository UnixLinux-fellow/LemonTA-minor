# 线框图带编号成品图缓存 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户第一次进入成本透视页时把"wireframeImage + 橙色编号"合成为带编号成品图、覆盖 plan.wireframeImage 并持久化；PDF、成本页后续使用都从这张缓存图取。

**Architecture:** 抽出 `computeLabelPositions` 到独立工具，新增 `plan.wireframeHasLabels` 标记。成本页 onLoad 后用隐藏 2D canvas 后台合成、`wx.canvasToTempFilePath` 写本地临时文件、`planStore.upsert` 持久化。设计页 `onConfirmLayout` 重生 wireframeImage 时重置标记。PDF 端按标记决定贴图或显示"未计算"提示。

**Tech Stack:** 微信小程序、Canvas 2D、wx.canvasToTempFilePath、wx.storage

参考 spec：`docs/superpowers/specs/2026-06-28-wireframe-labels-cache-design.md`

---

## Task 1: 抽出 computeLabelPositions 到独立工具 + Node 单测

**Files:**
- Create: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/wireframe-labels.js`
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/cost/index.js`（删除内部函数、改 require）
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/tests/run.js`（新增 sanity check）

- [ ] **Step 1.1: 新建 `wireframe-labels.js`**

写入文件 `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/wireframe-labels.js`：

```javascript
// 计算线框图上每个柜体编号的百分比坐标（左/上）。
// 与 three-renderer.captureWireframeImage 参数保持一致：fov=45°、CAPTURE_ZOOM=1.5、
// 柜体平面 z=-120cm、canvas 长宽比 690/420。改任一参数时这里要同步改。
function computeLabelPositions(plan) {
  if (!plan || !plan.wall || !plan.layout || !plan.layout.items) return [];
  const wall = plan.wall;
  const items = plan.layout.items;
  const hasRaise = !!plan.hasRaise;
  const STD_HEIGHT = 230;
  const raiseH = hasRaise ? Math.max(0, wall.h - STD_HEIGHT - 2) : 0;
  const fov = 45;
  const fovRad = (fov * Math.PI) / 180;
  const cameraDist = (wall.w / 2) / Math.tan(fovRad / 2) + wall.h * 0.5;
  const CAPTURE_ZOOM = 1.5;
  const camZ = cameraDist / CAPTURE_ZOOM;
  const CAB_Z = -120;
  const distToCab = camZ - CAB_Z;
  const aspect = 690 / 420;
  const visVertical = 2 * distToCab * Math.tan(fovRad / 2);
  const visHorizontal = visVertical * aspect;
  let cursor = -wall.w / 2;
  const xCenters = [];
  items.forEach((it) => {
    if (it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard') {
      xCenters.push(cursor + it.w / 2);
    }
    cursor += it.w;
  });
  const projX = (x) => 50 + (x / (visHorizontal / 2)) * 50;
  const projY = (y) => 50 - ((y - wall.h / 2) / (visVertical / 2)) * 50;
  const bottomCenterY = STD_HEIGHT / 2;
  const raiseCenterY = STD_HEIGHT + raiseH / 2;
  const labels = [];
  xCenters.forEach((x, i) => {
    labels.push({ key: 'b-' + (i + 1), idx: i + 1, left: projX(x), top: projY(bottomCenterY) });
  });
  if (hasRaise) {
    xCenters.forEach((x, i) => {
      labels.push({ key: 'r-' + (i + 1), idx: i + 1, left: projX(x), top: projY(raiseCenterY) });
    });
  }
  return labels;
}

module.exports = { computeLabelPositions };
```

- [ ] **Step 1.2: 在 `tests/run.js` 添加 sanity check**

在 `// ---- pdf-exporter._countCabinets ----` 节之后、`// ---- cost-engine ----` 之前插入：

```javascript
// ---- wireframe-labels.computeLabelPositions ----
const wireframeLabels = require(path.resolve(__dirname, '../miniprogram/utils/wireframe-labels.js'));
group('wireframe-labels.computeLabelPositions', () => {
  // 空输入
  eq(wireframeLabels.computeLabelPositions(null), [], 'null 返回 []');
  eq(wireframeLabels.computeLabelPositions({}), [], '无 wall/layout 返回 []');
  eq(wireframeLabels.computeLabelPositions({ wall: { w: 320, h: 240 } }), [], '无 layout 返回 []');
  eq(wireframeLabels.computeLabelPositions({ wall: { w: 320, h: 240 }, layout: { items: [] } }), [], '空 items 返回 []');

  // 3 个 standard，不加高 → 3 个标签
  const labels1 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 100 },
    ] },
  });
  eq(labels1.length, 3, '3 个 standard → 3 个标签');
  truthy(labels1.every((l) => l.left >= 0 && l.left <= 100), '所有 left 在 0-100 范围内');
  truthy(labels1.every((l) => l.top >= 0 && l.top <= 100), '所有 top 在 0-100 范围内');
  truthy(labels1.every((l, i) => l.idx === i + 1), 'idx 从 1 递增');
  truthy(labels1.every((l) => l.key.startsWith('b-')), '不加高时全部 key 前缀 b-');

  // 加高排：3 个下排 + hasRaise=true + wall.h>250 → 6 个标签
  const labels2 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 270 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 100 },
    ] },
  });
  eq(labels2.length, 6, '3 下排 + 3 加高 = 6 个标签');
  eq(labels2.filter((l) => l.key.startsWith('b-')).length, 3, '下排 3 个');
  eq(labels2.filter((l) => l.key.startsWith('r-')).length, 3, '加高 3 个');

  // sk 不计数
  const labels3 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'sk', w: 2 },
      { kind: 'standard', w: 50 },
      { kind: 'sk', w: 2 },
    ] },
  });
  eq(labels3.length, 1, 'sk 不计数，仅 1 个 standard');
});
```

- [ ] **Step 1.3: 跑测试，确认通过**

切到 `D:/工程/柠檬塔/程序/LemonTA-minor`，执行：

```bash
node tests/run.js
```

Expected：`wireframe-labels.computeLabelPositions` 节全部 ✓；总数 `<N> passed, 1 failed`（pre-existing layout-engine 失败仍存在，与本任务无关）。

- [ ] **Step 1.4: 修改 `pages/cost/index.js`：require 公共函数，删除内部副本**

a) 在文件顶部，找到（约第 1-3 行）：
```javascript
const costEngine = require('../../utils/cost-engine.js');
const cloud = require('../../utils/cloud.js');
const planStore = require('../../utils/plan-store.js');
```

末尾追加：
```javascript
const wireframeLabels = require('../../utils/wireframe-labels.js');
```

b) 删除文件中第 5-58 行整段 `computeLabelPositions(plan)` 函数定义（含函数顶部的注释 `// 线框图编号叠加：...`）。

c) 找到 `onLoad` 中（约第 97 行）：
```javascript
labelPositions: computeLabelPositions(plan),
```

改为：
```javascript
labelPositions: wireframeLabels.computeLabelPositions(plan),
```

- [ ] **Step 1.5: 手工 sanity check：cost 页仍能正常加载（无法 Node 测，仅静态自查）**

读一遍修改后的 `pages/cost/index.js`，确认：
- `wireframeLabels` 已 require
- 内部 `computeLabelPositions` 函数已彻底删除
- 唯一调用点改为 `wireframeLabels.computeLabelPositions(plan)`

- [ ] **Step 1.6: 项目不是 git 仓库，跳过 git 操作**

---

## Task 2: 成本页隐藏 canvas + 合成方法

**Files:**
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/cost/index.wxml`
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/cost/index.wxss`
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/cost/index.js`

- [ ] **Step 2.1: wxml 添加隐藏 canvas**

在 `pages/cost/index.wxml` 中，找到根 `<view class="page">` 内任意位置（推荐放在文件末尾 `<view class="floating-toast">` 之前），追加一行：

```xml
<canvas type="2d" id="wf-canvas" class="wf-bake-canvas"></canvas>
```

注意：必须放在 `<view class="page">` 的 children 中，不要放在 page 之外。

- [ ] **Step 2.2: wxss 让 canvas 离屏**

在 `pages/cost/index.wxss` 末尾追加：

```css
.wf-bake-canvas {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  z-index: -1;
}
```

- [ ] **Step 2.3: 添加 `_maybeBakeWireframe` 方法**

在 `pages/cost/index.js` 的 Page 对象中，**在 `openDetail(e) {` 这一行之前**（即紧跟 `onLoad` 方法之后）插入新方法：

```javascript
  _maybeBakeWireframe() {
    const plan = this.data.plan;
    if (!plan || !plan.wireframeImage) return;
    if (plan.wireframeHasLabels) return;

    wx.createSelectorQuery().in(this)
      .select('#wf-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0, img.width, img.height);

          const labels = wireframeLabels.computeLabelPositions(plan);
          const fontPx = Math.max(12, Math.round(img.width * 0.05));
          ctx.font = 'bold ' + fontPx + 'px sans-serif';
          ctx.fillStyle = '#EE822F';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          labels.forEach((label) => {
            const x = (label.left / 100) * img.width;
            const y = (label.top / 100) * img.height;
            ctx.fillText(String(label.idx), x, y);
          });

          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            success: (out) => {
              const updated = Object.assign({}, plan, {
                wireframeImage: out.tempFilePath,
                wireframeHasLabels: true,
              });
              planStore.upsert(updated);
              this.setData({ plan: updated });
            },
            fail: (err) => {
              console.warn('[cost] bake wireframe failed:', err && err.errMsg);
            },
          });
        };
        img.onerror = (err) => {
          console.warn('[cost] load wireframeImage failed:', err && err.errMsg);
        };
        img.src = plan.wireframeImage;
      });
  },
```

- [ ] **Step 2.4: 在 `onLoad` 末尾触发合成**

在 `pages/cost/index.js` 的 `onLoad` 方法中，找到最后的 `setData(...)` 调用（约第 91-98 行）：

```javascript
    this.setData({
      plan,
      from,
      cost,
      bottomRow,
      topRow,
      labelPositions: wireframeLabels.computeLabelPositions(plan),
    });
```

在这个 `setData` 调用之后、`onLoad` 方法结束之前（即下一行紧接着 `});` 之后），插入：

```javascript
    this._maybeBakeWireframe();
```

最终 `onLoad` 末尾形如：

```javascript
    this.setData({ ... });
    this._maybeBakeWireframe();
  },
```

- [ ] **Step 2.5: 跑测试，确认未影响 Node 测试**

```bash
node tests/run.js
```

Expected：与 Task 1 完成时一致——`wireframe-labels` 节全 ✓、`pdf-exporter._countCabinets` 节全 ✓、唯一失败仍是 pre-existing layout-engine。

- [ ] **Step 2.6: 项目不是 git 仓库，跳过 git 操作**

---

## Task 3: PDF 端按 wireframeHasLabels 判定

**Files:**
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/utils/pdf-exporter.js`

- [ ] **Step 3.1: 修改 `_renderLayout`**

在 `pdf-exporter.js` 中找到 `async function _renderLayout(canvas, ctx, plan) { ... }` 函数（Task 4 后大约第 127-139 行）。当前函数体：

```javascript
async function _renderLayout(canvas, ctx, plan) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  ctx.fillText('布局线框图', MARGIN, MARGIN);

  const wfY = MARGIN + 50 * SCALE;
  const wfW = CANVAS_W - MARGIN * 2;
  const wfH = CANVAS_H - wfY - MARGIN;

  const hint = '未计算成本，无线框图。请到"我的方案"选择该方案，选板材五金后点"计算成本"，在成本透视页即可看到线框图。';
  await _drawImageContain(canvas, ctx, plan.wireframeImage, MARGIN, wfY, wfW, wfH, hint);
}
```

整段替换为：

```javascript
async function _renderLayout(canvas, ctx, plan) {
  _resetCanvas(ctx);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold ' + (22 * SCALE) + 'px sans-serif';
  ctx.fillText('布局线框图', MARGIN, MARGIN);

  const wfY = MARGIN + 50 * SCALE;
  const wfW = CANVAS_W - MARGIN * 2;
  const wfH = CANVAS_H - wfY - MARGIN;

  const hint = '未计算成本，无线框图。请到"我的方案"选择该方案，选板材五金后点"计算成本"，在成本透视页即可看到线框图。';
  const src = (plan.wireframeImage && plan.wireframeHasLabels) ? plan.wireframeImage : null;
  await _drawImageContain(canvas, ctx, src, MARGIN, wfY, wfW, wfH, hint);
}
```

- [ ] **Step 3.2: 跑测试，确认未引入回归**

```bash
node tests/run.js
```

Expected：与 Task 2 完成时一致。

- [ ] **Step 3.3: 项目不是 git 仓库，跳过 git 操作**

---

## Task 4: 设计页 onConfirmLayout 重置 wireframeHasLabels

**Files:**
- Modify: `D:/工程/柠檬塔/程序/LemonTA-minor/miniprogram/pages/design/index.js`

- [ ] **Step 4.1: 修改 `onConfirmLayout`**

在 `pages/design/index.js` 中找到（约第 484-495 行）：

```javascript
    const updatedPlan = Object.assign({}, plan, {
      layout: { items: state.items, meta: state.meta },
      cabinets,
      layoutSerialized,
      planFullName,
      cabinetCount,
      cornerLabel: cornerLabelMap[plan.cornerType] || '无转角',
      color: state.meta.color,
      showDoor: state.meta.showDoor,
      previewImage,
      wireframeImage,
    });
```

把最后一项 `wireframeImage,` 修改为 `wireframeImage,` 之后追加一行 `wireframeHasLabels: false,`：

```javascript
    const updatedPlan = Object.assign({}, plan, {
      layout: { items: state.items, meta: state.meta },
      cabinets,
      layoutSerialized,
      planFullName,
      cabinetCount,
      cornerLabel: cornerLabelMap[plan.cornerType] || '无转角',
      color: state.meta.color,
      showDoor: state.meta.showDoor,
      previewImage,
      wireframeImage,
      wireframeHasLabels: false,
    });
```

- [ ] **Step 4.2: 跑测试**

```bash
node tests/run.js
```

Expected：与前面任务一致。

- [ ] **Step 4.3: 项目不是 git 仓库，跳过 git 操作**

---

## Task 5: 人工回归验证

**Files:** 无修改

- [ ] **Step 5.1: 场景 A — 新建方案首次进入成本页合成**

操作：
1. 开发者工具/真机打开小程序
2. 「我的方案」→「新建方案」→ 完成空间设置 → 完成布局设计 → 确认布局
3. 进入材料页 → 选板材五金 → 点「计算成本」进入成本页
4. 停留 1-2 秒（合成需要时间）
5. 在开发者工具控制台执行：`wx.getStorageSync('PLAN_LIST').find(p => p.name === '<方案名>')`

预期：返回对象包含 `wireframeHasLabels: true`、`wireframeImage` 是 `http://tmp/...` 或 `wxfile://...` 形式的新临时路径

- [ ] **Step 5.2: 场景 B — 重复进入跳过合成**

操作（接 Step 5.1）：
1. 从成本页返回我的方案
2. 再次点击该方案 → 进入材料页 → 点「计算成本」回到成本页
3. 在控制台查看：`wx.getStorageSync('PLAN_LIST').find(p => p.name === '<方案名>').wireframeImage`

预期：`wireframeImage` 路径**与上次一致**（未重新合成）；可在 `_maybeBakeWireframe` 临时加 console.log 验证早返回

- [ ] **Step 5.3: 场景 C — 重新确认布局重置标记**

操作（接 Step 5.2）：
1. 从我的方案进入该方案 → 进入材料 → 点击「更换配置」→ 进入设计页（或从首页重新打开方案设计流程）
2. 在设计页改一个柜子（任意改一处）→ 重新「确认布局」
3. 检查 storage：`wx.getStorageSync('PLAN_LIST').find(p => p.name === '<方案名>')`

预期：`wireframeHasLabels` 已变回 `false`、`wireframeImage` 是新的路径

4. 继续进入材料页 → 点「计算成本」进入成本页 → 等 1-2 秒
5. 再次检查 storage

预期：`wireframeHasLabels` 又变 `true`，路径再次刷新

- [ ] **Step 5.4: 场景 D — PDF 导出带编号**

操作：
1. 从场景 A 的方案出发，进入「我的方案」
2. 点击「导出方案信息」→ 勾选该方案 → 输入文件名 → 导出
3. 打开 PDF，找到该方案的「布局线框图」页

预期：线框图页显示的是**带橙色编号 1、2、3 的成品图**（与成本页所见一致）

- [ ] **Step 5.5: 场景 E — PDF 导出未合成方案**

操作：
1. 新建一个方案，完成设计后**不进入成本页**直接返回我的方案
2. 在「我的方案」点击「导出方案信息」→ 勾选该方案 → 输入文件名 → 导出
3. 打开 PDF 看该方案的「布局线框图」页

预期：显示灰色占位框 + 多行提示语「未计算成本，无线框图。请到「我的方案」选择该方案，选板材五金后点「计算成本」，在成本透视页即可看到线框图。」

- [ ] **Step 5.6: 场景 F — 历史老方案兼容**

操作：找一个本地缓存里早期建的方案（没有 `wireframeHasLabels` 字段的）：
1. 在控制台执行 `wx.getStorageSync('PLAN_LIST').filter(p => p.wireframeHasLabels === undefined)`，确认存在这种方案
2. 进入该方案 → 材料 → 成本页 → 等 1-2 秒
3. 再查 storage

预期：自动合成、`wireframeHasLabels` 变 `true`

- [ ] **Step 5.7: 单测复跑**

```bash
node tests/run.js
```

Expected：`wireframe-labels.computeLabelPositions` 全 ✓、`pdf-exporter._countCabinets` 全 ✓、唯一失败仍是 pre-existing layout-engine

- [ ] **Step 5.8: 项目不是 git 仓库，跳过 git 操作**

---

## 自审记录

**Spec 覆盖检查：**
- spec 4 组件划分 `wireframe-labels.js` → Task 1 ✓
- spec 4 `cost/index.js` require + 删函数 → Task 1.4 ✓
- spec 4 `cost/index.wxml` 隐藏 canvas → Task 2.1 ✓
- spec 4 `cost/index.wxss` 离屏样式 → Task 2.2 ✓
- spec 4 `design/index.js` 重置标记 → Task 4 ✓
- spec 4 `pdf-exporter.js` 判定改造 → Task 3 ✓
- spec 5.2 `_maybeBakeWireframe` 完整实现 → Task 2.3 ✓
- spec 6 错误处理：silent 失败、字段缺失等同 false、setData 失败可忽略 → 在 `_maybeBakeWireframe` 实现中通过 console.warn + 不动 plan 实现 ✓
- spec 7 测试：sanity check → Task 1.2；人工 6 场景 → Task 5 ✓

**Placeholder 扫描：** 无 TBD/TODO；每步都有完整代码或可执行命令。

**Type 一致性：**
- `wireframeHasLabels` 在 design/cost/pdf-exporter 三处使用，名称完全一致 ✓
- `computeLabelPositions` 签名 `(plan) → labels[]` 在 Task 1 定义、Task 2 调用，一致 ✓
- `_maybeBakeWireframe` 方法在 Task 2.3 定义、Task 2.4 调用，一致 ✓

**Plan 完整性：** 所有任务可在不依赖 git 的环境下执行；UI 验证场景明确给出操作步骤和预期。
