# 3D Dimension Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设计衣柜页 3D 场景里给每个柜子加宽度、共享高度、共享深度以及剩余空间的尺寸标注(参考 `docs/宜家标尺.png`),黑标签=柜尺寸,蓝标签=剩余,标签为两头带竖线的标尺。

**Architecture:** 全部实现放在 `miniprogram/cabinet/utils/three-renderer.js` 内,新增 `_dimGroup`(挂在 `_roomGroup` 下随房间旋转)+ 一组 sprite/ruler 工厂 + `setDimensionsInfo(info)` 入口。Design 页在每次 `setItems` 之后跟一次 `setDimensionsInfo`。截图路径显式隐藏 `_dimGroup`。

**Tech Stack:** `threejs-miniprogram` (含 `Sprite/SpriteMaterial/CanvasTexture/LineSegments/BufferGeometry`),`wx.createOffscreenCanvas({type:'2d'})`。

**Spec:** `docs/superpowers/specs/2026-07-16-3d-dimension-labels-design.md`

**Testing note:** 微信小程序 3D 渲染器无自动化测试基础设施,本 plan 每个任务的"验证"步骤都是 **人工在微信开发者工具里目测**。因此每完成一个任务立刻 commit,方便中途出问题时快速二分回退。

---

## File Structure

- **Modify** `miniprogram/cabinet/utils/three-renderer.js` — 全部尺寸标注实现
- **Modify** `miniprogram/cabinet/pages/design/index.js` — 两处调用点(`onReady`, `recompute`)

---

## Task 1: Sprite 标签工厂

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

**Where to insert:** 在 `class ThreeRenderer` 内、`startLoop()` 方法之后、`setRotation` 之前(约 line 617 后)。

- [ ] **Step 1: 添加 `_makeLabelSprite(text, style)` 方法**

在指定位置插入(整段方法):

```js
  // 尺寸标注标签:圆角矩形背景 + 白字。text 只允许 ASCII 数字 & '.',
  // 便于 canvas 宽度按字符数估算(不需要动态 measureText 再重设 canvas)。
  // style: { bg, fg } 均为 CSS 颜色字符串。
  _makeLabelSprite(text, style) {
    const THREE = this.THREE;
    if (!THREE || !THREE.Sprite || !THREE.CanvasTexture) return null;
    const DPR = 2; // 与画布 dpr 无关,label 自己吃 DPR 让文字锐利
    const fontPx = 26;      // canvas 视觉字号
    const paddingX = 14;
    const paddingY = 8;
    const radius = 10;
    // 单字符宽度粗估:数字/'.' 在 sans-serif bold 里 ~fontPx*0.6
    const glyphW = Math.ceil(fontPx * 0.6);
    const textPx = glyphW * text.length;
    const cssW = textPx + paddingX * 2;
    const cssH = fontPx + paddingY * 2;
    const canvasW = cssW * DPR;
    const canvasH = cssH * DPR;
    const off = wx.createOffscreenCanvas({ type: '2d', width: canvasW, height: canvasH });
    const ctx = off.getContext('2d');
    ctx.scale(DPR, DPR);
    // 圆角矩形
    ctx.fillStyle = style.bg;
    ctx.beginPath();
    const r = radius;
    ctx.moveTo(r, 0);
    ctx.lineTo(cssW - r, 0);
    ctx.quadraticCurveTo(cssW, 0, cssW, r);
    ctx.lineTo(cssW, cssH - r);
    ctx.quadraticCurveTo(cssW, cssH, cssW - r, cssH);
    ctx.lineTo(r, cssH);
    ctx.quadraticCurveTo(0, cssH, 0, cssH - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
    // 文字
    ctx.fillStyle = style.fg;
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cssW / 2, cssH / 2);
    const tex = new THREE.CanvasTexture(off);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // 世界高度固定 12cm,宽度按 canvas 宽高比
    const worldH = 12;
    const worldW = worldH * (cssW / cssH);
    sprite.scale.set(worldW, worldH, 1);
    // renderOrder 高于普通 mesh(默认 0),保证叠在柜体前
    sprite.renderOrder = 10;
    // 保存 material/texture 引用便于 dispose
    sprite.userData._dimTex = tex;
    sprite.userData._dimMat = mat;
    return sprite;
  }
```

