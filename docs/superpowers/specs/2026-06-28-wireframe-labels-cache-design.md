# 线框图带编号成品图缓存设计

日期：2026-06-28
影响文件：
- `miniprogram/utils/wireframe-labels.js`（新）
- `miniprogram/pages/cost/index.js`
- `miniprogram/pages/cost/index.wxml`
- `miniprogram/pages/cost/index.wxss`
- `miniprogram/pages/design/index.js`
- `miniprogram/utils/pdf-exporter.js`

## 1. 背景与目标

当前 PDF 导出的线框图来自 `plan.wireframeImage`，这是设计页 `onConfirmLayout` 时由 three-renderer 生成的"原始线框图"，不带柜体编号。成本透视页（`pages/cost`）在原始图上用 DOM `<view class="wf-label">` 按百分比叠加橙色编号 1、2、3…，所以页面看到的是"带编号成品"。PDF 直接贴原始图，就看不到编号，与成本页表现不一致。

本次改造让"带编号的成品图"在用户首次进入成本透视页时被合成并缓存，覆盖 `plan.wireframeImage`，写入本地临时文件、并 `planStore.upsert` 持久化。一个方案只合成一次：合成后，无论后续怎么改板材五金、再次进入成本页，都直接复用这张成品图。只有用户回到设计页修改布局后，`onConfirmLayout` 重新生成原始线框图时才重置标记，下次再合成。

## 2. 数据契约变更

`plan` 对象新增两条字段：

- `plan.wireframeImage`（已存在，类型不变）：第一次进入成本页前是设计页生成的"原始线框图"临时文件路径；第一次进入成本页合成后被**覆盖**为"带编号成品图"临时文件路径
- `plan.wireframeHasLabels`（新）：布尔值。`true` 表示 `wireframeImage` 已是带编号成品图，可直接复用；缺失或 `false` 表示还是原始图，需要在成本页合成

其它字段不变。

## 3. 流程

### 3.1 一个方案的生命周期

```
设计页 onConfirmLayout
  → three-renderer 生成原始 wireframeImage（临时文件路径）
  → planStore.upsert(plan)：写入 wireframeImage、并强制 wireframeHasLabels=false
  → 进入板材页 / 成本页

成本页 onLoad（plan.wireframeHasLabels=false）
  → 用页面照常渲染（DOM 叠加橙色编号）
  → 后台同步触发合成（见 3.2）
  → 合成成功 → 覆盖 plan.wireframeImage、设 plan.wireframeHasLabels=true
  → planStore.upsert(plan)
  → setData({ plan })：wf-image src 切到成品图，DOM 橙色编号继续叠加（坐标完全一致，视觉无变化）

成本页 onLoad（plan.wireframeHasLabels=true）
  → 直接渲染（DOM 叠加橙色编号叠在成品图上，仍然完全对齐）
  → 跳过合成

PDF 导出
  → 看 plan.wireframeImage && plan.wireframeHasLabels
  → 都为真：贴 wireframeImage（带编号成品图）
  → 任一为假：走"未计算"占位提示

设计页 onConfirmLayout（再次确认布局）
  → 重生 wireframeImage、强制 wireframeHasLabels=false
  → 下次进入成本页会重新合成
```

### 3.2 合成步骤（成本页 onLoad 后后台）

1. onLoad 末尾，如果 `plan.wireframeImage && !plan.wireframeHasLabels`，启动合成（异步、不阻塞页面渲染）
2. 通过 `wx.createSelectorQuery` 获取隐藏的 `#wf-canvas`（type=2d）节点，按原图宽高设置 canvas 尺寸
3. `canvas.createImage()` 加载 `plan.wireframeImage` → `ctx.drawImage` 全图铺到 canvas
4. 调用 `wireframe-labels.js` 的 `computeLabelPositions(plan)` 得到 `[{idx, left%, top%}]`
5. 在 canvas 上按百分比换算 px，对每个编号：
   - `font` 用 `bold ${Math.round(canvas.width * 0.05)}px sans-serif`（与 DOM 端 36rpx 视觉比例对齐）
   - `fillStyle = '#EE822F'`，`textAlign = 'center'`，`textBaseline = 'middle'`
   - `fillText(String(idx), x, y)` 一个一个画
6. `wx.canvasToTempFilePath({ canvas, fileType: 'png' })` 拿到新临时文件路径
7. `plan.wireframeImage = 新路径`，`plan.wireframeHasLabels = true`
8. `planStore.upsert(plan)`
9. `setData({ plan: <更新后的对象> })` — 页面 DOM 叠加层不变，wf-image 切到成品图，叠加层的坐标计算用同一个 `computeLabelPositions`，因此叠加与图上画的编号完全重合，视觉零差异

## 4. 组件划分