- [ ] **Step 2: 打印一次冒烟测试(临时,验证后删)**

在 `initRoom` 最尾(`this.startLoop();` 之后)加一行临时代码验证 sprite 能创建:

```js
    // TEMP smoke test — 验证 sprite 工厂能出图,验证后本行删除
    const _testSprite = this._makeLabelSprite('230', { bg: '#0f172a', fg: '#ffffff' });
    if (_testSprite) {
      _testSprite.position.set(0, this.wall.h / 2, -50);
      this._roomGroup.add(_testSprite);
    }
```

- [ ] **Step 3: 在微信开发者工具打开设计页,验证冒烟标签**

Expected:场景正中(墙中间半高处、贴近墙内)看到一个黑底白字的 "230" 圆角小标签。文字锐利、无锯齿。

- [ ] **Step 4: 删掉冒烟测试代码**

删除 Step 2 加入的临时块。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 添加尺寸标签 sprite 工厂"
```

---

## Task 2: Ruler 线段工厂

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

**Where to insert:** 紧跟在 Task 1 的 `_makeLabelSprite` 之后。

- [ ] **Step 1: 添加 `_makeRulerLines({from, to, capAxis, capLen, color})` 方法**

```js
  // 尺寸标尺:主线 + 两头短垂线。
  // from/to: 世界坐标 { x, y, z }。capAxis: 短线方向 'x' | 'y' | 'z'。
  // capLen: 短线长度(cm)。color: 数字色号(0xRRGGBB)。
  _makeRulerLines({ from, to, capAxis, capLen, color }) {
    const THREE = this.THREE;
    if (!THREE || !THREE.LineSegments || !THREE.BufferGeometry) return null;
    const halfCap = (capLen || 8) / 2;
    // 短线增量向量
    const delta = { x: 0, y: 0, z: 0 };
    delta[capAxis] = halfCap;
    // 6 段 = 主线(from,to) + from cap(2) + to cap(2) = 6 顶点对
    // 简化:主线 2 顶点、from cap 2 顶点、to cap 2 顶点,合计 6 顶点 3 段
    const positions = new Float32Array([
      from.x, from.y, from.z, to.x, to.y, to.z,
      from.x - delta.x, from.y - delta.y, from.z - delta.z,
      from.x + delta.x, from.y + delta.y, from.z + delta.z,
      to.x - delta.x, to.y - delta.y, to.z - delta.z,
      to.x + delta.x, to.y + delta.y, to.z + delta.z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 9; // 略低于 sprite (10),让 sprite 覆盖端点交叉处
    lines.userData._dimGeo = geo;
    lines.userData._dimMat = mat;
    return lines;
  }
```

- [ ] **Step 2: 临时冒烟测试**

在 `initRoom` 尾部加(验证后删):

```js
    // TEMP smoke test — 验证 ruler 工厂
    const _testRuler = this._makeRulerLines({
      from: { x: -100, y: 100, z: -50 },
      to:   { x:  100, y: 100, z: -50 },
      capAxis: 'y', capLen: 15, color: 0x0f172a,
    });
    if (_testRuler) this._roomGroup.add(_testRuler);
```

- [ ] **Step 3: 微信开发者工具验证**

Expected:墙中央半高处有一条水平黑线,两端各有一个短竖线(向上向下延伸约 7.5cm)。

- [ ] **Step 4: 删掉冒烟测试**

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 添加尺寸标尺线段工厂"
```

---

## Task 3: `_dimGroup` + `setDimensionsInfo` 骨架 + dispose

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 在 `class ThreeRenderer` constructor 里初始化 `_dimGroup = null`**

找到 constructor(约 line 34):

```js
  constructor() {
    this._loaderCache = {};
    this._cabinets = [];
    this._color = 'white';
    this._showDoor = false;
    this._rotX = 0;
    this._rotY = 0;
    this._zoom = 1;
  }
```

改成:

```js
  constructor() {
    this._loaderCache = {};
    this._cabinets = [];
    this._color = 'white';
    this._showDoor = false;
    this._rotX = 0;
    this._rotY = 0;
    this._zoom = 1;
    this._dimGroup = null; // 尺寸标注 group,首次 setDimensionsInfo 时懒创建
  }
```

- [ ] **Step 2: 添加 `_disposeDimGroup` 方法**

紧跟在 Task 2 的 `_makeRulerLines` 之后插入:

```js
  // 清空 _dimGroup 里所有 child,并释放它们持有的 texture/material/geometry
  _disposeDimGroup() {
    if (!this._dimGroup) return;
    const g = this._dimGroup;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const child = g.children[i];
      const ud = child.userData || {};
      if (ud._dimTex) { try { ud._dimTex.dispose(); } catch (e) { /* ignore */ } }
      if (ud._dimMat) { try { ud._dimMat.dispose(); } catch (e) { /* ignore */ } }
      if (ud._dimGeo) { try { ud._dimGeo.dispose(); } catch (e) { /* ignore */ } }
      g.remove(child);
    }
  }
```

- [ ] **Step 3: 添加 `setDimensionsInfo(info)` 骨架**

紧跟在 `_disposeDimGroup` 之后插入:

```js
  // 尺寸标注入口。info:
  //   { wallW, wallH, hasRaise, isFull, cornerType }
  // 每次 setItems 之后由 design page 调用一次;内部清空 _dimGroup 后重建。
  setDimensionsInfo(info) {
    if (!this._roomGroup) return;
    const THREE = this.THREE;
    if (!this._dimGroup) {
      this._dimGroup = new THREE.Group();
      this._roomGroup.add(this._dimGroup);
    }
    this._disposeDimGroup();
    // 后续 Task 会把标签生成逻辑加在这里
    this._lastDimInfo = info; // 备份供调试/未来复用
  }
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): _dimGroup 骨架 + setDimensionsInfo 入口 + dispose"
```

---

## Task 4: 每柜宽 W 标签(黑)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 添加颜色常量**

在文件顶部现有常量区(约 line 23,`CABINET_DEPTH_CM` 之后)追加:

```js
const DIM_COLOR_BLACK = { css: '#0f172a', hex: 0x0f172a };
const DIM_COLOR_BLUE  = { css: '#2563eb', hex: 0x2563eb };
const DIM_FG          = '#ffffff';
```

- [ ] **Step 2: 在 `setDimensionsInfo` 里加"每柜宽"分支**

把 Task 3 里 `this._lastDimInfo = info;` 之前的空白替换成:

```js
    // 1) 每个柜的宽度标签(黑) —— 遍历 _cabinets 过滤 standard/corner/nonstandard
    for (const c of this._cabinets) {
      const it = c.item;
      if (!it) continue;
      if (it.kind !== 'standard' && it.kind !== 'corner' && it.kind !== 'nonstandard') continue;
      const xCenter = c.mesh.position.x;
      const halfW = it.w / 2;
      const isCorner = it.kind === 'corner';
      const itemDepth = isCorner ? 110 : 60;
      // 柜前突表面 z = c.mesh.position.z + itemDepth/2;标签再向前突 3cm 避免 z-fighting
      const zFront = c.mesh.position.z + itemDepth / 2 + 3;
      const ruler = this._makeRulerLines({
        from: { x: xCenter - halfW, y: 0, z: zFront },
        to:   { x: xCenter + halfW, y: 0, z: zFront },
        capAxis: 'y',
        capLen: 12,
        color: DIM_COLOR_BLACK.hex,
      });
      if (ruler) this._dimGroup.add(ruler);
      const label = this._makeLabelSprite(String(Math.round(it.w)), {
        bg: DIM_COLOR_BLACK.css, fg: DIM_FG,
      });
      if (label) {
        label.position.set(xCenter, -10, zFront);
        this._dimGroup.add(label);
      }
    }
```

- [ ] **Step 3: 在 design 页临时接线以便观察**

打开 `miniprogram/cabinet/pages/design/index.js`,找 `recompute` 方法尾部(约 line 386,`this._renderer.setItems(layoutEngine.renderRows(state));` 那行之后)加临时调用:

```js
      this._renderer.setItems(layoutEngine.renderRows(state));
      // TEMP 临时接线:后续 Task 10 会正式化
      this._renderer.setDimensionsInfo({
        wallW: state.meta.wall.w,
        wallH: state.meta.wall.h,
        hasRaise: state.meta.hasRaise,
        isFull: state.meta.isFull,
        cornerType: state.meta.cornerType,
      });
```

同时在 `onReady` 里 `renderer.setItems(layoutEngine.renderRows(this._state));` 那行(约 line 149)之后也加同样的块。

- [ ] **Step 4: 微信开发者工具验证**

Expected:每个柜子下方(y=-10 附近,即地板下方稍许)有一个黑底白字的宽度数字(如 "100"/"50"/"110"),下方有一条黑色水平线两头带向 y 延伸的短竖线。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js miniprogram/cabinet/pages/design/index.js
git commit -m "feat(3d-dims): 每柜宽度标签 + 临时接线"
```

---

## Task 5: 底行高 230 标签(黑)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 在 `setDimensionsInfo` 追加"底行高 230"分支**

紧接 Task 4 的每柜宽循环之后,`this._lastDimInfo = info;` 之前追加:

```js
    // 2) 底行高标签 230(黑) —— 贴左墙内表面,mid-height
    {
      const zLeft = -150 + 30; // -D_room + 30,与柜前突一致
      const xLeft = -info.wallW / 2;
      const ruler = this._makeRulerLines({
        from: { x: xLeft, y: 0,   z: zLeft },
        to:   { x: xLeft, y: 230, z: zLeft },
        capAxis: 'x',
        capLen: 12,
        color: DIM_COLOR_BLACK.hex,
      });
      if (ruler) this._dimGroup.add(ruler);
      const label = this._makeLabelSprite('230', {
        bg: DIM_COLOR_BLACK.css, fg: DIM_FG,
      });
      if (label) {
        label.position.set(xLeft - 10, 115, zLeft);
        this._dimGroup.add(label);
      }
    }
```

- [ ] **Step 2: 微信开发者工具验证**

Expected:场景左侧沿左墙内表面看到一条竖直黑色标尺,从地面到 230cm 高,两头带向 x 延伸的短横线;标尺左侧一个 "230" 黑底白字标签。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 底行高 230 标签"
```

---

## Task 6: 加高行高标签(黑,条件显示)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 在 `setDimensionsInfo` 追加"加高行高"分支**

紧接 Task 5 之后追加:

```js
    // 3) 加高行高标签(黑) —— hasRaise && wallH > 250 才显示
    if (info.hasRaise && info.wallH > 250) {
      const raiseH = info.wallH - 232;
      const zLeft = -150 + 30;
      const xLeft = -info.wallW / 2;
      const ruler = this._makeRulerLines({
        from: { x: xLeft, y: 232,        z: zLeft },
        to:   { x: xLeft, y: info.wallH, z: zLeft },
        capAxis: 'x',
        capLen: 12,
        color: DIM_COLOR_BLACK.hex,
      });
      if (ruler) this._dimGroup.add(ruler);
      const label = this._makeLabelSprite(String(Math.round(raiseH)), {
        bg: DIM_COLOR_BLACK.css, fg: DIM_FG,
      });
      if (label) {
        label.position.set(xLeft - 10, 232 + raiseH / 2, zLeft);
        this._dimGroup.add(label);
      }
    }
```

- [ ] **Step 2: 微信开发者工具验证**

打开一个满足加高条件的方案(墙高 260,勾加高):Expected 左侧看到两段竖直标尺:底段 0-230 标 "230",上段 232-260 标 "28"(即 raiseH)。

关掉加高:Expected 只剩底段 "230"。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 加高行高标签"
```

---

## Task 7: 标准柜深 60 + 转角柜深 110 标签(黑)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 追加"标准柜深"分支**

紧接 Task 6 之后:

```js
    // 4) 标准柜深 60(黑) —— 存在 standard/nonstandard 时,ref = 第一个 standard,fallback 第一个 nonstandard
    {
      const refCab =
        this._cabinets.find((c) => c.item && c.item.kind === 'standard') ||
        this._cabinets.find((c) => c.item && c.item.kind === 'nonstandard');
      if (refCab) {
        const xRef = refCab.mesh.position.x;
        const zBack  = refCab.mesh.position.z - 30; // 标准柜深 60,后表 = center - 30
        const zFront = refCab.mesh.position.z + 30;
        const ruler = this._makeRulerLines({
          from: { x: xRef, y: 230, z: zBack },
          to:   { x: xRef, y: 230, z: zFront },
          capAxis: 'y',
          capLen: 12,
          color: DIM_COLOR_BLACK.hex,
        });
        if (ruler) this._dimGroup.add(ruler);
        const label = this._makeLabelSprite('60', {
          bg: DIM_COLOR_BLACK.css, fg: DIM_FG,
        });
        if (label) {
          label.position.set(xRef, 240, refCab.mesh.position.z);
          this._dimGroup.add(label);
        }
      }
    }
```

- [ ] **Step 2: 追加"转角柜深"分支**

紧接:

```js
    // 5) 转角柜深 110(黑) —— 每个转角柜一个
    for (const c of this._cabinets) {
      if (!c.item || c.item.kind !== 'corner') continue;
      const xRef = c.mesh.position.x;
      const zBack  = c.mesh.position.z - 55; // 转角柜深 110,后表 = center - 55
      const zFront = c.mesh.position.z + 55;
      const ruler = this._makeRulerLines({
        from: { x: xRef, y: 230, z: zBack },
        to:   { x: xRef, y: 230, z: zFront },
        capAxis: 'y',
        capLen: 12,
        color: DIM_COLOR_BLACK.hex,
      });
      if (ruler) this._dimGroup.add(ruler);
      const label = this._makeLabelSprite('110', {
        bg: DIM_COLOR_BLACK.css, fg: DIM_FG,
      });
      if (label) {
        label.position.set(xRef, 240, c.mesh.position.z);
        this._dimGroup.add(label);
      }
    }
```

- [ ] **Step 2: 微信开发者工具验证**

无转角布局:Expected 第一个标准柜顶部有一条沿 z 方向的黑色标尺(前后各 30cm),中间一个 "60" 黑底白字。

带左转角/双侧转角:Expected 每个转角柜顶部也有一条同样风格的标尺,标 "110",长度更长。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 标准柜与转角柜深度标签"
```

---

## Task 8: 剩余宽标签(蓝,条件显示)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 追加"剩余宽"分支**

紧接 Task 7 之后:

```js
    // 6) 剩余宽标签(蓝) —— !isFull 且实际有间隙时
    if (!info.isFull) {
      // xLast:_cabinets 中非 sk 项最右一个的右边缘 x
      let xLast = -info.wallW / 2 + 2; // fallback:紧贴左 SK 内缘
      let anyNonSk = false;
      for (const c of this._cabinets) {
        if (!c.item || c.item.kind === 'sk' || c.item.kind === 'spacer') continue;
        const right = c.mesh.position.x + c.item.w / 2;
        if (!anyNonSk || right > xLast) { xLast = right; anyNonSk = true; }
      }
      // 有左转角但还没放任何 standard 的初始态:xLast 就等于左转角右缘,上一循环已覆盖
      // xWall:右墙内表面(减掉右转角 110 与右 SK 2)
      const rightHasCorner =
        info.cornerType === 'YZJ' || info.cornerType === 'ZYZJ';
      const xWall = info.wallW / 2 - (rightHasCorner ? 110 : 0) - 2;
      if (xWall - xLast > 1) {
        const zFront = -150 + 60 + 3; // 标准柜前突 + 微突
        const ruler = this._makeRulerLines({
          from: { x: xLast, y: 115, z: zFront },
          to:   { x: xWall, y: 115, z: zFront },
          capAxis: 'y',
          capLen: 12,
          color: DIM_COLOR_BLUE.hex,
        });
        if (ruler) this._dimGroup.add(ruler);
        const remainW = xWall - xLast;
        const label = this._makeLabelSprite(String(Math.round(remainW)), {
          bg: DIM_COLOR_BLUE.css, fg: DIM_FG,
        });
        if (label) {
          label.position.set((xLast + xWall) / 2, 115, zFront);
          this._dimGroup.add(label);
        }
      }
    }
```

- [ ] **Step 2: 微信开发者工具验证**

场景放 1-2 个柜之后(未布满):Expected 从最后柜的右边缘沿墙面 mid-height 拉一条蓝色标尺到右墙(或右转角左缘),中间蓝底白字数字。

布满(点"下一模块"直到 isFull):Expected 蓝色标尺立刻消失。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 剩余宽标签(蓝)"
```

---

## Task 9: 剩余高标签(蓝,条件显示)

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 追加"剩余高"分支**

紧接 Task 8 之后:

```js
    // 7) 剩余高标签(蓝) —— !hasRaise && wallH > 230
    if (!info.hasRaise && info.wallH > 230) {
      const zFront = -150 + 60 + 3;
      const ruler = this._makeRulerLines({
        from: { x: 0, y: 230,        z: zFront },
        to:   { x: 0, y: info.wallH, z: zFront },
        capAxis: 'x',
        capLen: 12,
        color: DIM_COLOR_BLUE.hex,
      });
      if (ruler) this._dimGroup.add(ruler);
      const remainH = info.wallH - 230;
      const label = this._makeLabelSprite(String(Math.round(remainH)), {
        bg: DIM_COLOR_BLUE.css, fg: DIM_FG,
      });
      if (label) {
        label.position.set(0, (230 + info.wallH) / 2, zFront);
        this._dimGroup.add(label);
      }
    }
```

- [ ] **Step 2: 微信开发者工具验证**

墙高 260 未加高:Expected 墙中央上方 (x=0) 有一段蓝色竖标尺从 y=230 到 y=260,标 "30"。

开加高:Expected 蓝色高标尺消失,黑色加高高标签出现(Task 6 已实现)。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 剩余高标签(蓝)"
```

---

## Task 10: 正式化 design 页调用点 + 清理临时代码

**Files:**
- Modify: `miniprogram/cabinet/pages/design/index.js`

- [ ] **Step 1: 在 `onReady` 里正式化调用**

找到 `onReady` 内的 `renderer.setItems(layoutEngine.renderRows(this._state));` 那行(约 line 149),把 Task 4 里加的 TEMP 注释改成正式注释:

从(Task 4 加了的):
```js
          renderer.setItems(layoutEngine.renderRows(this._state));
          // TEMP 临时接线:后续 Task 10 会正式化
          this._renderer.setDimensionsInfo({
            wallW: state.meta.wall.w,
            ...
```

改成:
```js
          renderer.setItems(layoutEngine.renderRows(this._state));
          renderer.setDimensionsInfo({
            wallW: this._state.meta.wall.w,
            wallH: this._state.meta.wall.h,
            hasRaise: this._state.meta.hasRaise,
            isFull: this._state.meta.isFull,
            cornerType: this._state.meta.cornerType,
          });
```

注意 onReady 里的变量是局部 `renderer`(不是 `this._renderer`),`state` 是 `this._state`。

- [ ] **Step 2: 在 `recompute` 里正式化调用**

找到 `recompute` 里 `this._renderer.setItems(layoutEngine.renderRows(state));` 那行(约 line 386),清理临时注释:

```js
      this._renderer.setColor(state.meta.color);
      this._renderer.setShowDoor(state.meta.showDoor);
      this._renderer.setItems(layoutEngine.renderRows(state));
      this._renderer.setDimensionsInfo({
        wallW: state.meta.wall.w,
        wallH: state.meta.wall.h,
        hasRaise: state.meta.hasRaise,
        isFull: state.meta.isFull,
        cornerType: state.meta.cornerType,
      });
```

- [ ] **Step 3: 微信开发者工具验证**

Expected:同 Task 9 状态,但代码里已无 TEMP 注释,两处调用都是正式的。

- [ ] **Step 4: Commit**

```bash
git add miniprogram/cabinet/pages/design/index.js
git commit -m "feat(3d-dims): 正式化 setDimensionsInfo 调用点"
```

---

## Task 11: 截图排除标注

**Files:**
- Modify: `miniprogram/cabinet/utils/three-renderer.js`

- [ ] **Step 1: 找到 `captureLayoutImage` 与 `captureWireframeImage`**

在 `three-renderer.js` 里搜索这两个方法。

- [ ] **Step 2: 在 `captureLayoutImage` 入口加隐藏 + finally 恢复**

找到 `captureLayoutImage` 方法体,在最外层用 try/finally 包裹:

```js
  async captureLayoutImage(quality) {
    const dimWasVisible = this._dimGroup ? this._dimGroup.visible : false;
    if (this._dimGroup) this._dimGroup.visible = false;
    try {
      // ...原有实现全部保留在 try 内...
    } finally {
      if (this._dimGroup) this._dimGroup.visible = dimWasVisible;
    }
  }
```

**具体做法:** 打开当前 `captureLayoutImage` 完整方法,把 `async captureLayoutImage(quality) {` 那行的 `{` 之后立刻插入前两行,把方法体末尾的 `}` 前插入 `finally { ... }` 结尾。原方法体不做其他改动。

- [ ] **Step 3: 对 `captureWireframeImage` 做同样处理**

- [ ] **Step 4: 微信开发者工具验证**

在设计页点"确认布局" → 进入 materials 页 → 看方案预览图。Expected:预览图**无任何**尺寸标签/标尺,只有柜体本身。

进 cost 页看 wireframeImage 同样验证。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/cabinet/utils/three-renderer.js
git commit -m "feat(3d-dims): 截图路径隐藏尺寸标注"
```

---

## Task 12: 完整流程回归

**Files:** 无代码修改。仅微信开发者工具人工回归。

- [ ] **Step 1: 无转角 + 无加高 + 部分布局**

- 新建方案墙宽 300 墙高 260 无转角
- 进设计页
- Expected:
  - 首柜(默认 100cm)下方一个黑 "100" 标签+黑标尺
  - 左墙一个 "230"
  - 首柜顶部一个 "60"
  - 剩余宽蓝标签("196" ≈ 300-2-100-2)
  - 剩余高蓝标签("30")

- [ ] **Step 2: 逐步布满**

- 点"下一模块"直到 isFull
- Expected:
  - 每柜下方各自标宽
  - 剩余宽标签在最后一步消失

- [ ] **Step 3: 加高**

- 开加高开关
- Expected:
  - 剩余高蓝标签消失
  - 加高行高黑标签("28"若墙高 260)出现在左墙上部

- [ ] **Step 4: 双侧转角 + 加高**

- 回退,重建方案:墙宽 400 墙高 260 双侧转角柜,进设计页开加高
- Expected:
  - 左右两个转角柜顶部各一个 "110" 深标签
  - 首个标准柜顶部一个 "60"
  - 左墙 "230" 与加高 "28"
  - 若未布满,右侧蓝色剩余宽标签,end 端在右转角左缘

- [ ] **Step 5: 旋转与缩放**

- 单指拖拽旋转、双指缩放
- Expected:
  - 所有标签始终正对相机可读(sprite 天然 billboard)
  - 标尺随房间旋转
  - 缩放时标签同步放大缩小,不失真

- [ ] **Step 6: 截图链路**

- "确认布局" → materials 页 → 查看预览图
- 继续到 cost 页 → 查看 wireframe
- Expected:两处图片均无尺寸标注

- [ ] **Step 7: 无代码改动,不 commit**

---

## Self-Review

**Spec 覆盖:**
- 每柜标宽 → Task 4 ✓
- 底行高 230 → Task 5 ✓
- 加高行高 → Task 6 ✓
- 标准柜深 60 → Task 7 ✓
- 转角柜深 110 → Task 7 ✓
- 剩余宽(蓝) → Task 8 ✓
- 剩余高(蓝) → Task 9 ✓
- 布满时剩余宽消失 → Task 8 `!info.isFull` 判断 ✓
- 加高时剩余高消失 → Task 9 `!info.hasRaise` 判断 ✓
- 黑底白字 / 蓝底白字 → 常量 `DIM_COLOR_BLACK/BLUE` + `DIM_FG` ✓
- 两头带竖线标尺 → `_makeRulerLines` capAxis ✓
- 截图不含标注 → Task 11 ✓

**类型/命名一致性:**
- `_makeLabelSprite(text, { bg, fg })` — Task 1 定义,Task 4-9 均以 `{ bg: DIM_COLOR_*.css, fg: DIM_FG }` 调用 ✓
- `_makeRulerLines({ from, to, capAxis, capLen, color })` — Task 2 定义,Task 4-9 均按此签名调用 ✓
- `setDimensionsInfo({ wallW, wallH, hasRaise, isFull, cornerType })` — Task 3 定义,Task 4-9 追加分支,Task 10 调用点吃这五个字段 ✓
- `_disposeDimGroup` — Task 3 定义,`setDimensionsInfo` 内使用 ✓
- `userData._dimTex / _dimMat / _dimGeo` — Task 1/2 设置,Task 3 `_disposeDimGroup` 读 ✓

**Placeholder 扫描:** 无 TBD/TODO/"handle edge cases",所有代码步骤都给了完整代码。

**Scope:** 一个功能(尺寸标注),focused,不需要拆。