| 文件 | 角色 |
|---|---|
| `miniprogram/utils/wireframe-labels.js`（新） | 纯函数 `computeLabelPositions(plan) → [{key, idx, left, top}]`。从 `pages/cost/index.js` 第 5-58 行整段抽出，导出 `{ computeLabelPositions }` |
| `miniprogram/pages/cost/index.js` | `require('../../utils/wireframe-labels.js')` 替代内部函数。`onLoad` 末尾追加 `this._maybeBakeWireframe()` 调用 |
| `miniprogram/pages/cost/index.wxml` | 添加一个隐藏的 `<canvas type="2d" id="wf-canvas">`，作为合成画布 |
| `miniprogram/pages/cost/index.wxss` | 给 `#wf-canvas` 加 `position: fixed; left: -9999px; top: 0;` 保证完全离屏不影响布局 |
| `miniprogram/pages/design/index.js` | `onConfirmLayout` 写 `wireframeImage` 时强制 `wireframeHasLabels = false` |
| `miniprogram/utils/pdf-exporter.js` | `_renderLayout` 的判定改为 `plan.wireframeImage && plan.wireframeHasLabels` |

## 5. 详细改动

### 5.1 `miniprogram/utils/wireframe-labels.js`（新）

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

### 5.2 `miniprogram/pages/cost/index.js`

- 顶部新增 `const wireframeLabels = require('../../utils/wireframe-labels.js');`
- 删除文件内的 `computeLabelPositions` 函数
- `onLoad` 中 `labelPositions: computeLabelPositions(plan)` 改为 `labelPositions: wireframeLabels.computeLabelPositions(plan)`
- `setData` 调用之后追加：`this._maybeBakeWireframe();`
- 新增方法 `_maybeBakeWireframe()`：

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
          fail: () => { /* 合成失败 silent，下次再试 */ },
        });
      };
      img.onerror = () => { /* 加载失败 silent */ };
      img.src = plan.wireframeImage;
    });
},
```

### 5.3 `miniprogram/pages/cost/index.wxml`

在 `.section.wireframe` 之后或页面任意位置追加：

```xml
<canvas type="2d" id="wf-canvas" class="wf-bake-canvas"></canvas>
```

### 5.4 `miniprogram/pages/cost/index.wxss`

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

注意 `width/height` 在 wxss 里给个非零兜底值，避免某些环境下 `0×0` 节点被 GC 掉；实际尺寸由 JS 中 `canvas.width = img.width` 覆盖。

### 5.5 `miniprogram/pages/design/index.js`

在 `onConfirmLayout` 调用 `captureWireframeImage` 并写入 plan 的代码处，紧接着 `plan.wireframeImage = ...` 加上 `plan.wireframeHasLabels = false;`。具体行号在实现阶段定位。

### 5.6 `miniprogram/utils/pdf-exporter.js`

`_renderLayout` 中 `_drawImageContain(canvas, ctx, plan.wireframeImage, ...)` 的第三个参数判定改为：

```javascript
const src = (plan.wireframeImage && plan.wireframeHasLabels) ? plan.wireframeImage : null;
await _drawImageContain(canvas, ctx, src, MARGIN, wfY, wfW, wfH, hint);
```

效果：未合成（如老缓存里的方案、用户未进过成本页）时，PDF 仍走"未计算"提示，避免显示一张没编号的图与表格不一致。

## 6. 错误处理

- **合成失败**（canvas 节点未挂载、图像加载失败、写文件失败）：silent 失败。`plan.wireframeImage` 和 `plan.wireframeHasLabels` 不动；用户看到的页面仍正常（仍是原始图 + DOM 编号叠加）；下次进入成本页会再试合成
- **历史方案** `wireframeHasLabels` 字段不存在：等同 `false`，第一次进入成本页自动合成
- **合成完成时用户已离页**：`setData` 失败可忽略；planStore 已 upsert，下次进入会直接走 `wireframeHasLabels=true` 分支
- **PDF 导出时 `wireframeHasLabels` 缺失**：等同 `false`，PDF 走未计算提示，与已有逻辑一致

## 7. 测试

- `computeLabelPositions` 抽到独立纯函数后，在 `tests/run.js` 加 sanity check：
  - 空 layout / 无 wall 返回 `[]`
  - 含 3 个 standard，labels 长度 = 3
  - hasRaise=true 且 wall.h > 250，labels 长度 = 6（下排 + 加高排）
  - 所有 `left/top` 落在 0-100 范围内
- 合成过程依赖 wx canvas API，无法 Node 单测，由人工验证：
  - 场景 1：新建方案 → 设计 → 进材料 → 进成本页 → 等待 1 秒（合成时间）→ 检查 `plan.wireframeImage` 路径是否变化、`plan.wireframeHasLabels` 是否 true
  - 场景 2：从场景 1 退出后再进成本页 → 应跳过合成（看不出区别，仅 console.log 验证）
  - 场景 3：从场景 1 退到设计页，改一个柜子后重新确认布局 → 进入成本页 → 应重新合成
  - 场景 4：导出 PDF → 线框图页应是带编号成品图，与成本页一致
  - 场景 5：新建方案，不进成本页，直接导出 PDF → 走「未计算」占位提示

## 8. 不在范围内

- 不改 three-renderer 的图像生成逻辑
- 不改 cost-engine 的计算逻辑
- 不改 plan-list / materials / space-setup 页面
- 不删 pdf-exporter 中已成为死代码的 `_drawWireframeDiagram`、`_drawBadge` 等（避免节外生枝）
